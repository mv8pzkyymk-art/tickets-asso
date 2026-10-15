'use strict';

// ---------- Réglages (conservés sur le téléphone) ----------
const DEFAULTS = {
  asso: 'AECA',
  template: '{date}-{commerce}-{montant}-{asso}',
  folders: { AECA: '/Carlo Acutis/GS Carlo Acutis - CA/Groupe Scolaire/GSCA/05. Comptabilité - Finances/03. Factures - Comptabilité/ticket reconnu IA/AECA', ACAPEL: '/Carlo Acutis/GS Carlo Acutis - CA/Groupe Scolaire/GSCA/05. Comptabilité - Finances/03. Factures - Comptabilité/ticket reconnu IA/ACAPEL' },
  monthly: false,
  cards: { AECA: [], ACAPEL: [] },
  pcloud: null, // { host, auth | token, email }
  links: { AECA: '', ACAPEL: '' }, // liens de dépôt pCloud (code), un par association
  clientId: '', // identifiant de l'appli déclarée chez pCloud (connexion « Se connecter avec pCloud »)
};
const ASSOS = ['AECA', 'ACAPEL'];

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() { localStorage.setItem('settings', JSON.stringify(S)); }
// Clé de l'appli Dropbox des associations (publique, ce n'est pas un secret).
const DBX_DEFAULT_KEY = '';
let S = loadSettings();
if (!S.links) S.links = { AECA: '', ACAPEL: '' };
const canSend = asso => !!(S.links[asso] || S.pcloud || S.dropbox);

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
    autoRead(currentBlob);
  } catch (err) { toast('Impossible de lire la photo : ' + err.message); }
  e.target.value = '';
});
$('btn-retake').addEventListener('click', () => $('file').click());

// Lecture automatique : préremplit fournisseur, date et montant (champs modifiables ensuite).
async function autoRead(blob) {
  const st = $('ocr-status');
  st.hidden = false; st.textContent = 'Lecture du ticket…';
  try {
    const r = await readReceipt(blob, p => { st.textContent = `Lecture du ticket… ${Math.round(p * 100)} %`; });
    if (blob !== currentBlob) return; // une autre photo a été prise entre-temps
    const found = [];
    if (r.shop && !$('f-shop').value) { $('f-shop').value = r.shop; found.push('fournisseur'); }
    if (r.date) { $('f-date').value = r.date; found.push('date'); }
    if (r.amount != null && !$('f-amount').value) { $('f-amount').value = r.amount.toFixed(2).replace('.', ','); found.push('montant'); }
    updateFilename();
    st.textContent = found.length ? `Lu automatiquement : ${found.join(', ')}. Vérifiez avant d'envoyer.` : 'Lecture impossible, saisissez les informations.';
  } catch (err) {
    console.warn(err);
    st.textContent = 'Lecture automatique indisponible, saisissez les informations.';
  }
}

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

// Enregistrement manuel via le menu de partage du téléphone (pCloud, Fichiers, e-mail…),
// avec le fichier déjà nommé. Fonctionne sans aucune connexion à pCloud dans l'appli.
$('btn-share').addEventListener('click', async () => {
  if (!currentBlob) return;
  const name = buildName();
  const file = new File([currentBlob], name, { type: 'image/jpeg' });
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
    // Navigateur sans partage de fichiers : on télécharge le fichier nommé.
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  } else {
    try { await navigator.share({ files: [file] }); }
    catch (err) { if (err.name === 'AbortError') return; toast('Partage impossible : ' + err.message); return; }
  }
  remember($('f-shop').value.trim());
  addHistory({ id: Date.now() + '-s', asso: S.asso, name, folder: '', status: 'ok' });
  currentBlob = null;
  $('form').hidden = true; $('scan-label').hidden = false;
  toast('Ticket partagé ✓');
});

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
  if (!canSend(item.asso)) { toast('Ticket gardé en attente : connectez pCloud dans les réglages.'); return; }
  toast('Envoi en cours…');
  await processQueue();
});

let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  let sent = 0, failed = 0;
  try {
    for (const item of await queueAll()) {
      if (!canSend(item.asso)) continue;
      try {
        const finalName = S.links[item.asso] ? await pcUploadToLink(S.links[item.asso], item.name, item.blob)
          : S.pcloud ? await pcUpload(item.folder, item.name, item.blob)
          : await dbxUpload(item.asso, item.name, item.blob);
        await queueDel(item.id);
        setHistory(item.id, { status: 'ok', name: finalName });
        sent++;
      } catch (err) {
        failed++;
        console.warn(err);
        if (err.auth) { toast('Connexion expirée : reconnectez-vous dans les réglages.'); break; }
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
  // Résumé lisible d'une réponse pCloud (sans jeton), pour comprendre un refus.
  const brief = j => `${j.error || 'refus'} (code ${j.result}; champs : ${Object.keys(j).filter(k => !['auth', 'token'].includes(k)).join(', ')}${j.token ? ', token' : ''})`;
  for (const host of HOSTS) {
    const label = host.includes('eapi') ? 'Europe' : 'USA';
    try {
      const base = { getauth: 1, logout: 1, username: email, password, authexpire: 31536000 * 5 };
      // 1) Connexion simple, sans code.
      const j = await pcPost(host, 'userinfo', base);
      if (j.result === 0 && j.auth) return { host, auth: j.auth, email: j.email || email };
      const needsCode = j.result === 1022 || j.result === 2297 || !!j.token;
      if (!needsCode) { errors.push(`${label} : ${brief(j)}`); continue; }
      if (!tfaCode) {
        const err = new Error('pCloud demande un code de sécurité : saisissez le code à 6 chiffres puis touchez à nouveau « Se connecter ».');
        err.tfa = true; throw err;
      }
      // 2) Double authentification : pCloud renvoie un jeton temporaire à échanger avec le code.
      if (j.token) {
        const t = await pcPost(host, 'tfa_login', { token: j.token, code: tfaCode, trustdevice: 1 });
        if (t.result === 0 && t.auth) return { host, auth: t.auth, email };
        errors.push(`${label} étape code : ${brief(t)}`);
        continue;
      }
      // 3) Sinon, on renvoie la connexion avec le code joint.
      const k = await pcPost(host, 'userinfo', { ...base, code: tfaCode });
      if (k.result === 0 && k.auth) return { host, auth: k.auth, email: k.email || email };
      errors.push(`${label} : ${brief(j)} puis avec code : ${brief(k)}`);
    } catch (err) {
      if (err.tfa) { err.tfa = true; throw err; }
      errors.push(`${label} : connexion impossible (${err.message})`);
    }
  }
  const err = new Error(errors.join(' | '));
  if (tfaCode) err.tfa = true;
  throw err;
}

// Jeton à joindre aux appels : connexion pCloud officielle (access_token) ou e-mail/mot de passe (auth).
function pcCred() { return S.pcloud.token ? { access_token: S.pcloud.token } : { auth: S.pcloud.auth }; }

// ---------- Connexion officielle pCloud (OAuth) ----------
// La page de connexion de pCloud gère elle-même la connexion Apple et les codes de sécurité.
function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function pcOAuthStart() {
  const id = (S.clientId || '').trim();
  if (!id) { showLoginError('Renseignez d\'abord l\'identifiant d\'appli pCloud ci-dessous.'); return; }
  location.href = 'https://my.pcloud.com/oauth2/authorize?' + new URLSearchParams({ client_id: id, response_type: 'token', redirect_uri: redirectUri() });
}
async function pcOAuthReturn() {
  if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  if (h.get('error')) { showSettings(true); showLoginError('pCloud a refusé la connexion : ' + h.get('error')); return true; }
  await useToken('https://' + (h.get('hostname') || 'api.pcloud.com'), h.get('access_token'));
  return true;
}
async function useToken(host, token) {
  let email = 'compte pCloud';
  try { const j = await pcCall(host, 'userinfo', { access_token: token }); email = j.email || email; } catch (e) { console.warn(e); }
  S.pcloud = { host, token, email }; saveSettings();
  showSettings(true); toast('pCloud connecté ✓');
  // Dans Safari (hors appli installée), on affiche une clé à recopier dans l'appli installée.
  if (!matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
    $('pc-key').value = btoa(JSON.stringify({ h: host, t: token }));
    $('wrap-key-out').hidden = false;
  }
  processQueue();
}
function showLoginError(msg) { $('pc-error').textContent = msg; $('pc-error').hidden = false; }

const folderCache = {};
async function pcEnsureFolder(path) {
  if (folderCache[path]) return folderCache[path];
  const { host } = S.pcloud; const cred = pcCred();
  let folderid = 0;
  // On cherche d'abord le dossier existant en ignorant la forme des accents
  // (un Mac peut les écrire différemment), pour ne jamais créer de doublon.
  const norm = n => n.normalize('NFC');
  for (const part of path.split('/').filter(Boolean)) {
    const list = await pcCall(host, 'listfolder', { ...cred, folderid, nofiles: 1 });
    const found = (list.metadata.contents || []).find(c => c.isfolder && norm(c.name) === norm(part));
    if (found) { folderid = found.folderid; continue; }
    const r = await pcCall(host, 'createfolderifnotexists', { ...cred, folderid, name: part });
    folderid = r.metadata.folderid;
  }
  return (folderCache[path] = folderid);
}

async function pcUpload(folder, name, blob) {
  const { host } = S.pcloud; const cred = pcCred();
  const folderid = await pcEnsureFolder(folder);
  const fd = new FormData();
  fd.append('file', blob, name);
  const r = await pcCall(host, 'uploadfile', { ...cred, folderid, filename: name, renameifexists: 1, nopartial: 1 }, fd);
  return (r.metadata && r.metadata[0] && r.metadata[0].name) || name;
}

// Dépôt via un lien de dépôt pCloud (« Dépôt de fichiers ») : aucune connexion au compte,
// le téléphone peut seulement déposer dans le dossier choisi, sans rien voir ni supprimer.
async function pcUploadToLink(code, name, blob) {
  let last;
  for (const host of HOSTS) {
    const fd = new FormData();
    fd.append('file', blob, name);
    const r = await fetch(`${host}/uploadtolink?` + new URLSearchParams({ code, names: 'Appli Tickets' }), { method: 'POST', body: fd });
    const j = await r.json();
    if (j.result === 0) return name;
    last = new Error(j.error || 'Erreur pCloud ' + j.result);
  }
  throw last;
}
function linkCode(s) {
  s = (s || '').trim();
  const m = s.match(/[?&]code=([A-Za-z0-9]+)/);
  return m ? m[1] : s.replace(/[^A-Za-z0-9]/g, '');
}

// ---------- Historique ----------
function getHistory() { try { return JSON.parse(localStorage.getItem('history') || '[]'); } catch { return []; } }
function putHistory(h) { localStorage.setItem('history', JSON.stringify(h.slice(0, 30))); }
function addHistory(entry) { putHistory([entry, ...getHistory()]); renderHistory(); }
function setHistory(id, patch) { putHistory(getHistory().map(h => h.id === id ? { ...h, ...patch } : h)); }
async function renderHistory() {
  const h = getHistory();
  const queue = await queueAll().catch(() => []);
  const pendingIds = new Set(queue.map(q => q.id));
  $('queue-info').textContent = queue.length ? `· ${queue.length} en attente` : '';
  $('history').innerHTML = h.length ? h.map(e => {
    const waiting = pendingIds.has(e.id);
    return `<li data-id="${escapeHtml(e.id)}">
      <span class="tag ${e.asso}">${e.asso}</span>
      <span class="name">${escapeHtml(e.name)}</span>
      <span class="${waiting ? 'wait' : 'ok'}">${waiting ? '⏳' : '✓'}</span>
      ${waiting ? '<button type="button" class="mini" data-act="share" aria-label="Partager">⇪</button>' : ''}
      <button type="button" class="mini" data-act="del" aria-label="Supprimer">✕</button></li>`;
  }).join('')
    : '<li class="muted">Aucun ticket pour l\'instant.</li>';
}
// Supprimer un ticket (en attente : il ne sera jamais envoyé) ou le partager à la main.
$('history').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const id = btn.closest('li').dataset.id;
  const item = (await queueAll()).find(q => q.id === id);
  if (btn.dataset.act === 'share' && item) {
    const file = new File([item.blob], item.name, { type: 'image/jpeg' });
    try { await navigator.share({ files: [file] }); } catch (err) { if (err.name !== 'AbortError') toast('Partage impossible'); return; }
    await queueDel(id); toast('Ticket partagé ✓'); renderHistory(); return;
  }
  if (btn.dataset.act === 'del') {
    if (item && !confirm('Supprimer ce ticket en attente ? Il ne sera pas envoyé.')) return;
    if (item) await queueDel(id);
    putHistory(getHistory().filter(x => x.id !== id));
    renderHistory();
  }
});

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
    ASSOS.forEach(a => { $('s-link-' + a).value = S.links[a] || ''; $('s-folder-' + a).value = S.folders[a]; $('s-cards-' + a).value = (S.cards[a] || []).join(', '); });
    $('s-template').value = S.template;
    $('s-client').value = S.clientId || '';
    $('s-dbx-key').value = S.dbxKey || DBX_DEFAULT_KEY;
    $('s-monthly').checked = S.monthly;
    renderPcStatus();
  }
  window.scrollTo(0, 0);
}
function renderPcStatus() {
  const on = !!S.pcloud;
  const links = ASSOS.filter(a => S.links[a]);
  $('pc-status').textContent = on ? `Connecté : ${S.pcloud.email} (${S.pcloud.host.includes('eapi') ? 'serveur Europe' : 'serveur USA'})`
    : links.length ? `Envoi par lien de dépôt pour : ${links.join(', ')}` : 'Non connecté.';
  $('pc-login').hidden = on; $('btn-logout').hidden = !on;
  $('banner-setup').hidden = on || !!S.dropbox || links.length === ASSOS.length;
  const d = S.dropbox;
  $('dbx-status').textContent = d ? `Connecté : ${d.email}. Les tickets vont dans Dropbox, dossier Applications › (nom de l'appli) › AECA ou ACAPEL.` : 'Non connecté.';
  $('dbx-login').hidden = !!d; $('btn-dbx-logout').hidden = !d;
}
$('btn-dbx').addEventListener('click', () => {
  const key = $('s-dbx-key').value.trim();
  if (!key) { showLoginError('Collez d\'abord la clé d\'appli Dropbox (App key).'); return; }
  S.dbxKey = key; saveSettings(); dbxConnect(key);
});
$('btn-dbx-logout').addEventListener('click', () => { S.dropbox = null; saveSettings(); renderPcStatus(); });
$('btn-settings').addEventListener('click', () => showSettings($('view-settings').hidden));
$('link-setup').addEventListener('click', e => { e.preventDefault(); showSettings(true); });
$('btn-back').addEventListener('click', () => showSettings(false));
$('btn-save').addEventListener('click', () => {
  ASSOS.forEach(a => {
    S.folders[a] = '/' + $('s-folder-' + a).value.trim().replace(/^\/+|\/+$/g, '');
    S.cards[a] = $('s-cards-' + a).value.split(',').map(s => s.trim()).filter(Boolean);
    S.links[a] = linkCode($('s-link-' + a).value);
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
$('btn-oauth').addEventListener('click', () => { S.clientId = $('s-client').value.trim(); saveSettings(); pcOAuthStart(); });
$('btn-key').addEventListener('click', async () => {
  try {
    const k = JSON.parse(atob($('pc-key-in').value.trim()));
    if (k.dbx) await dbxUse(k.dbx, k.r); else await useToken(k.h, k.t);
    $('pc-key-in').value = '';
  }
  catch { showLoginError('Clé de connexion invalide : recopiez-la en entier.'); }
});
$('btn-copy-key').addEventListener('click', () => { navigator.clipboard.writeText($('pc-key').value).then(() => toast('Clé copiée')); });

// ---------- Divers ----------
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

if ('serviceWorker' in navigator) {
  // Vérifie à chaque ouverture s'il existe une nouvelle version, et recharge une fois si c'est le cas.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update());
  let reloaded = !navigator.serviceWorker.controller; // pas de rechargement à la toute première ouverture
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// Lien d'installation : https://…/tickets-asso/#setup=AECA:code,ACAPEL:code
// Les liens de dépôt restent dans l'adresse donnée aux utilisateurs, jamais dans le code public.
(function applySetup() {
  const m = location.hash.match(/setup=([^&]+)/);
  if (!m) return;
  decodeURIComponent(m[1]).split(',').forEach(pair => {
    const [asso, code] = pair.split(':');
    if (ASSOS.includes(asso) && code) S.links[asso] = linkCode(code);
  });
  saveSettings();
  history.replaceState(null, '', location.pathname);
  setTimeout(() => toast('Appli configurée ✓ ' + ASSOS.filter(a => S.links[a]).join(' et ')), 300);
})();

setAsso(S.asso);
fillShops();
renderPcStatus();
renderHistory();
processQueue();
pcOAuthReturn();
dbxReturn();
