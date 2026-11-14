'use strict';
const $ = (id) => document.getElementById(id);
const KEY = 'pw_engine';
// the engines to try, in this order (the last one runs without a background thread)
const TESTS = [
  { id: 'p312', label: 'Python 3.12（Pyodide 0.27.7，較舊）', dir: 'engines/0.27.7/', worker: true },
  { id: 'p313', label: 'Python 3.13（Pyodide 0.29.5）', dir: 'engines/0.29.5/', worker: true },
  { id: 'p314m', label: 'Python 3.14（現用版本，不用背景執行緒）', dir: 'pyodide/', worker: false },
  { id: 'p314w', label: 'Python 3.14（現用版本，背景執行緒；你的 iPhone 上出問題的就是它）', dir: 'pyodide/', worker: true },
];
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { res: {}, running: null, phase: '' }; } catch { return { res: {}, running: null, phase: '' }; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };
let S = load();

// a test that was started but never finished means the page was killed during it
if (S.running) { S.res[S.running] = { r: 'crash', phase: S.phase }; S.running = null; save(S); }

const ua = navigator.userAgent;
const ios = (ua.match(/OS (\d+)[_.](\d+)/) || [])[0];
$('env').textContent = `裝置：${ios ? ios.replace(/_/g, '.') : ua.slice(0, 80)}；${navigator.hardwareConcurrency || '?'} 核心；${matchMedia('(display-mode: standalone)').matches ? '主畫面 App' : '瀏覽器分頁'}`;

function show() {
  const log = $('log'); log.textContent = '';
  for (const t of TESTS) {
    const r = S.res[t.id]; const d = document.createElement('div');
    if (!r) { d.className = 'todo'; d.textContent = `${t.label}　還沒試`; }
    else if (r.r === 'ok') { d.className = 'ok'; d.textContent = `${t.label}　成功　${r.m}（${r.ms} 毫秒）`; }
    else if (r.r === 'crash') { d.className = 'bad'; d.textContent = `${t.label}　被強制關掉　停在：${r.phase || '開始前'}`; }
    else { d.className = 'bad'; d.textContent = `${t.label}　失敗：${r.m}`; }
    log.append(d);
  }
  const left = TESTS.filter((t) => !S.res[t.id]);
  $('go').textContent = Object.keys(S.res).length ? (left.length ? '繼續測試' : '再測一次未成功的') : '開始測試';
  const n = $('next'); n.style.display = Object.keys(S.res).length && left.length ? 'block' : 'none';
  n.textContent = Object.values(S.res).some((r) => r.r === 'crash') ? '上一個測試被強制關掉了，這是正常的。請按「繼續測試」試下一個。' : '';
  if (!n.textContent) n.style.display = 'none';
}

function ask(worker, msg, onPhase) {
  return new Promise((resolve, reject) => {
    worker.addEventListener('message', (ev) => {
      if (ev.data.type === 'phase') onPhase(ev.data.m);
      else if (ev.data.type === 'done') resolve(ev.data.m);
      else if (ev.data.type === 'fail') reject(new Error(ev.data.m));
    });
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'worker error')), { once: true });
    worker.postMessage(msg);
  });
}

async function runMain(dir, onPhase) {
  for (const k of ['compile', 'instantiate', 'instantiateStreaming']) {
    const orig = WebAssembly[k]; if (typeof orig !== 'function') continue;
    WebAssembly[k] = function (...a) { onPhase(`wasm-${k}-start`); return orig.apply(this, a).then((v) => { onPhase(`wasm-${k}-done`); return v; }); };
  }
  onPhase('import');
  const { loadPyodide } = await import(new URL(dir + 'pyodide.mjs', location.href).href);
  onPhase('loadPyodide-start');
  const py = await loadPyodide({ indexURL: new URL(dir, location.href).href });
  onPhase('python-run');
  return `Python ${py.runPython('import sys; sys.version.split()[0]')}，1+1=${py.runPython('1+1')}`;
}

async function runAll() {
  $('go').disabled = true;
  for (const t of TESTS) {
    if (S.res[t.id] && S.res[t.id].r === 'ok') continue;
    if (S.res[t.id] && S.res[t.id].r === 'crash' && !S.again) continue;
    const row = document.createElement('div'); row.className = 'go'; row.textContent = `${t.label}　測試中…`; $('log').append(row);
    S.running = t.id; S.phase = 'start'; save(S);
    const onPhase = (p) => { S.phase = p; save(S); row.textContent = `${t.label}　測試中…（${p}）`; };
    const t0 = performance.now();
    try {
      const m = t.worker ? await (async () => { const w = new Worker('engine-worker.js', { type: 'module' }); try { return await ask(w, { type: 'run', dir: t.dir }, onPhase); } finally { w.terminate(); } })() : await runMain(t.dir, onPhase);
      S.res[t.id] = { r: 'ok', m, ms: Math.round(performance.now() - t0) };
    } catch (e) { S.res[t.id] = { r: 'fail', m: (e && e.message) || String(e) }; }
    S.running = null; save(S); show();
    await new Promise((r) => setTimeout(r, 400));
  }
  S.again = false; save(S); show(); $('go').disabled = false;
  const d = document.createElement('div'); d.className = 'ok'; d.textContent = '測試結束。把這個畫面截圖給我。'; $('log').append(d);
}
$('go').onclick = () => { if (!TESTS.some((t) => !S.res[t.id])) S.again = true; runAll(); };
$('reset').onclick = () => { S = { res: {}, running: null, phase: '' }; save(S); show(); };
show();
