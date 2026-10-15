'use strict';
// Envoi vers Dropbox, en attendant la validation de l'appli par pCloud.
// Connexion officielle Dropbox (OAuth avec PKCE) : aucun mot de passe ni secret dans l'appli.
// L'appli Dropbox est de type « App folder » : elle ne voit que son propre dossier (Applications/<nom>).

const DBX_REDIRECT = () => location.origin + location.pathname.replace(/index\.html$/, '');

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function dbxConnect(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  // Le vérificateur voyage aussi dans « state » : sur iPhone, le retour peut arriver dans Safari
  // plutôt que dans l'appli installée, sans accès à ce qui a été mémorisé ici.
  const state = 'dbx.' + appKey + '.' + verifier;
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: DBX_REDIRECT(), token_access_type: 'offline', state,
  });
}

async function dbxToken(params) {
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || 'Dropbox a refusé la connexion');
  return j;
}

// Retour de la page Dropbox : ?code=…&state=dbx.<clé>.<vérificateur>
async function dbxReturn() {
  const q = new URLSearchParams(location.search);
  const state = q.get('state') || '';
  if (!state.startsWith('dbx.')) return false;
  history.replaceState(null, '', location.pathname);
  const [, appKey, verifier] = state.split('.');
  if (q.get('error')) { showSettings(true); showLoginError('Dropbox : ' + (q.get('error_description') || q.get('error'))); return true; }
  try {
    const j = await dbxToken({ code: q.get('code'), grant_type: 'authorization_code', client_id: appKey, code_verifier: verifier, redirect_uri: DBX_REDIRECT() });
    await dbxUse(appKey, j.refresh_token, j.access_token, j.expires_in);
  } catch (e) { showSettings(true); showLoginError('Dropbox : ' + e.message); }
  return true;
}

async function dbxUse(appKey, refresh, access, expiresIn) {
  S.dropbox = { appKey, refresh, access: access || null, exp: access ? Date.now() + (expiresIn - 60) * 1000 : 0, email: 'compte Dropbox' };
  try {
    const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess() } });
    const j = await r.json(); if (j.email) S.dropbox.email = j.email;
  } catch (e) { console.warn(e); }
  saveSettings(); showSettings(true); toast('Dropbox connecté ✓');
  if (!matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
    $('pc-key').value = btoa(JSON.stringify({ dbx: appKey, r: refresh }));
    $('wrap-key-out').hidden = false;
  }
  processQueue();
}

// Jeton d'accès valide (renouvelé automatiquement : ceux de Dropbox durent 4 heures).
async function dbxAccess() {
  const d = S.dropbox;
  if (d.access && Date.now() < d.exp) return d.access;
  const j = await dbxToken({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: d.appKey });
  d.access = j.access_token; d.exp = Date.now() + (j.expires_in - 60) * 1000; saveSettings();
  return d.access;
}

// Dépôt dans /AECA ou /ACAPEL du dossier de l'appli (créés automatiquement au premier envoi).
async function dbxUpload(asso, name, blob) {
  const arg = JSON.stringify({ path: `/${asso}/${name}`, mode: 'add', autorename: true, mute: false })
    .replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const send = async () => fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST', body: blob,
    headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Dropbox-API-Arg': arg, 'Content-Type': 'application/octet-stream' },
  });
  let r = await send();
  if (r.status === 401) { S.dropbox.access = null; r = await send(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_summary || 'Erreur Dropbox ' + r.status); e.auth = r.status === 401; throw e; }
  return j.name || name;
}
