// Tallomi phone version, page side: starts the worker, answers fetch('/api/...') through it, shows the start-up screen,
// and registers the service worker (offline use + new versions).
(() => {
  const BASE = new URL('./', document.currentScript.src).href;
  window.PW_PHONE = true;
  document.documentElement.classList.add('phone');

  // this script runs in <head>, before the page body exists: look the start-up screen up only when it is needed
  const getSplash = () => document.getElementById('boot-splash');
  const worker = new Worker(BASE + 'phone-worker.js', { type: 'module' });
  let n = 0;
  const waiting = new Map();
  let settle;
  window.__phoneReady = new Promise((res, rej) => { settle = { res, rej }; });
  window.__phoneReady.catch(() => {});

  const fail = (msg) => {
    const splash = getSplash();
    if (!splash) { document.addEventListener('DOMContentLoaded', () => fail(msg), { once: true }); return; }
    splash.replaceChildren();
    const box = (t, s) => { const e = document.createElement(t); e.textContent = s; return e; };
    splash.append(box('b', 'Tallomi'));
    if (msg === 'BUSY') {
      splash.append(box('p', 'Tallomi 已經在另一個視窗（或另一個分頁）開著。一次只能開一個，才不會把帳本互相蓋掉。請回到那個視窗，或把它關掉再重試。'));
    } else {
      splash.append(box('p', '這個瀏覽器無法啟動 Tallomi：' + msg + '。請改用較新的 Safari 或 Chrome，並確認沒有開「無痕」模式。'));
    }
    const b = box('button', '重試'); b.onclick = () => location.reload(); splash.append(b);
  };

  worker.addEventListener('error', (e) => { settle.rej(new Error(e.message || 'worker')); fail(e.message || 'worker'); });
  worker.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d.type === 'stage') { const st = getSplash() && getSplash().querySelector('.stage'); if (st) st.textContent = d.m; }
    else if (d.type === 'ready') {
      settle.res();
      const rm = () => { const sp = getSplash(); if (sp) sp.remove(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rm, { once: true }); else rm();
    }
    else if (d.type === 'error') { settle.rej(new Error(d.m)); fail(d.m); }
    else if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  });
  fetch(BASE + 'wheels.json').then((r) => r.json()).then((wheels) => worker.postMessage({ type: 'init', wheels })).catch((e) => fail(String(e)));

  // ---- last-seen answers. The program takes a few seconds to wake up on a phone; meanwhile the page can already be drawn from the
  // answers it got last time (a thin bar says they are being refreshed). Only reads are ever answered this way, only while the
  // program is still starting, and never for a book with a PIN lock (a locked book must not show its numbers before the PIN).
  const BUILD = '1.67.0';
  const BC = (() => {
    const MAX = 40, MAX_ONE = 300000;
    const SKIP = /^\/api\/(rev|ping|lock|export|backup|update|sheets|pair|phone|local)\b|[?&]wait=/;
    let db = null, map = {}, lockOff = false, dirty = 0;
    const idb = () => new Promise((res, rej) => { try { const q = indexedDB.open('tallomi-boot', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); } catch (e) { rej(e); } });
    const ready = (async () => {
      try {
        db = await idb();
        const rec = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('answers'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
        if (rec && rec.build === BUILD && rec.lockOff === true) { map = rec.map || {}; lockOff = true; }
      } catch { db = null; }
    })();
    const save = () => {
      if (!db || dirty) return; dirty = setTimeout(() => {
        dirty = 0;
        const keys = Object.keys(map).sort((a, b) => map[b].t - map[a].t).slice(MAX); keys.forEach((k) => delete map[k]);
        try { db.transaction('kv', 'readwrite').objectStore('kv').put({ build: BUILD, lockOff, map }, 'answers'); } catch { /* full or closed: no cache this time */ }
      }, 900);
    };
    return {
      ready,
      find(path) { return lockOff && map[path] ? map[path] : null; },
      keep(path, status, headers, body) {                              // every successful read the program gives
        const ct = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
        if (status !== 200 || !db || SKIP.test(path) || body.length > MAX_ONE || !/json/.test((ct && headers[ct]) || '')) return;
        if (path === '/api/state') {
          let j = null; try { j = JSON.parse(body); } catch { /* not json */ }
          lockOff = !!(j && j.lock && j.lock.enabled === false);
          if (!lockOff) { map = {}; save(); return; }                   // a PIN lock is on: nothing of this book is kept in the clear
        }
        if (!lockOff) return;
        map[path] = { b: body, t: Date.now() }; save();
      },
      drop() { map = {}; lockOff = false; save(); },
    };
  })();
  let engineReady = false;
  window.__phoneStale = 0;
  window.__phoneReady.then(() => { engineReady = true; }).catch(() => {});

  const real = window.fetch.bind(window);
  window.fetch = async (input, opt = {}) => {
    const req = new Request(input, opt);                  // lets the browser turn a form / blob / text body into bytes and headers for us
    const url = new URL(req.url);
    if (url.origin !== location.origin || !/\/api\//.test(url.pathname)) return real(input, opt);
    const path = url.pathname.slice(url.pathname.indexOf('/api/')) + url.search;
    if (!engineReady && req.method === 'GET') {
      await BC.ready;
      const hit = BC.find(path);
      if (hit) { window.__phoneStale++; return new Response(hit.b, { status: 200, headers: { 'content-type': 'application/json', 'x-tallomi-stale': '1' } }); }
    }
    await window.__phoneReady;
    const body = ['GET', 'HEAD'].includes(req.method) ? null : new Uint8Array(await req.arrayBuffer());
    const hdrs = {}; req.headers.forEach((v, k) => { hdrs[k] = v; });
    const id = ++n;
    const reply = new Promise((res) => waiting.set(id, res));
    worker.postMessage({ id, method: req.method, path, headers: hdrs, body });
    const d = await reply;
    const nullBody = [101, 204, 205, 304].includes(d.status);
    if (req.method === 'GET' && d.status === 200) { try { BC.keep(path, d.status, d.headers || {}, new TextDecoder().decode(d.body)); } catch { /* not text */ } }
    else if (req.method === 'PUT' && /^\/api\/lock\b/.test(path) && d.status < 400) BC.drop();
    return new Response(nullBody ? null : d.body, { status: d.status, headers: d.headers });
  };

  // ---- service worker: keeps the program for offline use; a newer version waits until the person agrees
  if ('serviceWorker' in navigator) {
    const bar = (reg) => {
      if (document.querySelector('.pw-toastbar')) return;
      const t = document.createElement('div'); t.className = 'pw-toastbar'; t.setAttribute('role', 'status');
      const s = document.createElement('span'); s.textContent = 'Tallomi 有新版本了。';
      const b = document.createElement('button'); b.textContent = '立即更新';
      b.onclick = () => { b.disabled = true; reg.waiting && reg.waiting.postMessage('SKIP_WAITING'); };
      t.append(s, b); document.body.append(t);
    };
    navigator.serviceWorker.register(BASE + 'phone-sw.js', { updateViaCache: 'none' }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) bar(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) bar(reg); });
      });
    }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !window.__pwHadController) return; reloading = true; location.reload(); });
    window.__pwHadController = !!navigator.serviceWorker.controller;
  }
})();
