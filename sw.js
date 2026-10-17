/* Archangel Studio service worker.
   - BUILD is replaced at build time, so every deploy ships a byte-different SW → browsers install it, it activates at once
     (skipWaiting + clients.claim) and the page reloads once on `controllerchange` (see src/sw-register.ts).
   - HTML / navigations: network-first, bypassing the HTTP cache (GitHub Pages sends max-age=600), cached copy only when offline.
   - /assets/* (content-hashed): cache-first. Everything else: network-first with cache fallback.
   - Old app caches (archangel-*, ≠ current) are deleted on activate. Other caches (e.g. the on-device AI model, webllm/*) are left alone.
   All URLs are relative to this script, so it works at / and under a subpath such as /archangel-studio/. */
const BUILD = '3fa0e97f62-mvc2yznd';
const CACHE = `archangel-${BUILD}`;
const INDEX = new URL('./index.html', self.location).href;
const OFFLINE = new URL('./offline.html', self.location).href;
const SHELL = ['./', './index.html', './offline.html', './manifest.webmanifest', './favicon-32.png', './app-icon-192.png', './app-icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => undefined)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('archangel-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // never cache backend calls

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHtml) {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(INDEX, copy)); } return res; })
        .catch(() => caches.match(INDEX).then((r) => r || caches.match('./')).then((r) => r || caches.match(OFFLINE))),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});
