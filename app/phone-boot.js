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
  const BUILD = '1.72.0';
  // SHAPE says which form the kept answers have. They survive an update (the first start after an update is drawn at once too) as long as the shape is the
  // same; it is raised by hand whenever an answer loses or renames a field (tests/test_phone_answers_170.py fails when that happens without it).
  const SHAPE = 1;
  const staleOff = () => { try { return localStorage.getItem('pw_stale_off') === BUILD; } catch { return false; } };
  const BC = (() => {
    const MAX = 120, MAX_ONE = 300000;
    const SKIP = /^\/api\/(rev|ping|lock|export|backup|update|sheets|pair|phone|local)\b|[?&]wait=/;
    let db = null, map = {}, lockOff = false, dirty = 0;
    const idb = () => new Promise((res, rej) => { try { const q = indexedDB.open('tallomi-boot', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); } catch (e) { rej(e); } });
    const ready = (async () => {
      try {
        db = await idb();
        const rec = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('answers'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
        if (rec && (rec.shape || 1) === SHAPE && rec.lockOff === true && !staleOff()) { map = rec.map || {}; lockOff = true; }
      } catch { db = null; }
    })();
    const save = () => {
      if (!db || dirty) return; dirty = setTimeout(() => {
        dirty = 0;
        const keys = Object.keys(map).sort((a, b) => map[b].t - map[a].t).slice(MAX); keys.forEach((k) => delete map[k]);
        try { db.transaction('kv', 'readwrite').objectStore('kv').put({ build: BUILD, shape: SHAPE, lockOff, map }, 'answers'); } catch { /* full or closed: no cache this time */ }
      }, 900);
    };
    return {
      ready,
      find(path) { return lockOff && map[path] ? map[path] : null; },
      has(path, since) { return !!(lockOff && map[path] && map[path].t >= since); },
      get on() { return lockOff; },
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
  // kept answers drawn by a newer page that cannot read them: drop them for this version and start again the plain way (once)
  const staleBroke = () => {
    if (engineReady || !window.__phoneStale) return;
    try { localStorage.setItem('pw_stale_off', BUILD); } catch { /* no storage: the plain start is all there is */ }
    BC.drop();
    try { if (sessionStorage.getItem('pw_stale_retry')) return; sessionStorage.setItem('pw_stale_retry', '1'); } catch { /* reload at most once more */ }
    location.reload();
  };
  window.addEventListener('error', staleBroke);
  window.addEventListener('unhandledrejection', staleBroke);
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
    if (req.method !== 'GET' && req.method !== 'HEAD' && d.status < 400 && window.__phoneWarm) window.__phoneWarm.wrote();
    return new Response(nullBody ? null : d.body, { status: d.status, headers: d.headers });
  };

  // ---- keeping every page's answers fresh. Answers are only kept for pages that were opened while the program was awake, so the first tap on a page
  // that was not opened since the last change used to wait for the program to start (a few seconds on a phone). Once the program is up and the person has
  // stopped touching the screen, ask for what each page asked for last time (app-prefetch.js keeps that list), one question at a time, so the next cold start
  // finds every page's answer waiting. Questions are only ever reads, and nothing is done while the screen is off or the person is busy.
  const warm = (() => {
    const AGE = 10 * 60 * 1000;                              // an answer younger than this is fresh enough
    let lastTouch = Date.now(), lastWrite = 0, running = false, timer = 0;
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((t) => window.addEventListener(t, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
    const paths = () => {
      let all = {}; try { all = JSON.parse(localStorage.getItem('pw_pf1') || '{}') || {}; } catch { all = {}; }
      const here = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'overview';
      const out = [];
      Object.keys(all).sort((a, b) => (a === here) - (b === here)).forEach((r) => { if (Array.isArray(all[r])) all[r].slice(0, 8).forEach((p) => { if (typeof p === 'string' && p.startsWith('/api/') && !out.includes(p)) out.push(p); }); });
      return out;
    };
    const idle = () => new Promise((res) => { const go = () => { if (document.hidden) setTimeout(go, 3000); else if (Date.now() - lastTouch < 1500) setTimeout(go, 800); else res(); }; go(); });
    async function run() {
      if (running || !engineReady || !BC.on) return;
      running = true;
      try {
        for (const p of paths()) {
          await idle();
          if (BC.has(p, Math.max(Date.now() - AGE, lastWrite))) continue;
          const my = lastWrite;
          try { await window.fetch(p, { headers: { 'X-Pennyworth': '1' } }).then((r) => r.arrayBuffer()); } catch { /* the page asks again the normal way */ }
          if (my !== lastWrite) break;                       // something was written meanwhile: start over later
        }
      } finally { running = false; }
    }
    const later = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
    return { start() { later(2500); }, wrote() { lastWrite = Date.now(); later(20000); }, run };
  })();
  window.__phoneWarm = warm;
  window.__phoneReady.then(() => { setTimeout(() => warm.start(), 0); }).catch(() => {});

  // ---- service worker: keeps the program for offline use. A newer version is downloaded in the background (only what changed); it starts when the person
  // taps the bar, or by itself when the app is put away with nothing open (so the next opening is already on the new version), or at the next start.
  if ('serviceWorker' in navigator) {
    let mine = null;
    const bar = (reg) => {
      if (document.querySelector('.pw-toastbar')) return;
      const t = document.createElement('div'); t.className = 'pw-toastbar'; t.setAttribute('role', 'status');
      const s = document.createElement('span'); s.textContent = 'Tallomi 有新版本了。';
      const b = document.createElement('button'); b.textContent = '立即更新';
      b.onclick = () => { b.disabled = true; reg.waiting && reg.waiting.postMessage('SKIP_WAITING'); };
      t.append(s, b); document.body.append(t);
    };
    const quiet = () => !document.querySelector('dialog[open]') && waiting.size === 0 && !document.querySelector('form:focus-within, input:focus, textarea:focus, select:focus');
    navigator.serviceWorker.register(BASE + 'phone-sw.js', { updateViaCache: 'none' }).then((reg) => {
      mine = reg;
      if (reg.waiting && navigator.serviceWorker.controller) bar(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) bar(reg); });
      });
    }).catch(() => {});
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (!mine) return;
      if (document.hidden) {                                                        // put away: switch now, so the next opening is already on the new version
        if (mine.waiting && navigator.serviceWorker.controller && quiet()) mine.waiting.postMessage('SKIP_WAITING');
      } else if (Date.now() - checked > 20 * 60 * 1000) { checked = Date.now(); mine.update().catch(() => {}); }   // a long-running app asks for news now and then
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !window.__pwHadController) return; reloading = true; location.reload(); });
    window.__pwHadController = !!navigator.serviceWorker.controller;
  }
})();
