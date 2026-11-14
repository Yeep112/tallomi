'use strict';
const $ = (id) => document.getElementById(id);
const KEY = 'pw_check';
const log = $('log');
const note = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; log.append(d); return d; };
const mark = (o) => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ t: Date.now() }, o))); } catch { /* storage blocked */ } };
const ms = (t0) => Math.round(performance.now() - t0) + ' 毫秒';

// what the last run left behind
try {
  const last = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (last && !last.done) {
    const p = $('prev'); p.style.display = 'block';
    p.textContent = `上次檢查停在：「${last.step}」，而且沒有跑完（${new Date(last.t).toLocaleTimeString('zh-TW')}）。網頁很可能就是在這一步被強制關掉的，請把這句話告訴我。`;
  } else if (last && last.done) {
    const p = $('prev'); p.style.display = 'block'; p.style.background = '#16402A';
    p.textContent = `上次檢查完整跑完了（${new Date(last.t).toLocaleTimeString('zh-TW')}）。`;
  }
} catch { /* ignore */ }

const ua = navigator.userAgent;
const ios = (ua.match(/OS (\d+)[_.](\d+)/) || [])[0];
$('env').textContent = `裝置：${ios ? ios.replace(/_/g, '.') : ua.slice(0, 80)}；螢幕 ${screen.width}×${screen.height}；${navigator.hardwareConcurrency || '?'} 核心；${navigator.onLine ? '有網路' : '沒有網路'}；${matchMedia('(display-mode: standalone)').matches ? '主畫面 App' : '瀏覽器分頁'}`;

async function step(name, fn) {
  mark({ step: name, done: false });
  const row = note('go', name);
  const t0 = performance.now();
  try { const extra = await fn(); row.className = 'ok'; row.textContent = `${name}　${ms(t0)}${extra ? '　' + extra : ''}`; return true; }
  catch (e) { row.className = 'bad'; row.textContent = `${name}　失敗：${(e && e.message) || e}`; return false; }
}

function ask(worker, msg) {
  return new Promise((resolve, reject) => {
    const on = (ev) => { if (ev.data.type === 'done') { worker.removeEventListener('message', on); resolve(ev.data); } else if (ev.data.type === 'fail') { worker.removeEventListener('message', on); reject(new Error(ev.data.m)); } };
    worker.addEventListener('message', on);
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'worker error')), { once: true });
    worker.postMessage(msg);
  });
}

async function run(full) {
  log.textContent = ''; $('go').disabled = $('go2').disabled = true;
  await step('1 基本網頁與儲存空間', async () => {
    await new Promise((res, rej) => { const q = indexedDB.open('pw-check', 1); q.onupgradeneeded = () => q.result.createObjectStore('s'); q.onsuccess = () => { q.result.close(); res(); }; q.onerror = () => rej(q.error); });
    return 'IndexedDB 正常';
  });
  await step('2 離線快取功能', async () => `Service Worker：${'serviceWorker' in navigator ? '有' : '沒有'}；Cache：${window.caches ? '有' : '沒有'}；Web Locks：${navigator.locks ? '有' : '沒有'}`);
  await step('3 背景執行緒（Worker）', async () => {
    const w = new Worker('check-worker.js', { type: 'module' });
    const r = await ask(w, { type: 'hello' }); w.terminate(); return r.m;
  });
  let size = 0;
  await step('4 下載 Python 核心（約 9 MB）', async () => {
    const r = await fetch('pyodide/pyodide.asm.wasm', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    size = (await r.arrayBuffer()).byteLength; return `${(size / 1048576).toFixed(1)} MB`;
  });
  const w = new Worker('check-worker.js', { type: 'module' });
  const okCompile = await step('5 讓手機「編譯」Python 核心（最吃記憶體的一步）', async () => (await ask(w, { type: 'compile' })).m);
  if (okCompile && full) {
    await step('6 啟動 Python', async () => (await ask(w, { type: 'pyodide' })).m);
    await step('7 載入 Tallomi 需要的套件', async () => (await ask(w, { type: 'packages' })).m);
  }
  w.terminate();
  mark({ step: '全部完成', done: true });
  note('ok', '檢查結束。把這個畫面截圖給我。');
  $('go').disabled = $('go2').disabled = false;
}
$('go').onclick = () => run(true);
$('go2').onclick = () => run(false);
