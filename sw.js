/* Archangel Studio service worker.
   - BUILD is replaced at build time, so every deploy ships a byte-different SW → browsers install it, it activates at once
     (skipWaiting + clients.claim) and the page reloads once on `controllerchange` (see src/sw-register.ts).
   - HTML / navigations: network-first, bypassing the HTTP cache (GitHub Pages sends max-age=600), cached copy only when offline.
   - /assets/* (content-hashed): cache-first. Everything else: network-first with cache fallback.
   - Old app caches (archangel-*, ≠ current) are deleted on activate. Other caches (e.g. the on-device AI model, webllm/*) are left alone.
   All URLs are relative to this script, so it works at / and under a subpath such as /archangel-studio/. */
const BUILD = 'a9a5bb3ee4-mvfzvf1y';
const CACHE = `archangel-${BUILD}`;
const INDEX = new URL('./index.html', self.location).href;
const OFFLINE = new URL('./offline.html', self.location).href;
const RUN = new URL('./run/', self.location).href;
const SHELL = ['./', './index.html', './run/', './offline.html', './manifest.webmanifest', './favicon-32.png', './app-icon-192.png', './app-icon-512.png'];

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

  // Installed built apps: their manifest + icons are written by run/ into the 'ultra-apps' cache (kept across deploys).
  if (/\/run\/(app\.webmanifest|icon\.png)$/.test(url.pathname)) {
    event.respondWith(caches.open('ultra-apps').then((c) => c.match(req.url)).then((r) => r || fetch(req)));
    return;
  }

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHtml) {
    // Each page is cached under its own path (the studio → index.html, an installed app → run/), never mixed up.
    const isRun = /\/run\/(index\.html)?$/.test(url.pathname);
    const KEY = isRun ? RUN : INDEX;
    event.respondWith(
      fetch(isRun ? RUN : req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => { if (res.ok && (isRun || !/\/run\//.test(url.pathname))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(KEY, copy)); } return res; })
        .catch(() => caches.match(KEY).then((r) => r || caches.match(isRun ? RUN : './')).then((r) => r || caches.match(OFFLINE))),
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
