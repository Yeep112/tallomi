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

  const real = window.fetch.bind(window);
  window.fetch = async (input, opt = {}) => {
    const req = new Request(input, opt);                  // lets the browser turn a form / blob / text body into bytes and headers for us
    const url = new URL(req.url);
    if (url.origin !== location.origin || !/\/api\//.test(url.pathname)) return real(input, opt);
    await window.__phoneReady;
    const path = url.pathname.slice(url.pathname.indexOf('/api/')) + url.search;
    const body = ['GET', 'HEAD'].includes(req.method) ? null : new Uint8Array(await req.arrayBuffer());
    const hdrs = {}; req.headers.forEach((v, k) => { hdrs[k] = v; });
    const id = ++n;
    const reply = new Promise((res) => waiting.set(id, res));
    worker.postMessage({ id, method: req.method, path, headers: hdrs, body });
    const d = await reply;
    const nullBody = [101, 204, 205, 304].includes(d.status);
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
