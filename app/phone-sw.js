// Tallomi phone version: keeps every file of this version so it opens and works with no network.
// A new version is downloaded in the background (only the files that changed: the rest is copied from the version in use) and starts when the
// person taps "立即更新", when the app is put away, or when it is closed and reopened.
const VERSION = '1.72.4';
const CACHE = 'pennyworth-phone-' + VERSION;
const HASHES = {"./":"72ae9828cc2798855f29","./app.zip":"a9c77319d477d65691b4","./bundle.zip":"d972efd2d951698a8831","./check-worker.js":"06b39eea0254aed63e72","./check.html":"c7e0f7315a8df2564d03","./check.js":"6deede2619ea8d47b7be","./index.html":"72ae9828cc2798855f29","./manifest.webmanifest":"d04b3e9242ab48be6ab1","./phone-boot.js":"9662d5e0685ea7ce8cea","./phone-worker.js":"d224ec41df551f9ca5d9","./pyodide/click-8.3.1-py3-none-any.whl":"5ef60b3b53c73c07e4d6","./pyodide/jinja2-3.1.6-py3-none-any.whl":"8b25d9206c928a267f6b","./pyodide/libopenssl-1.1.1w.zip":"b45d7b987ff32bf43c40","./pyodide/markupsafe-3.0.2-cp313-cp313-pyemscripten_2025_0_wasm32.whl":"7f8172d16b54068024b7","./pyodide/pyodide-lock.json":"14d2c2dba101277999e1","./pyodide/pyodide.asm.js":"356c42f69e1695397e9d","./pyodide/pyodide.asm.wasm":"54309a5a2cfd757b1f0f","./pyodide/pyodide.mjs":"510ca14305230018f50c","./pyodide/pyodide_http-0.2.2-py3-none-any.whl":"386005067f118102bdbc","./pyodide/python_stdlib.zip":"831fd1e535084b972f87","./pyodide/sqlite3-1.0.0-cp313-cp313-pyemscripten_2025_0_wasm32.whl":"3d64fee45743c2d96621","./pyodide/ssl-1.0.0-cp313-cp313-pyemscripten_2025_0_wasm32.whl":"aebcda0b42e9409aa82c","./static/app-advance.js":"15241f8bdb2ec1ed8967","./static/app-balance.js":"d8e0a3e4edbcd4584dab","./static/app-bills.js":"a11f101fd547e356fc9d","./static/app-calendar.js":"42f05fb572d7d2f5b3cc","./static/app-categories.js":"32cdc50536bdd1e99944","./static/app-compare.js":"4492690c6c38d1cb5d0e","./static/app-diag.js":"14aedaae2468342ec82b","./static/app-dividend.js":"0c86ad2c54f1864f9d7d","./static/app-emoji.js":"24e20803f6948ebcaf89","./static/app-exchange.js":"626593e61d675f63ba2f","./static/app-extras.js":"c626b0a7fefd5c11be32","./static/app-goals.js":"d8373fe0fa450311a308","./static/app-home.js":"52a4a72f3a1baaaee73e","./static/app-icons.js":"0623afa20a21821220b6","./static/app-import.js":"3e1e045f080ea728c4d3","./static/app-invest.js":"5cbc8ed20402a7e53e8b","./static/app-list.js":"e1044ec86c78a9565f4c","./static/app-listkeys.js":"5fba7fb5a2e7c1b0eb14","./static/app-local.js":"948640cc0a9060f58189","./static/app-lock.js":"4223783dcd034f7e7aea","./static/app-market.js":"1c83a4caf7bf0cf98b2c","./static/app-mode.js":"992cc1d99dfccce524a6","./static/app-networth.js":"16567fb059bd87408a0d","./static/app-offline.js":"8a710ba1e39bff48897b","./static/app-onboard.js":"f779a49d96306de429a7","./static/app-onphone.js":"640d97950d243fd192cb","./static/app-palette.js":"bf8362994452b92311f2","./static/app-periods.js":"a0790d71b0047dc89b36","./static/app-phone.js":"c5394f96a5cc27a001b0","./static/app-prefetch.js":"e09d641278823014b431","./static/app-quick.js":"19fec5a539b680ab916a","./static/app-recurring.js":"9432863a575b41aee6de","./static/app-rules.js":"57f60a3b85c17cd915a4","./static/app-tags.js":"01950b73d36ac5fa0fc5","./static/app-tiles.js":"0d307eec736b765fcd2d","./static/app-update.js":"89fe4e36966248a3ce5a","./static/app.js":"2ac9f1045d4a2d48a583","./static/apple-touch-icon.png":"615a74abc1aafefa5aad","./static/emoji-pack.js":"ecfe128146221af0144d","./static/emoji/LICENSE.txt":"d3946a51f4baf91713b5","./static/favicon.ico":"6b4b38525633d10c566f","./static/icon-192.png":"6b428529a07f898efae4","./static/icon-256.png":"95c9ebbf35d2ae54c158","./static/icon-48.png":"0ee1a117b9babe0ab7a8","./static/icon-512.png":"febbc0aebfb132d481d7","./static/icon-maskable-512.png":"ebaf16d9794a52ad527c","./static/local-worker.js":"0a7258ef2194b52836f1","./static/manifest.webmanifest":"415e32165c4183e2cdb1","./static/style.css":"e750db9fb6c4d9972cb2","./static/theme.js":"7bc5cb4665fd2aa512b2","./static/vendor/chart.LICENSE.md":"41a84aa2caba645f966a","./static/vendor/chart.umd.js":"338399fb5bafe598d21c","./static/vendor/fonts/IBMPlexSans-OFL.txt":"d0283623ef57e722fd0e","./static/vendor/fonts/Newsreader-OFL.txt":"26028ec4e13b650065fa","./static/vendor/fonts/ibm-plex-sans-latin-400-normal.woff2":"3b646991d30055a93a4e","./static/vendor/fonts/ibm-plex-sans-latin-500-normal.woff2":"0717336fb31fcdcde4b8","./static/vendor/fonts/ibm-plex-sans-latin-600-normal.woff2":"8960851d691c054ed38e","./static/vendor/fonts/newsreader-latin-400-normal.woff2":"e66067814f1c672d33a4","./static/vendor/fonts/newsreader-latin-500-normal.woff2":"5613e2fc8377392c02e8","./static/vendor/qrcode.LICENSE.txt":"76b6aa33aecbc9574682","./static/vendor/qrcode.js":"79ec86f82856005b1c88","./wheels.json":"c675aa49c5dce001ae99","./wheels/blinker-1.9.0-py3-none-any.whl":"ba0efaa9080b619ff2f3","./wheels/flask-3.1.3-py3-none-any.whl":"f4bcbefc124291925f1a","./wheels/itsdangerous-2.2.0-py3-none-any.whl":"c6242fc49e35958c8b15","./wheels/werkzeug-3.1.9-py3-none-any.whl":"6392e50c78460ba618e5"};                                   // file -> fingerprint of what this build put there (phone-sw.js itself is not listed)
const KEPT = new Request(new URL('__fingerprints.json', self.registration.scope).href);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
    const c = await caches.open(CACHE);
    // an earlier version that kept its fingerprints: whatever did not change is copied from it instead of being downloaded again
    let before = null, beforeHashes = {};
    for (const k of await caches.keys()) {
      if (!k.startsWith('pennyworth-phone-') || k === CACHE) continue;
      const oc = await caches.open(k), rec = await oc.match(KEPT);
      if (rec) { before = oc; try { beforeHashes = await rec.json(); } catch { beforeHashes = {}; } break; }
    }
    const todo = list.slice();
    const one = async () => {
      for (let u = todo.shift(); u !== undefined; u = todo.shift()) {
        const h = HASHES[u];
        if (before && h && beforeHashes[u] === h) {
          const hit = await before.match(new Request(u), { ignoreSearch: true });
          if (hit) { await c.put(new Request(u), hit); continue; }
        }
        await c.put(new Request(u), await fetchOk(u));
      }
    };
    await Promise.all([one(), one(), one(), one(), one(), one()]);
    await c.put(KEPT, new Response(JSON.stringify(HASHES), { headers: { 'Content-Type': 'application/json' } }));   // written last: a half-finished download claims nothing
  })());
});
async function fetchOk(u) {
  const r = await fetch(new Request(u, { cache: 'reload' }));
  if (!r.ok) throw new Error(u + ' ' + r.status);
  return r;
}
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
