'use strict';
/* The owner's phone while the computer is not running (1.63.0; settings → 電腦沒開也能用).
   The phone keeps a copy of the book and this same program (run by Pyodide in local-worker.js). Normally every request goes to the computer.
   When the computer cannot be reached, the page switches to the copy by itself: the program opens and works as usual (adding, changing and
   deleting entries, reports, rates and prices over the phone's own network). Syncing to the computer is paused. Every change made on the copy is
   written to a log; when the computer is back the log is sent to it one entry at a time and the page returns to the computer by itself.
   Only functions and constants here (plus the fetch hook at the bottom); nothing touches `S` until a page is drawn. */
const LOC_FLAG = 'pw_local';
const LOC_ASKED = 'pw_local_asked';
const LOC_CACHE = 'tallomi-engine';                  // the runtime files (from the public phone site), kept for use with no network
const LOC_SHELL = 'tallomi-offline';                 // the page itself (the service worker keeps it as new as the program)
const LOC = { mode: 'pc', worker: null, ready: null, n: 0, waiting: new Map(), db: null, rev: 0, bypass: false, entering: null, returning: false,
  syncing: false, lastTry: 0, down: 0, problems: 0, pending: 0, error: '', warm: '' };
const locOn = () => lsGet(LOC_FLAG) === '1';
// When the phone last found the computer away. A start-up soon after goes straight for the copy: the copy is started while the first question
// to the computer is still on its way, and a slow answer counts as "away" sooner. (localStorage is read directly: this file runs before app.js.)
const LOC_HINT = 'pw_loc_down', LOC_HINT_MS = 10 * 60 * 1000;
const locHintSet = (on) => {
  try { if (on) localStorage.setItem(LOC_HINT, String(Date.now())); else localStorage.removeItem(LOC_HINT); } catch { /* storage unavailable */ }
  try { if (window.caches) caches.open(LOC_SHELL).then((c) => (on ? c.put('/__away', new Response(String(Date.now()))) : c.delete('/__away'))).catch(() => {}); } catch { /* no cache storage */ }   // the service worker opens the page sooner with it
};
const locHint = () => { try { const t = Number(localStorage.getItem(LOC_HINT)) || 0; return t && Date.now() - t < LOC_HINT_MS ? t : 0; } catch { return 0; } };
const locRealFetch = window.fetch.bind(window);
LOC.down = locHint();

// ------------------------------------------------------------------ storage on the phone (separate from the old offline mode)
function locOpen() {
  if (LOC.db) return Promise.resolve(LOC.db);
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('這個瀏覽器不支援')); return; }
    const q = indexedDB.open('tallomi-local', 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('kv', { keyPath: 'k' });
      q.result.createObjectStore('journal', { keyPath: 'seq', autoIncrement: true });
      q.result.createObjectStore('problems', { keyPath: 'seq', autoIncrement: true });
    };
    q.onsuccess = () => { LOC.db = q.result; resolve(q.result); };
    q.onerror = () => reject(q.error || new Error('無法開啟手機上的儲存空間'));
  });
}
async function locTx(store, mode, fn) {
  const db = await locOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const kvGet = async (k) => { const r = await locTx('kv', 'readonly', (s) => s.get(k)); return r ? r.v : null; };
const kvPut = (k, v) => locTx('kv', 'readwrite', (s) => s.put({ k, v }));
const kvDel = (k) => locTx('kv', 'readwrite', (s) => s.delete(k));
const locJournal = async () => (await locTx('journal', 'readonly', (s) => s.getAll())).sort((a, b) => a.seq - b.seq);
const locProblems = () => locTx('problems', 'readonly', (s) => s.getAll());
async function locCounts() {
  try { LOC.pending = (await locJournal()).length; LOC.problems = (await locProblems()).length; } catch { /* storage unavailable */ }
  updateLocBar();
}

// ---------------------------------------------------------- what may be done while the computer is away
// 'log'   a change to entries, accounts, categories, templates, bills, recurring rules: done on the copy and written to the log, sent to the computer later
// 'local' only meaningful on this phone (colours, rates, prices, the lock): done on the copy, never sent
// else    not available until the computer is back (photos, imports, backups, Google Sheets ...)
const LOC_LOG = [['POST', /^\/api\/transactions$/], ['PUT', /^\/api\/transactions\/\d+$/], ['DELETE', /^\/api\/transactions\/\d+$/], ['POST', /^\/api\/transactions\/bulk$/],
  ['POST', /^\/api\/advances\/\d+\/(settle|write-off|reopen)$/], ['POST', /^\/api\/advances\/delete$/], ['POST', /^\/api\/undo$/],
  ['POST', /^\/api\/accounts$/], ['PUT', /^\/api\/accounts\/order$/], ['PUT', /^\/api\/accounts\/\d+$/], ['DELETE', /^\/api\/accounts\/\d+$/], ['POST', /^\/api\/accounts\/\d+\/(calibrate|reset)$/],
  ['POST', /^\/api\/categories$/], ['PUT', /^\/api\/categories$/], ['DELETE', /^\/api\/categories$/], ['PUT', /^\/api\/budgets$/], ['PUT', /^\/api\/category-icons$/],
  ['POST', /^\/api\/icon-library$/], ['DELETE', /^\/api\/icon-library$/],
  ['POST', /^\/api\/templates$/], ['PUT', /^\/api\/templates\/order$/], ['PUT', /^\/api\/templates\/\d+$/], ['DELETE', /^\/api\/templates\/\d+$/],
  ['POST', /^\/api\/inbox(\/remove|\/clear)?$/], ['POST', /^\/api\/bills$/], ['PUT', /^\/api\/bills\/\d+$/], ['DELETE', /^\/api\/bills\/\d+$/],
  ['POST', /^\/api\/recurring$/], ['PUT', /^\/api\/recurring\/\d+$/], ['DELETE', /^\/api\/recurring\/\d+$/], ['POST', /^\/api\/recurring\/\d+\/active$/],
  ['PUT', /^\/api\/cat-rules$/], ['POST', /^\/api\/cat-rules\/apply$/], ['POST', /^\/api\/frequent\/(hide|restore)$/],
  ['POST', /^\/api\/exchange$/], ['POST', /^\/api\/invest\/trades$/], ['PUT', /^\/api\/invest\/trades\/\d+$/], ['POST', /^\/api\/invest\/trades\/delete$/], ['DELETE', /^\/api\/invest\/trades\/\d+$/],
  ['POST', /^\/api\/invest\/securities$/], ['PUT', /^\/api\/invest\/securities\/\d+$/], ['DELETE', /^\/api\/invest\/securities\/\d+$/], ['PUT', /^\/api\/invest\/settings$/]];
const LOC_SETTINGS = ['ui_color', 'ui_hide', 'ui_hide_pages', 'count_transfers', 'home_layout', 'tile_order'];     // the look of the app: these settings can be changed while away
const LOC_LOCAL = [['POST', /^\/api\/lock\/(unlock|unlock-biometric|lock)$/], ['PUT', /^\/api\/rates$/], ['POST', /^\/api\/rates\/refresh$/], ['PUT', /^\/api\/fx\/rates$/],
  ['POST', /^\/api\/fx\/fetch$/], ['POST', /^\/api\/market\/refresh$/], ['POST', /^\/api\/invest\/fetch$/], ['PUT', /^\/api\/invest\/price$/], ['POST', /^\/api\/cat-rules\/preview$/],
  ['POST', /^\/api\/export(\/tag)?$/]];
const locHit = (list, method, path) => list.some(([m, re]) => m === method && re.test(path));
function locPolicy(method, path, data) {
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (locHit(LOC_LOG, method, path)) return 'log';
  if (locHit(LOC_LOCAL, method, path)) return 'local';
  if (method === 'PUT' && path === '/api/settings' && data && typeof data === 'object' && Object.keys(data).length && Object.keys(data).every((k) => LOC_SETTINGS.includes(k))) return 'log';       // colours, hidden pages, tile order, home layout
  return 'block';
}
const LOC_BLOCKED = '電腦沒有開啟時，這項要等電腦連線後再做。目前可以：記帳、修改或刪除交易、新增帳戶／類別／範本、換匯、投資買賣、代墊收款、看報表、更新匯率與股價。';

// -------------------------------------------------------------------------- the engine on the phone
async function locStart(install) {
  if (LOC.worker) return LOC.ready;
  if (LOC.starting) return LOC.starting;                                          // started a moment ago by the warm-up: one copy only (two would fight over the book)
  LOC.starting = locStart1(install).finally(() => { LOC.starting = null; });
  return LOC.starting;
}
async function locStart1(install) {
  const cfg = await kvGet('cfg'), engine = await kvGet('engine');
  if (!cfg || !engine) throw new Error('手機上還沒有準備好帳本副本（要在連上電腦時先備妥）');
  const w = new Worker('static/local-worker.js?v=' + PW_BUILD, { type: 'module' });             // the build in the address: the service worker answers it from the phone at once
  LOC.worker = w;
  LOC.ready = new Promise((resolve, reject) => {
    w.addEventListener('error', (e) => { LOC.worker = null; reject(new Error(e.message || '手機上的程式無法啟動')); });
    w.addEventListener('message', (ev) => {
      const d = ev.data;
      if (d.type === 'stage') { if (LOC.mode === 'entering') setLocVeil(d.m); }
      else if (d.type === 'ready') resolve();
      else if (d.type === 'error') { LOC.worker = null; reject(new Error(d.m === 'BUSY' ? 'Tallomi 已經在另一個視窗開著，請先關掉那個視窗' : d.m)); }
      else if (d.id && LOC.waiting.has(d.id)) { LOC.waiting.get(d.id)(d); LOC.waiting.delete(d.id); }
    });
    w.postMessage({ type: 'init', runtime: cfg.runtime, wheels: cfg.wheels, engine: engine.bytes, install: install || null, bio: lsGet('pw_local_bio') === '1' && !!lsGet('pw_bio_cred'), recurring: lsGet('pw_local_recur') === '1' });
  });
  LOC.ready.catch(() => {});
  return LOC.ready;
}
function locStop() {
  if (LOC.worker) { try { LOC.worker.terminate(); } catch { /* gone */ } }
  LOC.worker = null; LOC.ready = null; LOC.starting = null; LOC.waiting.clear();
}
async function locAsk(method, path, headers, body) {
  await LOC.ready;
  const id = ++LOC.n;
  const reply = new Promise((res) => LOC.waiting.set(id, res));
  LOC.worker.postMessage({ id, method, path, headers, body });
  return reply;
}
// Wipe the copy's database (after its log was sent): the next time the computer is away a fresh snapshot is installed.
function locWipeDb() { return new Promise((res) => { const q = indexedDB.deleteDatabase('/data'); q.onsuccess = q.onerror = q.onblocked = () => res(); }); }

// Entries the copy made by itself (due recurring entries, a payback, a balance correction) are not in the log, so the computer does not know their numbers:
// changing one of them could change a different entry there. Those wait until the computer is back.
async function locTouchesAutoMade(method, path, data) {
  let ids = [];
  const m = /^\/api\/(?:transactions|advances)\/(\d+)$/.exec(path);
  if (m && method !== 'POST') ids = [Number(m[1])];
  else if (/^\/api\/(transactions\/bulk|advances\/delete)$/.test(path) && data && Array.isArray(data.ids)) ids = data.ids.map(Number);
  else if (/^\/api\/advances\/\d+\/(settle|write-off|reopen)$/.test(path)) ids = [Number(path.split('/')[3])];
  if (!ids.length) return false;
  const max = (await kvGet('dbmax')) || 0;
  const made = new Set();
  for (const j of await locJournal()) { if (j.method !== 'POST' || !j.res) continue; if (j.path === '/api/transactions' || j.path === '/api/exchange') made.add(j.res.id); if (j.res.tx_id != null) made.add(j.res.tx_id); }
  return ids.some((id) => id > max && !made.has(id));
}

// --------------------------------------------------------------- the page's own fetch() while the copy is in use
const locIsApi = (u) => u.origin === location.origin && u.pathname.startsWith('/api/');
async function locFetch(input, opt) {
  const req = new Request(input, opt), url = new URL(req.url);
  const path = url.pathname + url.search, method = req.method;
  if (url.pathname === '/api/rev') {                                               // the copy has no other windows: nothing to wait for
    return new Response(JSON.stringify({ rev: LOC.rev, waited: false, build: PW_BUILD, version: S.st ? S.st.version : '' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const isJson = (req.headers.get('content-type') || '').includes('json');
  let bytes = ['GET', 'HEAD'].includes(method) ? null : new Uint8Array(await req.arrayBuffer());
  let data = null;
  if (bytes && bytes.length && isJson) { try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { data = null; } }
  const policy = locPolicy(method, url.pathname, data);
  const err = (msg, status = 403) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } });
  if (policy === 'block' || (bytes && bytes.length && !isJson && policy !== 'local')) return err(LOC_BLOCKED);
  if (policy === 'log' && await locTouchesAutoMade(method, url.pathname, data)) return err('這筆是手機自動產生的（定期交易、還款或校正），電腦回來後再修改。');
  if (policy === 'log' && method === 'POST' && url.pathname === '/api/transactions' && data && typeof data === 'object') {
    if (!data.client_id) data.client_id = newClientId();                           // the computer never records the same entry twice
    if (!data.time) data.time = nowLocal().slice(0, 16);                           // the moment it was recorded, not the moment it reaches the computer
    bytes = new TextEncoder().encode(JSON.stringify(data));
  }
  const headers = {}; req.headers.forEach((v, k) => { headers[k] = v; });
  const d = await locAsk(method, path, headers, bytes);
  const rh = d.headers || {}, revH = rh['X-Rev'] || rh['x-rev'];
  if (revH && Number(revH) > LOC.rev) LOC.rev = Number(revH);
  const text = new TextDecoder().decode(d.body);
  if (policy === 'log' && d.status < 400) {
    let res = null; try { res = JSON.parse(text); } catch { res = null; }
    if (url.pathname === '/api/undo') {                                            // an undone change is simply not sent
      const tok = data && data.token;
      if (tok) { for (const it of await locJournal()) if (it.res && it.res.undo === tok) await locTx('journal', 'readwrite', (s) => s.delete(it.seq)); }
    } else {
      await locTx('journal', 'readwrite', (s) => s.add({ method, path: url.pathname, body: data, res, at: nowLocal().slice(0, 16) }));
    }
    await locCounts();
  }
  const nullBody = [101, 204, 205, 304].includes(d.status);
  return new Response(nullBody ? null : d.body, { status: d.status, headers: d.headers });
}
window.fetch = (input, opt) => {
  try {
    if ((LOC.mode === 'local' && !LOC.bypass) || LOC.mode === 'entering') {
      const u = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (locIsApi(u)) return locFetch(input, opt);
    }
  } catch { /* fall through to the network */ }
  return locRealFetch(input, opt);
};

// ----------------------------------------------------------------------- going over to the copy, and back
// Start the copy now, without telling anyone, when it will probably be needed (it takes a few seconds to wake). If the computer turns out to be
// there after all, the copy is stopped again (locGuard); if it is away, locEnter takes the copy over and only has to wait for what is left.
async function locPrewarm() {
  if (LOC.worker || LOC.mode !== 'pc' || !locOn() || LOC.pcOk) return;
  try {
    const journal = await locJournal(), snap = await kvGet('snap');
    if (LOC.worker || LOC.pcOk || (!journal.length && !snap)) return;
    LOC.warmOnly = true;
    await locStart(journal.length ? null : snap.bytes);
  } catch { if (LOC.warmOnly) { locStop(); LOC.warmOnly = false; } }
}
document.addEventListener('DOMContentLoaded', () => { if (locOn() && locHint() && navigator.onLine !== false) locPrewarm(); });
async function locConfirmDown() {                                                  // a slow answer is not the same as a computer that is off
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), Date.now() - (LOC.silentAt || 0) < 10000 ? 1200 : 3000);       // two questions went unanswered already: a short look is enough
    const r = await locRealFetch('/api/ping', { cache: 'no-store', signal: ac.signal }); clearTimeout(t);
    return r.status >= 500;
  } catch { return true; }
}
async function locEnter() {
  if (LOC.mode === 'local') return true;
  if (LOC.entering) return LOC.entering;
  LOC.entering = (async () => {
    locPrewarm().catch(() => {});                                                  // the copy wakes up while the computer is asked
    if (!(await locConfirmDown())) { if (LOC.warmOnly) { locStop(); LOC.warmOnly = false; } return false; }
    LOC.warmOnly = false; LOC.error = '';
    try {
      const journal = await locJournal();
      const snap = await kvGet('snap');
      if (!journal.length && !snap) throw new Error('手機上還沒有帳本副本');
      LOC.mode = 'entering';
      setLocVeil('電腦沒有開啟，正在改用手機上的帳本…');
      if (!journal.length) await kvPut('dbmax', snap.maxTx || 0);                  // entries numbered above this were made by the copy itself
      await locStart(journal.length ? null : snap.bytes);                          // a log is waiting: carry on with the copy that holds those changes
      LOC.rev = 0; S.rev = null; LOC.mode = 'local';
      await locCounts(); locProbe(); locHintSet(true);
      setTimeout(() => { if (typeof refresh === 'function') refresh().catch(() => {}); }, 0);
      return true;
    } catch (e) {
      LOC.mode = 'pc'; locStop(); LOC.error = e.message || String(e);
      return false;
    } finally { setLocVeil(null); LOC.entering = null; }
  })();
  return LOC.entering;
}
// called by api(): a request that could not reach the computer gets answered by the copy, if there is one
async function locGuard(method, path, body, isForm) {
  if (!locOn() || LOC.mode !== 'pc' || LOC.bypass) return apiNet(method, path, body, isForm);
  const computerAnswered = () => {                                                  // it is there: the note that it was away is out of date, and a warmed-up copy is not needed
    LOC.pcOk = true;
    if (LOC.down) { LOC.down = 0; locHintSet(false); }
    if (LOC.warmOnly && !LOC.entering) { locStop(); LOC.warmOnly = false; }
  };
  try { const r = await apiNet(method, path, body, isForm); computerAnswered(); return r; }
  catch (e) {
    if (!e || !e.network) { computerAnswered(); throw e; }
    LOC.down = Date.now();
    if (!(await locEnter())) throw e;
    return apiNet(method, path, body, isForm);
  }
}
// A question that was left unanswered a moment ago (the first page's own, see app-prefetch.js) already used up the waiting: the next one gets only a short look.
const locSlow = () => (Date.now() - (LOC.silentAt || 0) < 10000 ? 800 : Date.now() - LOC.down < LOC_HINT_MS ? 1800 : 7000);
function locNoteSilent() { LOC.silentAt = LOC.down = Date.now(); locPrewarm().catch(() => {}); }                // how long a read may take before the computer counts as away

let locProbing = false;
function locProbe() {
  if (locProbing) return;
  locProbing = true;
  (async function tick() {
    try {
      if (LOC.mode !== 'local' || LOC.returning) { locProbing = false; return; }
      if (document.visibilityState === 'visible') {
        let up = false;
        try { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 3500); const r = await locRealFetch('/api/ping', { cache: 'no-store', signal: ac.signal }); clearTimeout(t); up = r.status < 500; } catch { up = false; }
        if (up) { locProbing = false; await locReturn(); if (LOC.mode === 'local') locProbe(); else locHintSet(false); return; }
        locHintSet(true);
      }
    } catch { /* keep trying */ }
    setTimeout(tick, 4000);
  })();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && LOC.mode === 'local') { locProbing = false; locProbe(); } });
window.addEventListener('online', () => { if (LOC.mode === 'local') { locProbing = false; locProbe(); } updateLocBar(); });
window.addEventListener('offline', () => updateLocBar());

// Numbers made on the copy (new entries, accounts, templates...) differ from the computer's: the computer's answer to each creation is remembered, and later
// changes that mention that number are redirected. Each kind of thing has its own list of numbers.
const LOC_KIND = { transactions: 'tx', advances: 'tx', accounts: 'acc', templates: 'tpl', bills: 'bill', recurring: 'rec', exchange: 'tx' };
// What kind of thing a path is about, and the path's own number (if it has one): /api/transactions/7, /api/invest/trades/3 ...
function locPathInfo(path) {
  let m = /^\/api\/invest\/(trades|securities)(?:\/(\d+))?/.exec(path);
  if (m) return { kind: m[1] === 'trades' ? 'trade' : 'acc', id: m[2] ? Number(m[2]) : null, head: path.slice(0, m[0].length - (m[2] ? m[2].length + 1 : 0)) };
  m = /^\/api\/([a-z]+)(?:\/(\d+))?/.exec(path);
  return m ? { kind: LOC_KIND[m[1]] || null, id: m[2] ? Number(m[2]) : null, head: '/api/' + m[1] } : { kind: null, id: null, head: path };
}
function locRemap(maps, entry) {
  const m = (kind, id) => (maps[kind] && maps[kind][id] != null ? maps[kind][id] : id);
  const info = locPathInfo(entry.path), own = info.kind;
  const path = info.id != null ? entry.path.replace(new RegExp(`^${info.head.replace(/\//g, '\\/')}\\/${info.id}`), `${info.head}/${m(own, info.id)}`) : entry.path;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k], k); return o; }
    if (typeof v !== 'number') return v;
    if (key === 'ids' || key === 'tx_ids') return m(own, v);
    if (key === 'settle_of' || key === 'tx_id') return m('tx', v);
    if (/account/i.test(key || '')) return m('acc', v);
    return v;
  };
  return { path, body: entry.body && typeof entry.body === 'object' ? walk(entry.body, '') : entry.body };
}
// Send what was logged on the copy to the computer, then go back to it. Also runs when the app is opened with the computer up and a log still waiting.
async function locReplay() {
  if (LOC.returning || !locOn()) return;
  LOC.returning = true; LOC.bypass = true;
  setLocVeil('電腦已連線，正在補送手機上記下的變更…');
  let sent = 0, bad = 0, away = false;
  try {
    const maps = (await kvGet('idmaps')) || {};
    for (const it of await locJournal()) {
      const { path, body } = locRemap(maps, it);
      try {
        const r = await apiNetGo(it.method, path, body);
        const info = locPathInfo(it.path), kind = it.method === 'POST' && info.id == null && /^\/api\/(transactions|accounts|templates|bills|recurring|exchange|invest\/trades|invest\/securities)$/.test(it.path) ? info.kind : null;
        if (kind && it.res && it.res.id != null && r && r.id != null) { (maps[kind] = maps[kind] || {})[it.res.id] = r.id; }
        if (kind === 'trade' && it.res && it.res.tx_id != null && r && r.tx_id != null) (maps.tx = maps.tx || {})[it.res.tx_id] = r.tx_id;        // the transfer a trade writes
        await kvPut('idmaps', maps);
        sent += 1;
      } catch (e) {
        if (e && e.network) { away = true; break; }
        bad += 1;
        await locTx('problems', 'readwrite', (s) => s.add({ method: it.method, path: it.path, body: it.body, error: (e && e.message) || '電腦沒收', at: it.at }));
      }
      await locTx('journal', 'readwrite', (s) => s.delete(it.seq));
    }
    if (!away) {
      await kvDel('idmaps'); locStop(); await locWipeDb();
      LOC.mode = 'pc'; S.rev = null;
      toast(sent || bad ? `電腦已連線，補送了 ${sent} 筆變更${bad ? `，${bad} 筆電腦沒收（設定頁可查看）` : ''}，已回到同步` : '電腦已連線，已回到同步', bad > 0);
    }
  } catch (e) { away = true; }
  finally {
    LOC.bypass = false; LOC.returning = false; setLocVeil(null);
    await locCounts();
    if (LOC.mode === 'pc' && !away) { try { await refresh(); } catch (e) { fail(e); } locSyncCopy(true); }
  }
}
const locReturn = () => (LOC.mode === 'local' ? locReplay() : Promise.resolve());

// ------------------------------------------------------------ keeping the copy fresh (while the computer can be reached)
async function locWarm(runtime) {
  if (!window.caches) throw new Error('這個瀏覽器不支援');
  const c = await caches.open(LOC_CACHE);
  const list = (await (await locRealFetch(runtime + 'precache.json', { cache: 'no-store' })).json()).filter((u) => /^\.\/(pyodide|wheels)\//.test(u));
  const names = (await (await locRealFetch(runtime + 'wheels.json', { cache: 'no-store' })).json());
  let done = 0;
  for (const u of list) {
    const abs = new URL(u, runtime).href;
    if (!(await c.match(abs, { ignoreVary: true }))) {
      LOC.warm = `下載執行環境 ${done + 1}／${list.length}…`; updateLocStatus();
      const r = await locRealFetch(new Request(abs, { mode: 'cors', cache: 'reload' }));
      if (!r.ok) throw new Error('下載失敗：' + u);
      await c.put(abs, r);
    }
    done += 1;
  }
  LOC.warm = '';
  try { await locRealFetch('static/local-worker.js?v=' + PW_BUILD); } catch { /* the first start online keeps it */ }       // the copy of the program that the worker is started from
  return names;
}
async function locSyncCopy(force) {
  if (!locOn() || LOC.mode !== 'pc' || LOC.syncing || !S.st || !S.st.remote) return;
  const snap = await kvGet('snap').catch(() => null);
  const stale = !snap || snap.version !== S.st.version || (S.rev || 0) > snap.rev;
  if (!stale && !force) return;
  if (snap && !force && Date.now() - LOC.lastTry < 60000) return;
  LOC.syncing = true; LOC.lastTry = Date.now();
  try {
    const hdr = { 'X-Pennyworth': '1' };
    const cfg = await kvGet('cfg');
    const runtime = S.st.local_runtime;
    if (!runtime) throw new Error('這台電腦的 Tallomi 太舊，不支援手機副本');
    if (!cfg || cfg.runtime !== runtime || LOC.needWarm) { const wheels = await locWarm(runtime); await kvPut('cfg', { runtime, wheels }); LOC.needWarm = false; }
    const eng = await kvGet('engine');
    if (!eng || eng.version !== S.st.version) {
      const r = await locRealFetch('/api/local/engine', { headers: hdr, cache: 'no-store' });
      if (!r.ok) throw new Error(`取得程式失敗（${r.status}）`);
      await kvPut('engine', { version: r.headers.get('X-Snapshot-Version') || S.st.version, bytes: new Uint8Array(await r.arrayBuffer()) });
    }
    const r = await locRealFetch('/api/local/snapshot', { headers: hdr, cache: 'no-store' });
    if (r.status === 401) return;                                                  // the computer is locked: try again after it is unlocked
    if (!r.ok) throw new Error(`取得帳本副本失敗（${r.status}）`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    await kvPut('snap', { maxTx: Number(r.headers.get('X-Snapshot-MaxTx')) || 0, rev: Number(r.headers.get('X-Snapshot-Rev')) || 0, version: r.headers.get('X-Snapshot-Version') || S.st.version, at: Date.now(), bytes, size: bytes.length });
    LOC.error = '';
  } catch (e) { LOC.error = e.message || String(e); }
  finally { LOC.syncing = false; LOC.warm = ''; updateLocStatus(); }
}
// called after every refresh (app.js)
async function locAfterRefresh() {
  if (LOC.mode !== 'pc') { updateLocBar(); return; }
  if (!S.st || !S.st.remote) return;
  if (!LOC.warmed && 'serviceWorker' in navigator) { LOC.warmed = true; navigator.serviceWorker.ready.then((r) => r.active && r.active.postMessage({ type: 'warm' })).catch(() => {}); }       // fill in any program file or icon the phone is still missing
  if (lsGet('pw_offline') === '1') await locMigrateOld();
  if (!locOn() && lsGet(LOC_ASKED) !== '1') {                                       // asked once, a moment after the page is up and only if nothing else is open
    setTimeout(() => { if (!locOn() && lsGet(LOC_ASKED) !== '1' && !document.querySelector('dialog[open]') && LOC.mode === 'pc') { lsSet(LOC_ASKED, '1'); locAsk1(); } }, 2500);
    return;
  }
  if (locOn()) {
    await locCounts();
    if (LOC.pending > 0 && !LOC.returning) { await locReplay(); return; }       // closed while away, opened with the computer up: send the log first
    locSyncCopy(false);
  }
}
let locMigrating = false;
async function locMigrateOld() {                                                   // the old 離線模式: send what it still holds, then continue as the new mode
  if (locMigrating) return;
  locMigrating = true;
  try {
    if (typeof offlineFlush === 'function') await offlineFlush();
    const left = typeof offlineQueue === 'function' ? await offlineQueue() : [];
    if (left.length) return;
    await locEnable(true);                                                         // the new mode first; the old one is only given up when the new one is ready
    lsSet('pw_offline', '0');
    try { await offlineTx('cache', 'readwrite', (s) => s.clear()); } catch { /* none */ }
    if (typeof updateOfflineBar === 'function') { OFF.offline = false; OFF.pending = 0; OFF.failed = 0; updateOfflineBar(); }
  } catch { /* try again after the next refresh */ }
  finally { locMigrating = false; }
}

// ------------------------------------------------------------------- turning it on and off
async function locEnable(quiet) {
  if (!('serviceWorker' in navigator) || !window.indexedDB || !window.caches) throw new Error('這個瀏覽器不支援（要用 Tailscale 的 https 網址、加到主畫面的那個）');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('請用 Tailscale 的 https 網址開啟 Tallomi（加到主畫面的那個），才能在電腦沒開時使用。');
  const r = await locRealFetch('/', { cache: 'reload', headers: { 'X-Pennyworth': '1' } });
  if (!r.ok || r.redirected) throw new Error('目前連不上電腦，等連線後再開啟。');
  await (await caches.open(LOC_SHELL)).put('/__shell', r);                         // the page itself, so the app opens with the computer off
  lsSet(LOC_FLAG, '1'); lsSet(LOC_ASKED, '1');
  LOC.needWarm = true; LOC.lastTry = 0;
  await locSyncCopy(true);
  if (LOC.error) { lsSet(LOC_FLAG, '0'); throw new Error(LOC.error); }
  if (!quiet) updateLocBar();
}
async function locDisable() {
  lsSet(LOC_FLAG, '0'); locHintSet(false);
  locStop(); LOC.mode = 'pc';
  try { await caches.delete(LOC_CACHE); await caches.delete(LOC_SHELL); } catch { /* none */ }
  try { for (const s of ['kv', 'journal', 'problems']) await locTx(s, 'readwrite', (st) => st.clear()); } catch { /* none */ }
  await locWipeDb(); LOC.pending = 0; LOC.problems = 0; updateLocBar();
}
function locAsk1() {
  confirmBox({ title: '電腦沒開時，手機也要能用嗎？',
    message: h('div', null,
      h('p', null, '開啟後，手機會多存一份帳本和程式。電腦沒有開啟 Tallomi 時，手機照樣能打開、記帳、修改、新增帳戶／類別／範本、換匯、投資買賣、看報表、更新匯率與股價；電腦回來後，這段期間的變更會自動補送，並回到同步。'),
      h('p', null, h('b', null, '代價：'), '手機上多一份你的帳本。如果電腦有開 PIN 鎖，手機上的副本用同一組 PIN 開啟，但 PIN 只擋畫面、不是加密；手機遺失或被別人拿到時，這份資料可能被看到。請確認手機有設螢幕鎖。'),
      h('p', { class: 'hint' }, '第一次會下載約 14 MB 的執行環境（只下載一次），建議在 Wi-Fi 下開啟。之後可以隨時到「設定 → 電腦沒開也能用」關閉。')),
    confirmLabel: '開啟' }).then(async (ok) => {
    if (!ok) return;
    try { await locEnable(); await afterChange('已開啟：電腦沒開時手機也能用'); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------------- screens
function setLocVeil(msg) {
  let v = document.getElementById('locveil');
  if (!msg) { if (v) v.remove(); return; }
  if (!v) { v = h('div', { id: 'locveil', class: 'locveil', role: 'status' }, h('div', { class: 'locveil-box' }, h('b', null, 'Tallomi'), h('p', { class: 'locveil-msg' }, ''))); document.body.appendChild(v); }
  v.querySelector('.locveil-msg').textContent = msg;
}
function updateLocBar() {
  let bar = document.getElementById('locbar');
  const away = LOC.mode === 'local';
  if (!locOn() || (!away && !LOC.pending && !LOC.problems)) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'locbar', class: 'offlinebar', role: 'status' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar); else return;
  }
  const parts = [];
  if (away) {
    const noNet = navigator.onLine === false;
    parts.push(h('b', null, noNet ? '離線使用中' : '電腦沒有開啟 Tallomi'), noNet
      ? '：手機沒有網路，改用手機上的帳本。連上網、電腦也開啟後會自動補送並回到同步。'
      : '：已暫停和電腦同步，改用手機上的帳本，其他照常使用。電腦開啟後會自動補送並回到同步。');
  }
  if (LOC.pending) parts.push(`　待補送 ${LOC.pending} 筆變更`);
  if (LOC.problems) parts.push(`　${LOC.problems} 筆電腦沒收`);
  bar.replaceChildren(h('span', null, parts));
  if (LOC.pending || LOC.problems) bar.append(h('button', { class: 'btn small', type: 'button', onclick: locJournalDialog }, '查看'));
}
const locDesc = (it) => { const b = it.body || {}; const kind = it.path.replace('/api/', '').replace(/\/\d+/g, ''); const what = { transactions: it.method === 'POST' ? '新增' : it.method === 'DELETE' ? '刪除' : '修改' }[kind] || kind;
  return `${what}${b.amount ? `　${b.amount}` : ''}${b.category ? `　${b.category}` : ''}${b.note ? `　${b.note}` : ''}`; };
async function locJournalDialog() {
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const draw = async () => {
    const j = await locJournal(), pr = await locProblems(); await locCounts();
    const rows = [];
    if (j.length) rows.push(h('p', { class: 'hint', style: 'margin:0' }, '這些變更已經記在手機上，電腦回來後會自動補送。'), ...j.map((it) => h('div', { class: 'loc-row' }, h('span', null, locDesc(it)), h('small', { class: 'hint' }, it.at.replace('T', ' ')))));
    if (pr.length) rows.push(h('p', { style: 'margin:8px 0 0' }, h('b', null, '電腦沒收的變更')),
      ...pr.map((it) => h('div', { class: 'loc-row' }, h('span', null, locDesc(it), h('small', { class: 'hint', style: 'display:block' }, it.error)),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { await locTx('problems', 'readwrite', (s) => s.delete(it.seq)); draw(); } }, '知道了'))));
    if (!rows.length) rows.push(h('p', { class: 'hint', style: 'margin:0' }, '沒有待補送的變更。'));
    body.replaceChildren(...rows);
  };
  await draw();
  openDialog({ title: '手機上的變更', body });
}
let locStatusBox = null;
function updateLocStatus() {
  if (!locStatusBox || !locStatusBox.isConnected) return;
  kvGet('snap').then((snap) => {
    const parts = [];
    if (LOC.warm) parts.push(LOC.warm);
    else if (LOC.syncing) parts.push('正在更新手機上的副本…');
    else if (snap) parts.push(`手機上的副本：${new Date(snap.at).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新，${(snap.size / 1048576).toFixed(1)} MB（電腦有新變動時會自動更新）`);
    else parts.push('手機上還沒有副本');
    if (LOC.error) parts.push(`　⚠ ${LOC.error}`);
    locStatusBox.textContent = parts.join('');
  }).catch(() => {});
}
function locSection() {
  const on = locOn();
  const box = h('input', { type: 'checkbox', checked: on, 'aria-label': '電腦沒開也能用', onchange: async (e) => {
    const want = e.target.checked;
    try {
      if (want) {
        e.target.disabled = true; locAsk1(); e.target.checked = false; e.target.disabled = false;
      } else {
        const j = await locJournal();
        const ok = await confirmBox({ title: '關閉「電腦沒開也能用」？', message: h('p', null, j.length ? `手機上還有 ${j.length} 筆變更沒送到電腦，關閉後會被丟掉。` : '手機上的帳本副本和程式會被清除。'), confirmLabel: '關閉', danger: true });
        if (!ok) { e.target.checked = true; return; }
        await locDisable(); await afterChange('已關閉，手機上的副本已清除');
      }
    } catch (err) { e.target.checked = !want; fail(err); }
  } });
  locStatusBox = h('p', { class: 'hint', style: 'margin:0' }, '');
  const sec = h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '電腦沒開也能用')),
    h('div', { class: 'rows' },
      h('label', { class: 'row-inline' }, box, h('span', null, '電腦沒有開啟 Tallomi 時，手機照樣能打開、記帳')),
      h('p', { class: 'hint', style: 'margin:0' }, '電腦連不上時，手機自動改用手機上的帳本副本，暫停同步；匯率與股價用手機自己的網路更新。可以記帳、修改或刪除交易、新增帳戶／類別／範本、代墊收款、看報表；設定、照片、匯入與備份要等電腦回來。電腦開啟後自動補送變更並回到同步。'),
      on ? locStatusBox : null,
      on ? h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: lsGet('pw_local_recur') === '1', onchange: (e) => { lsSet('pw_local_recur', e.target.checked ? '1' : '0'); toast(e.target.checked ? '下次手機改用本機帳本時，到期的定期交易會由手機先記' : '已關閉'); } }),
        h('span', null, '電腦沒開時，到期的定期交易由手機先記（電腦回來後會用同樣的日期自己補記，不會重複）')) : null,
      (on && S.st && S.st.lock && S.st.lock.enabled && window.PW_BIO_OK && typeof bioRegister === 'function') ? h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: lsGet('pw_local_bio') === '1' && !!lsGet('pw_bio_cred'), onchange: async (e) => {
        try {
          if (e.target.checked) { await bioRegister(); lsSet('pw_local_bio', '1'); toast('電腦沒開時，手機上的副本可以用 Face ID／指紋解鎖'); }
          else { lsSet('pw_local_bio', '0'); try { localStorage.removeItem('pw_bio_cred'); } catch { /* none */ } toast('已關閉'); }
        } catch (err) { e.target.checked = !e.target.checked; fail(err); }
      } }), h('span', null, '手機上的副本用 Face ID／指紋解鎖（PIN 仍然可以用）')) : null,
      on ? h('div', { class: 'row-inline' },
        h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.target.disabled = true; LOC.lastTry = 0; try { await locSyncCopy(true); } finally { e.target.disabled = false; } } }, '立即更新副本'),
        (LOC.pending || LOC.problems) ? h('button', { class: 'btn', type: 'button', onclick: locJournalDialog }, `查看手機上的變更（${LOC.pending + LOC.problems}）`) : null) : null));
  if (on) updateLocStatus();
  return sec;
}
