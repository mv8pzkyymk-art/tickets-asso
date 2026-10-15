// Met en cache l'interface pour qu'elle s'ouvre même sans réseau.
// Les appels à l'API pCloud ne passent jamais par le cache.
const CACHE = 'tickets-v12';
const SHELL = ['./', 'index.html', 'style.css?v=12', 'app.js?v=12', 'ocr.js?v=12', 'dropbox.js?v=12', 'ocr/tesseract.min.js', 'ocr/worker.min.js', 'ocr/lang/fra.traineddata.gz', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Réseau d'abord (pour recevoir les mises à jour), cache en secours.
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
