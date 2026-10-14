'use strict';

// ---------- Réglages (conservés sur le téléphone) ----------
const DEFAULTS = {
  asso: 'AECA',
  template: '{date}-{commerce}-{montant}-{asso}',
  folders: { AECA: '/Carlo Acutis/GS Carlo Acutis - CA/Groupe Scolaire/GSCA/05. Comptabilité - Finances/03. Factures - Comptabilité/ticket reconnu IA/AECA', ACAPEL: '/Carlo Acutis/GS Carlo Acutis - CA/Groupe Scolaire/GSCA/05. Comptabilité - Finances/03. Factures - Comptabilité/ticket reconnu IA/ACAPEL' },
  monthly: false,
  cards: { AECA: [], ACAPEL: [] },
  pcloud: null, // { host, auth, email }
};
const ASSOS = ['AECA', 'ACAPEL'];

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() { localStorage.setItem('settings', JSON.stringify(S)); }
let S = loadSettings();

const $ = id => document.getElementById(id);
let currentBlob = null;

// ---------- Bascule d'association ----------
function setAsso(asso) {
  S.asso = asso; saveSettings();
  document.body.dataset.asso = asso;
  document.querySelectorAll('.switch button').forEach(b => b.setAttribute('aria-selected', b.dataset.asso === asso));
  document.querySelectorAll('.asso-name').forEach(e => e.textContent = asso);
  const meta = document.querySelector('meta[name=theme-color]');
  meta.content = asso === 'AECA' ? '#1f4e79' : '#2e7d4f';
  fillCards();
  updateFilename();
}
document.querySelectorAll('.switch button').forEach(b => b.addEventListener('click', () => setAsso(b.dataset.asso)));

function fillCards() {
  const cards = S.cards[S.asso] || [];
  $('wrap-card').hidden = cards.length === 0;
  $('f-card').innerHTML = cards.map(c => `<option>${escapeHtml(c)}</option>`).join('');
}

// ---------- Nommage ----------
function clean(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').replace(/-/g, ' ').trim().replace(/\s+/g, ' ');
}
function formatAmount(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n.toFixed(2).replace('.', ',');
}
function buildName() {
  const d = $('f-date').value || today();
  const [annee, mois, jour] = d.split('-');
  const vars = {
    date: annee + mois + jour, date_iso: d, annee, mois, jour, asso: S.asso,
    commerce: clean($('f-shop').value) || 'Commerce',
    montant: formatAmount($('f-amount').value) || '0,00',
    carte: clean($('f-card').value || ''),
  };
  let name = S.template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  name = name.replace(/([-_])\1+/g, '$1').replace(/^[-_]|[-_]$/g, '');
  return name + '.jpg';
}
function buildFolder() {
  let f = S.folders[S.asso] || '/';
  if (S.monthly) f = f.replace(/\/$/, '') + '/' + ($('f-date').value || today()).slice(0, 7);
  return f;
}
function updateFilename() {
  $('filename').textContent = buildName();
  $('folder').textContent = buildFolder();
}
['f-date', 'f-shop', 'f-amount', 'f-card'].forEach(id => $(id).addEventListener('input', updateFilename));

function today() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// ---------- Photo : redimensionnement + compression JPEG ----------
$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    currentBlob = await compress(file);
    $('preview').src = URL.createObjectURL(currentBlob);
    $('f-date').value = today();
    $('f-shop').value = ''; $('f-amount').value = '';
    $('form').hidden = false; $('scan-label').hidden = true;
    updateFilename();
    $('f-shop').focus();
  } catch (err) { toast('Impossible de lire la photo : ' + err.message); }
  e.target.value = '';
});
$('btn-retake').addEventListener('click', () => $('file').click());

async function compress(file, max = 2000, quality = 0.85) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImg(file));
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, ko) => c.toBlob(b => b ? ok(b) : ko(new Error('compression')), 'image/jpeg', quality));
}
function loadImg(file) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
}

// ---------- File d'attente (IndexedDB) : rien n'est perdu sans réseau ----------
function db() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('tickets', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
async function queueOp(mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const tx = d.transaction('queue', mode); const req = fn(tx.objectStore('queue'));
    tx.oncomplete = () => ok(req && req.result); tx.onerror = () => ko(tx.error);
  });
}
const queueAdd = item => queueOp('readwrite', s => s.put(item));
const queueDel = id => queueOp('readwrite', s => s.delete(id));
const queueAll = () => queueOp('readonly', s => s.getAll());

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentBlob) return;
  const item = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), asso: S.asso,
    name: buildName(), folder: buildFolder(), blob: currentBlob, at: new Date().toISOString() };
  remember($('f-shop').value.trim());
  await queueAdd(item);
  addHistory({ id: item.id, asso: item.asso, name: item.name, folder: item.folder, status: 'wait' });
  currentBlob = null;
  $('form').hidden = true; $('scan-label').hidden = false;
  if (!S.pcloud) { toast('Ticket gardé en attente : connectez pCloud dans les réglages.'); return; }
  toast('Envoi en cours…');
  await processQueue();
});

let processing = false;
async function processQueue() {
  if (processing || !S.pcloud) return;
  processing = true;
  let sent = 0, failed = 0;
  try {
    for (const item of await queueAll()) {
      try {
        const finalName = await pcUpload(item.folder, item.name, item.blob);
        await queueDel(item.id);
        setHistory(item.id, { status: 'ok', name: finalName });
        sent++;
      } catch (err) {
        failed++;
        console.warn(err);
        if (err.auth) { toast('Connexion pCloud expirée : reconnectez-vous dans les réglages.'); break; }
      }
    }
  } finally { processing = false; renderHistory(); }
  if (sent && !failed) toast(sent > 1 ? `${sent} tickets envoyés ✓` : 'Ticket envoyé ✓');
  else if (failed) toast(`${failed} ticket(s) en attente, nouvel essai automatique au retour du réseau.`);
}
window.addEventListener('online', processQueue);
document.addEventListener('visibilitychange', () => { if (!document.hidden) processQueue(); });

// ---------- API pCloud ----------
// Les comptes pCloud sont soit aux États-Unis (api.pcloud.com) soit en Europe (eapi.pcloud.com).
const HOSTS = ['https://eapi.pcloud.com', 'https://api.pcloud.com'];

async function pcCall(host, method, params = {}, body) {
  const url = `${host}/${method}?` + new URLSearchParams(params);
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json();
  if (json.result !== 0) {
    const err = new Error(json.error || 'Erreur pCloud ' + json.result);
    err.code = json.result;
    err.auth = [1000, 2000, 2094, 2095].includes(json.result);
    throw err;
  }
  return json;
}

// Connexion : on essaie les serveurs Europe puis USA, et on garde le détail de chaque
// échec pour l'afficher (identifiants refusés, double authentification, réseau bloqué…).
async function pcPost(host, method, params) {
  try {
    const r = await fetch(`${host}/${method}`, { method: 'POST', body: new URLSearchParams(params) });
    return await r.json();
  } catch (e) {
    // Repli en GET si le POST est bloqué par le navigateur.
    const r = await fetch(`${host}/${method}?` + new URLSearchParams(params));
    return await r.json();
  }
}

async function pcLogin(email, password, tfaCode) {
  const errors = [];
  for (const host of HOSTS) {
    const label = host.includes('eapi') ? 'Europe' : 'USA';
    try {
      const j = await pcPost(host, 'userinfo', { getauth: 1, logout: 1, username: email, password, authexpire: 31536000 * 5 });
      if (j.result === 0 && j.auth) return { host, auth: j.auth, email: j.email || email };
      if (j.result === 2297 && j.token) {
        // Double authentification activée sur le compte.
        if (!tfaCode) { const e = new Error('Code de double authentification requis : saisissez le code reçu puis touchez à nouveau « Se connecter ».'); e.tfa = true; throw e; }
        const t = await pcPost(host, 'tfa_login', { token: j.token, code: tfaCode, trustdevice: 1 });
        if (t.result === 0 && t.auth) return { host, auth: t.auth, email };
        errors.push(`${label} : code refusé (${t.error || ''} ${t.result})`);
        continue;
      }
      errors.push(`${label} : ${j.error || 'refus'} (code ${j.result})`);
    } catch (e) {
      if (e.tfa) throw e;
      errors.push(`${label} : connexion impossible (${e.message})`);
    }
  }
  throw new Error(errors.join(' | '));
}

const folderCache = {};
async function pcEnsureFolder(path) {
  if (folderCache[path]) return folderCache[path];
  const { host, auth } = S.pcloud;
  let folderid = 0;
  // On cherche d'abord le dossier existant en ignorant la forme des accents
  // (un Mac peut les écrire différemment), pour ne jamais créer de doublon.
  const norm = n => n.normalize('NFC');
  for (const part of path.split('/').filter(Boolean)) {
    const list = await pcCall(host, 'listfolder', { auth, folderid, nofiles: 1 });
    const found = (list.metadata.contents || []).find(c => c.isfolder && norm(c.name) === norm(part));
    if (found) { folderid = found.folderid; continue; }
    const r = await pcCall(host, 'createfolderifnotexists', { auth, folderid, name: part });
    folderid = r.metadata.folderid;
  }
  return (folderCache[path] = folderid);
}

async function pcUpload(folder, name, blob) {
  const { host, auth } = S.pcloud;
  const folderid = await pcEnsureFolder(folder);
  const fd = new FormData();
  fd.append('file', blob, name);
  const r = await pcCall(host, 'uploadfile', { auth, folderid, filename: name, renameifexists: 1, nopartial: 1 }, fd);
  return (r.metadata && r.metadata[0] && r.metadata[0].name) || name;
}

// ---------- Historique ----------
function getHistory() { try { return JSON.parse(localStorage.getItem('history') || '[]'); } catch { return []; } }
function putHistory(h) { localStorage.setItem('history', JSON.stringify(h.slice(0, 30))); }
function addHistory(entry) { putHistory([entry, ...getHistory()]); renderHistory(); }
function setHistory(id, patch) { putHistory(getHistory().map(h => h.id === id ? { ...h, ...patch } : h)); }
async function renderHistory() {
  const h = getHistory();
  const pending = (await queueAll().catch(() => [])).length;
  $('queue-info').textContent = pending ? `· ${pending} en attente` : '';
  $('history').innerHTML = h.length ? h.map(e => `<li>
      <span class="tag ${e.asso}">${e.asso}</span>
      <span class="name">${escapeHtml(e.name)}</span>
      <span class="${e.status}">${e.status === 'ok' ? '✓' : '⏳'}</span></li>`).join('')
    : '<li class="muted">Aucun ticket pour l\'instant.</li>';
}

function remember(shop) {
  if (!shop) return;
  const list = [shop, ...JSON.parse(localStorage.getItem('shops') || '[]').filter(s => s !== shop)].slice(0, 20);
  localStorage.setItem('shops', JSON.stringify(list));
  fillShops();
}
function fillShops() {
  $('shops').innerHTML = JSON.parse(localStorage.getItem('shops') || '[]').map(s => `<option value="${escapeHtml(s)}">`).join('');
}

// ---------- Écran réglages ----------
function showSettings(show) {
  $('view-main').hidden = show; $('view-settings').hidden = !show;
  if (show) {
    ASSOS.forEach(a => { $('s-folder-' + a).value = S.folders[a]; $('s-cards-' + a).value = (S.cards[a] || []).join(', '); });
    $('s-template').value = S.template;
    $('s-monthly').checked = S.monthly;
    renderPcStatus();
  }
  window.scrollTo(0, 0);
}
function renderPcStatus() {
  const on = !!S.pcloud;
  $('pc-status').textContent = on ? `Connecté : ${S.pcloud.email} (${S.pcloud.host.includes('eapi') ? 'serveur Europe' : 'serveur USA'})` : 'Non connecté.';
  $('pc-login').hidden = on; $('btn-logout').hidden = !on;
  $('banner-setup').hidden = on;
}
$('btn-settings').addEventListener('click', () => showSettings($('view-settings').hidden));
$('link-setup').addEventListener('click', e => { e.preventDefault(); showSettings(true); });
$('btn-back').addEventListener('click', () => showSettings(false));
$('btn-save').addEventListener('click', () => {
  ASSOS.forEach(a => {
    S.folders[a] = '/' + $('s-folder-' + a).value.trim().replace(/^\/+|\/+$/g, '');
    S.cards[a] = $('s-cards-' + a).value.split(',').map(s => s.trim()).filter(Boolean);
  });
  S.template = $('s-template').value.trim() || DEFAULTS.template;
  S.monthly = $('s-monthly').checked;
  saveSettings(); fillCards(); updateFilename();
  toast('Réglages enregistrés'); showSettings(false);
});
$('btn-login').addEventListener('click', async () => {
  const btn = $('btn-login'); btn.disabled = true; btn.textContent = 'Connexion…';
  $('pc-error').hidden = true;
  try {
    S.pcloud = await pcLogin($('pc-user').value.trim(), $('pc-pass').value, $('pc-tfa').value.trim());
    saveSettings(); $('pc-pass').value = ''; $('pc-tfa').value = ''; $('wrap-tfa').hidden = true;
    renderPcStatus(); toast('pCloud connecté ✓');
    processQueue();
  } catch (e) {
    if (e.tfa) $('wrap-tfa').hidden = false;
    $('pc-error').textContent = 'Échec de connexion. ' + e.message;
    $('pc-error').hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Se connecter';
});
$('btn-logout').addEventListener('click', () => { S.pcloud = null; saveSettings(); renderPcStatus(); });

// ---------- Divers ----------
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

setAsso(S.asso);
fillShops();
renderPcStatus();
renderHistory();
processQueue();
