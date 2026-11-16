// Tallomi phone version: keeps every file of this version so it opens and works with no network.
// A new version is downloaded in the background and starts only when the person taps "立即更新" (or the app is closed and reopened).
const VERSION = '1.45.0';
const CACHE = 'pennyworth-phone-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
    const c = await caches.open(CACHE);
    await c.addAll(list.map((u) => new Request(u, { cache: 'reload' })));
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('pennyworth-phone-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    if (hit) return hit;
    try { return await fetch(req); } catch { return new Response('離線中，而且這個檔案還沒有存下來。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
