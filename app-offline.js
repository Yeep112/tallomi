'use strict';
/* Offline mode for the owner's paired phone (settings → 這支手機 → 離線模式, off by default).
   While the computer cannot be reached (restart, update, asleep) the phone
     - shows the last data it saw (every GET answer is kept in IndexedDB on the phone), and
     - lets you add new entries: they wait in a queue on the phone and are sent when the computer is back.
   Each queued entry carries a client_id, so a resend after a dropped connection never records it twice.
   Never available together with the PIN lock: the cached copy on the phone is not protected by the PIN. */
const OFF = { db: null, offline: false, stamp: null, pending: 0, failed: 0, flushing: false, loop: false };
const OFF_FLAG = 'pw_offline';
const OFF_SHELL_CACHE = 'tallomi-offline';
const OFF_SKIP = /^\/api\/(rev|ping|lock|pair|remote|backups|autostart|autobackup|sheets|import|market|fx|update|owner)/;
const OFF_MAX_BYTES = 2000000;       // one cached answer
const OFF_MAX_ENTRIES = 300;
const offlineOn = () => lsGet(OFF_FLAG) === '1';
const offlineLocked = () => !!(S.st && S.st.lock && S.st.lock.enabled);

function offlineOpen() {
  if (OFF.db) return Promise.resolve(OFF.db);
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('這個瀏覽器不支援離線模式')); return; }
    const q = indexedDB.open('tallomi-offline', 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('cache', { keyPath: 'path' });
      q.result.createObjectStore('queue', { keyPath: 'cid' });
    };
    q.onsuccess = () => { OFF.db = q.result; resolve(q.result); };
    q.onerror = () => reject(q.error || new Error('無法開啟手機上的暫存'));
  });
}
async function offlineTx(store, mode, fn) {
  const db = await offlineOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const offlineAll = (store) => offlineTx(store, 'readonly', (s) => s.getAll());

async function offlineSave(path, data) {
  if (OFF_SKIP.test(path) || data == null) return;
  let size = 0; try { size = JSON.stringify(data).length; } catch { return; }
  if (size > OFF_MAX_BYTES) return;
  try { await offlineTx('cache', 'readwrite', (s) => s.put({ path, data, at: Date.now() })); } catch { /* storage full or blocked: just no copy */ }
}
async function offlineLoad(path) {
  try { return await offlineTx('cache', 'readonly', (s) => s.get(path)); } catch { return null; }
}
async function offlinePrune() {
  try {
    const rows = await offlineAll('cache');
    if (rows.length <= OFF_MAX_ENTRIES) return;
    rows.sort((a, b) => a.at - b.at);
    await offlineTx('cache', 'readwrite', (s) => { rows.slice(0, rows.length - OFF_MAX_ENTRIES).forEach((r) => s.delete(r.path)); });
  } catch { /* ignore */ }
}

// ----------------------------------------------------------------- the queue
const offlineQueue = async () => { try { return (await offlineAll('queue')).sort((a, b) => a.seq - b.seq); } catch { return []; } };
async function offlineCount() {
  const q = await offlineQueue();
  OFF.pending = q.filter((x) => !x.error).length; OFF.failed = q.filter((x) => x.error).length;
  return q;
}
async function offlineEnqueue(body) {
  const cid = body.client_id;
  if (!body.time) body.time = nowLocal().slice(0, 16);          // the moment it was recorded, not the moment it reaches the computer
  const item = { cid, seq: Date.now() * 1000 + Math.floor(Math.random() * 1000), body, saved: nowLocal().slice(0, 16), error: '' };
  await offlineTx('queue', 'readwrite', (s) => s.put(item));
  await offlineCount(); updateOfflineBar(); offlineLoop();
}
const newClientId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

// Send what is waiting, oldest first. Stops at the first sign that the computer is still away.
async function offlineFlush() {
  if (OFF.flushing) return 0;
  OFF.flushing = true; let sent = 0;
  try {
    for (const it of await offlineQueue()) {
      if (it.error) continue;
      try { await apiNet('POST', '/api/transactions', it.body); }
      catch (e) {
        if (e.network) break;
        it.error = e.message || '送出失敗';
        await offlineTx('queue', 'readwrite', (s) => s.put(it));       // refused by the computer (e.g. the account no longer exists): keep it, tell the owner
        continue;
      }
      await offlineTx('queue', 'readwrite', (s) => s.delete(it.cid));
      sent += 1;
    }
  } finally { OFF.flushing = false; await offlineCount(); }
  return sent;
}

// Probe the computer every few seconds while we are away or have something waiting.
function offlineLoop() {
  if (OFF.loop || !offlineOn()) return;
  OFF.loop = true;
  (async function tick() {
    try {
      if (!offlineOn() || (!OFF.offline && !OFF.pending)) { OFF.loop = false; return; }
      if (document.visibilityState !== 'visible') { setTimeout(tick, 5000); return; }        // screen off: stay quiet
      let up = false;
      try { const r = await fetch('/api/ping', { cache: 'no-store' }); up = r.status < 500; } catch { up = false; }
      if (up) {
        const sent = await offlineFlush();
        const was = OFF.offline;
        OFF.offline = false;
        if (sent) toast(`電腦已連線，補送了 ${sent} 筆離線時記下的紀錄`);
        if (OFF.failed) toast(`有 ${OFF.failed} 筆離線紀錄電腦不接受，請到上方橫幅查看`, true);
        if (was || sent) { try { await refresh(); } catch { /* shown by refresh */ } }
        updateOfflineBar();
        if (!OFF.pending) { OFF.loop = false; return; }
      }
    } catch { /* keep trying */ }
    setTimeout(tick, 5000);
  })();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && offlineOn() && (OFF.offline || OFF.pending)) { OFF.loop = false; offlineLoop(); } });
window.addEventListener('online', () => { if (offlineOn() && (OFF.offline || OFF.pending)) { OFF.loop = false; offlineLoop(); } });

// ------------------------------------------------------------- api wrapper
// Called by api() when offline mode is on. Reads come from the network and are kept; when the network fails the kept copy is used.
async function offlineApi(method, path, body, isForm) {
  if (method === 'POST' && path === '/api/transactions' && !isForm && body && typeof body === 'object') {
    const withId = Object.assign({}, body, { client_id: body.client_id || newClientId() });
    try { return await apiNet(method, path, withId, isForm); }
    catch (e) {
      if (!e.network) throw e;
      await offlineEnqueue(withId);
      markOffline();
      return { id: null, queued: true, client_id: withId.client_id };
    }
  }
  if (method === 'GET') {
    try {
      const data = await apiNet(method, path, body, isForm);
      if (OFF.offline && !OFF_SKIP.test(path)) { OFF.offline = false; updateOfflineBar(); }
      offlineSave(path, data);
      return data;
    } catch (e) {
      if (!e.network) throw e;
      const kept = await offlineLoad(path);
      if (!kept) { markOffline(); throw e; }
      markOffline(kept.path === '/api/state' ? kept.at : null);
      return kept.data;
    }
  }
  try { return await apiNet(method, path, body, isForm); }
  catch (e) {
    if (e.network) { markOffline(); throw new Error('離線時只能新增紀錄；修改、刪除、設定要等電腦連線。'); }
    throw e;
  }
}
function markOffline(stampAt) {
  if (stampAt) OFF.stamp = stampAt;
  if (!OFF.offline) { OFF.offline = true; offlineLoop(); }
  updateOfflineBar();
}

// ------------------------------------------------------------------ banner
function updateOfflineBar() {
  let bar = document.getElementById('offlinebar');
  if (!offlineOn() || (!OFF.offline && !OFF.pending && !OFF.failed)) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'offlinebar', class: 'offlinebar', role: 'status' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar);
  }
  const parts = [];
  if (OFF.offline) parts.push(h('b', null, '離線中'), `：${OFF.stamp ? `顯示 ${new Date(OFF.stamp).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 的資料` : '顯示手機上存的資料'}；電腦回來會自動連線。`);
  else parts.push(h('b', null, '電腦已連線'), '。');
  if (OFF.pending) parts.push(`　待補送 ${OFF.pending} 筆`);
  if (OFF.failed) parts.push(`　${OFF.failed} 筆被電腦拒絕`);
  bar.replaceChildren(h('span', null, parts));
  if (OFF.pending || OFF.failed) bar.append(h('button', { class: 'btn small', type: 'button', onclick: offlineQueueDialog }, '查看'));
}
async function offlineQueueDialog() {
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const draw = async () => {
    const q = await offlineCount(); updateOfflineBar();
    if (!q.length) { body.replaceChildren(h('p', { class: 'hint', style: 'margin:0' }, '沒有待補送的紀錄。')); return; }
    body.replaceChildren(h('p', { class: 'hint', style: 'margin:0' }, '這些紀錄還在手機上，電腦連線後會自動送出。'),
      ...q.map((it) => {
        const b = it.body, a = acct(b.account_id);
        return h('div', { class: 'row-inline', style: 'justify-content:space-between;gap:8px;border-top:1px solid var(--line, #0002);padding-top:8px' },
          h('span', null, `${TYPE_LABEL[b.type] || b.type}　${b.amount} ${a ? a.currency : ''}　${a ? a.name : ''}`, b.note ? `　${b.note}` : '',
            h('small', { class: 'hint', style: 'display:block' }, it.error ? `電腦沒收：${it.error}` : `記於 ${it.saved.replace('T', ' ')}`)),
          h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
            const ok = await confirmBox({ title: '刪除這筆待補送？', message: h('p', null, '刪掉之後不會再送到電腦，也無法復原。'), confirmLabel: '刪除', danger: true });
            if (!ok) return;
            await offlineTx('queue', 'readwrite', (s) => s.delete(it.cid)); draw();
          } }, '刪除'));
      }));
  };
  await draw();
  openDialog({ title: '待補送的紀錄', body });
}

// -------------------------------------------------------- turning it on/off
async function offlinePurge() {
  try { await caches.delete(OFF_SHELL_CACHE); } catch { /* none */ }
  try { await offlineTx('cache', 'readwrite', (s) => s.clear()); await offlineTx('queue', 'readwrite', (s) => s.clear()); } catch { /* none */ }
  OFF.offline = false; OFF.stamp = null; OFF.pending = 0; OFF.failed = 0;
  updateOfflineBar();
}
async function offlineDisable() { lsSet(OFF_FLAG, '0'); await offlinePurge(); }
async function offlineEnable() {
  if (offlineLocked()) throw new Error('已開啟 PIN 鎖定時，無法使用離線模式（手機上的備份資料不受 PIN 保護）。');
  if (!('serviceWorker' in navigator) || !('indexedDB' in window) || !window.caches) throw new Error('這個瀏覽器不支援離線模式。');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('請用 Tailscale 的 https 網址開啟 Tallomi（加到主畫面的那個），才能存離線版本。');
  const r = await fetch('/', { cache: 'reload', headers: { 'X-Pennyworth': '1' } });
  if (!r.ok || r.redirected) throw new Error('目前連不上電腦，等連線後再開啟離線模式。');
  await (await caches.open(OFF_SHELL_CACHE)).put('/__shell', r);
  await offlineOpen();
  lsSet(OFF_FLAG, '1');
  await offlineCount();
  // keep what the main pages need right away (other pages are kept the first time you open them)
  for (const p of ['/api/state', '/api/transactions?limit=8', '/api/templates', '/api/frequent?limit=100']) { try { await api('GET', p); } catch { /* optional */ } }
}
// Called after every refresh: the PIN lock and offline mode exclude each other.
async function offlineSync() {
  if (!offlineOn()) return;
  if (offlineLocked()) { await offlineDisable(); toast('已開啟 PIN 鎖定，手機上的離線資料已清除', true); return; }
  await offlineCount(); updateOfflineBar(); offlinePrune();
  if (OFF.pending) offlineLoop();
}

function offlineSection() {
  const locked = offlineLocked(), on = offlineOn();
  const box = h('input', { type: 'checkbox', checked: on, disabled: locked && !on, 'aria-label': '離線模式', onchange: async (e) => {
    const want = e.target.checked;
    try {
      if (want) {
        const ok = await confirmBox({ title: '開啟離線模式？',
          message: h('div', null, h('p', null, '電腦連不上時（重開機、更新中），手機會顯示上次看到的資料，也能先記帳，電腦回來後自動補送。'),
            h('p', null, h('b', null, '代價：'), '手機上會多存一份你的帳本資料。手機遺失或被別人拿到時，這份資料可能被看到。請確認手機有設螢幕鎖。')),
          confirmLabel: '開啟' });
        if (!ok) { e.target.checked = false; return; }
        await offlineEnable(); await afterChange('離線模式已開啟');
      } else {
        const q = await offlineQueue();
        if (q.length) {
          const ok = await confirmBox({ title: '關閉離線模式？', message: h('p', null, `還有 ${q.length} 筆紀錄沒送到電腦，關閉後會被丟掉。`), confirmLabel: '關閉並丟掉', danger: true });
          if (!ok) { e.target.checked = true; return; }
        }
        await offlineDisable(); await afterChange('離線模式已關閉，手機上的暫存資料已清除');
      }
    } catch (err) { e.target.checked = !want; fail(err); }
  } });
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '離線模式')),
    h('div', { class: 'rows' },
      h('label', { class: 'row-inline' }, box, h('span', null, '電腦連不上時，仍可查看資料並先記帳')),
      h('p', { class: 'hint', style: 'margin:0' }, locked && !on
        ? '你已在電腦上開啟 PIN 鎖定，離線模式無法同時使用（手機上的備份資料不受 PIN 保護）。'
        : '離線時能看到上次連線時打開過的頁面，並新增收入／支出／轉帳；修改、刪除、設定、照片要等電腦連線。離線期間記的帳不會算進顯示的餘額，補送後才會更新。'),
      on && (OFF.pending || OFF.failed) ? h('button', { class: 'btn', type: 'button', onclick: offlineQueueDialog }, `查看待補送（${OFF.pending + OFF.failed}）`) : null));
}
