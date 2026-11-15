'use strict';
/* Tallomi UI. No framework; every user-supplied string goes through textContent. */

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const TYPE_LABEL = { income: '收入', expense: '支出', transfer: '轉帳', adjust: '調整' };
const PALETTE = ['#2E6F95', '#B08D3C', '#3E8E7E', '#8E5572', '#C0623F', '#5B7DB1', '#7A8B3C', '#A4506A', '#4C5C68', '#9C7A97'];
const OTHER_COLOR = '#9AA5B1';

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  if (value !== undefined) el.value = value;
  return el;
}

const digitsCache = {};
function digits(ccy) {
  if (!(ccy in digitsCache)) {
    try { digitsCache[ccy] = new Intl.NumberFormat('en', { style: 'currency', currency: ccy }).resolvedOptions().maximumFractionDigits; }
    catch { digitsCache[ccy] = 2; }
  }
  return digitsCache[ccy];
}
const NO_CENTS = new Set(['TWD']);   // TWD has a minor unit on paper, but nobody uses it: show cents only when present
const HIDDEN = '***';
function num(v, ccy, sign, force) {
  if (v == null) return '—';
  if (isHidden() && !force) return HIDDEN;
  const d = digits(ccy || 'TWD');
  const min = NO_CENTS.has(ccy) && Number.isInteger(v) ? 0 : d;
  return new Intl.NumberFormat('zh-TW', { minimumFractionDigits: min, maximumFractionDigits: d, signDisplay: sign ? 'exceptZero' : 'auto' }).format(v).replace('-', '−');
}
function money(v, ccy, { sign = false, tone = false, tag = true } = {}) {
  const cls = 'num' + (tone ? (v > 0 ? ' pos' : v < 0 ? ' neg' : '') : '');
  return h('span', { class: cls }, num(v, ccy, sign), tag ? h('span', { class: 'ccy' }, ccy) : null);
}
const pad = (n) => String(n).padStart(2, '0');
function nowLocal() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
const shortTime = (t) => t.replace('T', ' ').slice(0, 16);
const TX_PAGE = window.matchMedia('(max-width: 720px)').matches ? 40 : 100;      // a phone draws fewer rows at a time ("載入更多" adds the rest)
const onTouch = () => window.matchMedia('(pointer: coarse)').matches;      // finger instead of a mouse
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(...shapes) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    el.appendChild(n);
  }
  return el;
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// With offline mode on (paired phone only) reads fall back to the copy kept on the phone and new entries wait in a queue; see app-offline.js.
async function api(method, path, body, isForm) {
  return typeof offlineOn === 'function' && offlineOn() ? offlineApi(method, path, body, isForm) : apiNet(method, path, body, isForm);
}
async function apiNet(method, path, body, isForm) {
  const opt = { method, headers: { 'X-Pennyworth': '1' } };
  if (body !== undefined && !isForm) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (isForm) opt.body = body;
  let r;
  const remote = (S.st && S.st.remote) || (typeof offlineOn === 'function' && offlineOn());
  const gone = () => { const err = new Error(remote ? '連不上你的電腦：請確認電腦開機、Tallomi 正在執行、手機的 Tailscale 已開啟。' : '無法連線到 Tallomi 本機服務，程式可能已關閉。'); err.network = true; return err; };
  try { r = await fetch(path, opt); } catch { throw gone(); }
  if (remote && (r.status === 502 || r.status === 503 || r.status === 504)) throw gone();      // Tailscale answers like this when Tallomi is not running on the computer
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  const rev = Number(r.headers.get('X-Rev'));
  if (rev > (S.rev || 0)) S.rev = rev;                 // our own change: do not treat it as news from another window
  if (r.status === 401 && data && data.locked) { await showLock(); return apiNet(method, path, body, isForm); }      // PIN lock: ask, then try again
  if (r.status === 401 && data && data.pair) { location.replace('/pair'); throw new Error('這支手機需要重新配對'); }
  if ((r.status === 404 || r.status === 405) && path.startsWith('/api/') && (!data || data.error === '找不到' || !data.error))
    { const err = new Error('目前執行的 Tallomi 程式是舊版，缺少這個功能。請把 Tallomi 完全結束（設定 → 結束 Tallomi），再重新開啟。'); err.status = r.status; throw err; }
  if (!r.ok) { const err = new Error((data && data.error) || `請求失敗（${r.status}）`); err.status = r.status; throw err; }
  return data;
}

function toast(msg, err, action) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') + (action ? ' has-act' : '') }, h('span', { class: 'toast-msg' }, msg));
  if (action) t.appendChild(h('button', { class: 'toast-act', type: 'button', onclick: async () => {
    t.remove();
    try { await action.run(); } catch (e) { fail(e); }
  } }, action.label));
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 7000 : action ? 10000 : 3500);
}
const fail = (e) => toast(e.message || String(e), true);

// ------------------------------------------------------------------- dialogs
// While a dialog is open the page behind it must not scroll. On a phone the body is pinned in place (iOS ignores overflow:hidden),
// on a computer the page just stops scrolling and keeps its width. The place in the page is put back when the last dialog closes.
let scrollLocks = 0, lockedY = 0;
function lockScroll() {
  if (scrollLocks++) return;
  const root = document.documentElement;
  lockedY = window.scrollY;
  if (window.matchMedia('(max-width: 720px)').matches) { root.classList.add('modal-open', 'modal-pinned'); document.body.style.top = `-${lockedY}px`; }
  else { const gap = window.innerWidth - root.clientWidth; root.classList.add('modal-open'); if (gap > 0) document.body.style.paddingRight = `${gap}px`; }
}
function unlockScroll() {
  if (!scrollLocks || --scrollLocks) return;
  const root = document.documentElement, pinned = root.classList.contains('modal-pinned');
  root.classList.remove('modal-open', 'modal-pinned'); document.body.style.top = ''; document.body.style.paddingRight = '';
  if (pinned) window.scrollTo(0, lockedY);
}
function openDialog({ title, body, primary, wide, extraFoot, cancelLabel = '取消' }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '', 'aria-label': title });
  const errBox = h('div', { class: 'neg', role: 'alert' });
  const submit = h('button', { class: 'btn primary' + (primary && primary.danger ? ' danger solid' : ''), type: 'submit' }, primary ? primary.label : '好');
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'dlg-head' }, h('h3', null, title)),
    h('div', { class: 'dlg-body' }, body, errBox),
    h('div', { class: 'dlg-foot' }, extraFoot || null,
      h('button', { class: 'btn', type: 'button', autofocus: onTouch() ? '' : null, onclick: () => dlg.close() }, primary ? cancelLabel : '關閉'),     // on a phone the browser's own first-focus lands on this button, not on a text box (no keyboard without a tap)
      primary ? submit : null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!primary) return dlg.close();
    submit.disabled = true; errBox.textContent = '';
    try { const keep = await primary.run(dlg); if (keep !== false) dlg.close(); }
    catch (err) { errBox.textContent = err.message || String(err); }
    finally { submit.disabled = false; }
  });
  dlg.appendChild(form);
  dlg.addEventListener('close', () => { dlg.remove(); unlockScroll(); });
  document.body.appendChild(dlg);
  lockScroll();
  dlg.showModal();
  const first = dlg.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled])');
  if (first && !onTouch()) first.focus();       // on a phone a focus the finger did not make leaves iOS with a focused box and no keyboard
  return dlg;
}

function confirmBox({ title, message, confirmLabel = '確定', danger = false, typed = null }) {
  return new Promise((resolve) => {
    let ok = false;
    const input = typed ? h('input', { type: 'text', autocomplete: 'off', 'aria-label': `輸入 ${typed} 確認` }) : null;
    const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' }, message,
      typed ? h('label', { class: 'field' }, h('span', null, `請輸入「${typed}」以確認`), input) : null);
    const dlg = openDialog({
      title, body, primary: {
        label: confirmLabel, danger,
        run: async () => {
          if (typed && input.value.trim() !== typed) throw new Error(`輸入的內容不是「${typed}」`);
          ok = true;
        }
      }
    });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

// --------------------------------------------------------------------- state
const S = {
  st: null,
  entry: { type: 'expense', account_id: null, to_account_id: null, amount: '', to_amount: '', category: '', note: '', tags: lsGet('pw_pin_tags') || '', time: '', advance: '', counterparty: '', due: '', no_budget: false, no_stats: false },
  txf: { q: '', type: '', account_id: '', from: '', to: '', tag: '', limit: TX_PAGE, transfers: true, group: 'day', back: null, folded: new Set() },
  rp: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, group: 'category', cmpKind: 'expense', cmpMode: 'auto', months: [], years: [], kind: 'pie', accounts: ['total'], shareKind: 'pie', shareBy: 'value' },
  charts: [],
  selMode: false, sel: new Set(),                       // transactions page: multi-select
  hideAll: lsGet('pw_hide') === '1',                 // Settings: hide every page
  hidePages: (() => { try { return JSON.parse(lsGet('pw_hide_pages') || '{}') || {}; } catch { return {}; } })(),   // the eye on each page
  route: 'overview',
  prefsApplied: false,
  lastRefresh: 0,
};
// opened from the tray icon's 記一筆: land on the transactions page with the cursor in the amount box
if (new URLSearchParams(location.search).get('add')) { S.focusAdd = true; history.replaceState(null, '', location.pathname + '#/transactions'); }

const PAGE_NAMES = { overview: '總覽', transactions: '交易', exchange: '換匯', invest: '投資', accounts: '帳戶', reports: '報表' };
const isHidden = () => !!(S.hideAll || S.hidePages[S.route]);
document.documentElement.classList.toggle('amounts-hidden', isHidden());
const acct = (id) => S.st.accounts.find((a) => a.id == id);
const activeAccounts = () => S.st.accounts.filter((a) => !a.archived);

// Look-and-feel choices live in the book (so they survive a changed port or a restored backup);
// localStorage is only a cache so the right colour is on screen before the first request returns.
function applyPrefs(p) {
  lsSet('pw_color', p.color); lsSet('pw_hide', p.hide ? '1' : '0'); lsSet('pw_hide_pages', JSON.stringify(p.pages || {}));
  Theme.apply(p.color); S.hideAll = !!p.hide; S.hidePages = { ...(p.pages || {}) }; markHidden();
}
// While amounts are hidden, green / red would still reveal income vs expense: show them in plain ink.
function markHidden() { document.documentElement.classList.toggle('amounts-hidden', isHidden()); }
// Every page has its own eye. The master switch in Settings hides all of them at once and leaves the per-page choices alone.
function setHidePage(page, v) {
  S.hidePages[page] = v; lsSet('pw_hide_pages', JSON.stringify(S.hidePages)); markHidden();
  if (S.st) S.st.prefs.pages[page] = v;
  api('PUT', '/api/settings', { ui_hide_pages: { [page]: v } }).catch(() => {});
  renderRoute();
}
function setHideAll(v) {
  S.hideAll = v; lsSet('pw_hide', v ? '1' : '0'); markHidden();
  if (S.st) S.st.prefs.hide = v;
  api('PUT', '/api/settings', { ui_hide: v }).catch(() => {});
  renderRoute();
}
function eyeButton(page) {
  const locked = S.hideAll;
  const hidden = isHidden();
  const label = locked ? '已在「設定」隱藏所有金額' : hidden ? '顯示這一頁的金額' : '隱藏這一頁的金額';
  const btn = h('button', { class: 'eye' + (locked ? ' locked' : ''), type: 'button', 'aria-pressed': String(hidden), 'aria-label': label, title: label,
    onclick: () => { if (locked) toast('已在「設定」打開「隱藏所有金額」。要單獨顯示這一頁，請先到設定頁關閉它。'); else setHidePage(page, !S.hidePages[page]); } });
  btn.replaceChildren(hidden
    ? svg(['path', { d: 'M3 10c2.2 3.2 5.4 5 9 5s6.8-1.8 9-5' }], ['path', { d: 'M12 15v3' }], ['path', { d: 'M7 13.6l-1.4 2.4' }], ['path', { d: 'M17 13.6l1.4 2.4' }])
    : svg(['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }], ['circle', { cx: '12', cy: '12', r: '3' }]));
  return btn;
}

async function refresh() {
  S.st = await api('GET', '/api/state');
  S.lastRefresh = Date.now(); S.day = nowLocal().slice(0, 10);
  if (typeof offlineSync === 'function') await offlineSync();
  if (!S.prefsApplied && S.st.prefs) { S.prefsApplied = true; applyPrefs(S.st.prefs); }
  $('#ver').textContent = `版本 ${S.st.version}`;
  updateAdvBadge();
  updateModeTag();
  updateUpdateBar();
  updateSyncLine(S.st.sheets);
  const first = activeAccounts()[0];
  if (!acct(S.entry.account_id) || acct(S.entry.account_id).archived) S.entry.account_id = first ? first.id : null;
  if (S.entry.to_account_id && !acct(S.entry.to_account_id)) S.entry.to_account_id = null;
  await renderRoute();
}
async function afterChange(msg, action) { if (msg) toast(msg, false, action); watchSync(); try { await refresh(); } catch (e) { fail(e); } }

function updateSyncLine(sh) {
  const line = $('#sync-line');
  const dot = h('span', { class: 'dot' });
  let text = 'Google 試算表：未設定';
  if (sh && !sh.has_credentials) text = 'Google 試算表：未上傳金鑰';
  else if (sh && !sh.key) text = 'Google 試算表：未設定試算表';
  if (sh && sh.configured) {
    const s = sh.status || {};
    if (!navigator.onLine) { dot.classList.add('off'); text = '離線中，連線後自動同步'; line.title = '記帳資料都存在這台電腦裡，網路恢復後會自動上傳到 Google 試算表。'; return line.replaceChildren(dot, h('span', null, text)); }
    if (s.state === 'syncing') { dot.classList.add('busy'); text = '同步中…'; }
    else if (s.state === 'offline') { dot.classList.add('off'); text = '離線中，連線後自動同步'; line.title = s.error || ''; }
    else if (s.state === 'error') { dot.classList.add('err'); text = '同步失敗'; line.title = s.error || ''; }
    else if (s.state === 'ok') { dot.classList.add('ok'); text = `已同步 ${String(s.last_ok || '').slice(11, 16)}`; }
    else text = sh.auto ? 'Google 試算表：自動同步已開啟' : 'Google 試算表：自動同步已關閉';
  }
  if (!(sh && sh.status && ['error', 'offline'].includes(sh.status.state))) line.title = '';
  line.replaceChildren(dot, h('span', null, text));
}

// After a change, tell the user whether the Google Sheet caught up (the push runs ~2s later in the background).
let syncWatch = 0;
async function watchSync() {
  const sh = S.st && S.st.sheets;
  if (!sh || !sh.configured || !sh.auto) return;
  const me = ++syncWatch, t0 = Date.now(), prevOk = sh.status.last_ok;
  await new Promise((r) => setTimeout(r, 2600));
  while (me === syncWatch && Date.now() - t0 < 25000) {
    let cur;
    try { cur = await api('GET', '/api/sheets'); } catch { return; }
    updateSyncLine(cur);
    if (cur.status.state === 'offline') { toast('目前離線：已先存在這台電腦，連線後會自動同步'); return; }
    if (cur.status.state === 'error') { toast(`Google 試算表同步失敗：${cur.status.error}`, true); return; }
    if (cur.status.state === 'ok' && cur.status.last_ok !== prevOk) { toast('已同步到 Google 試算表'); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// -------------------------------------------------------------------- router
// Phone tab bar: shows 6 tabs, the rest by swiping. Keep the current tab in view and show a soft edge where more tabs are hidden.
function navEdges() {
  const nav = document.querySelector('.nav'), side = document.querySelector('.side');
  if (!nav || !side) return;
  const more = nav.scrollWidth - nav.clientWidth > 2;
  side.toggleAttribute('data-more-left', more && nav.scrollLeft > 2);
  side.toggleAttribute('data-more-right', more && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
}
function navReveal() {
  const nav = document.querySelector('.nav'), cur = nav && nav.querySelector('a[aria-current]');
  if (cur && nav.scrollWidth > nav.clientWidth + 2) {
    const l = cur.offsetLeft, r = l + cur.offsetWidth;
    if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, l - (nav.clientWidth - cur.offsetWidth) / 2) });
  }
  navEdges();
}
{ const n = document.querySelector('.nav'); if (n) n.addEventListener('scroll', navEdges, { passive: true }); }
window.addEventListener('resize', navEdges);
const ROUTES = { overview: viewOverview, calendar: viewCalendar, advances: viewAdvances, transactions: viewTransactions, exchange: viewExchange, invest: viewInvest, accounts: viewAccounts, reports: viewReports, categories: viewCategories, tags: viewTags, settings: viewSettings };
function currentRoute() { const r = (location.hash || '').replace('#/', ''); return ROUTES[r] ? r : 'overview'; }
// Leaving a page keeps its finished picture for a few minutes; coming back shows it at once while the fresh data loads behind it
// (the same swap used for a live change), so switching pages never starts from a blank screen.
const routeSnaps = {};
const SNAP_MAX_AGE = 10 * 60 * 1000;
async function renderRoute() {
  if (!S.st) return;
  const my = (S.renderSeq = (S.renderSeq || 0) + 1);
  const route = currentRoute();
  const view = $('#view');
  const prev = S.route;
  let same = S.route === route && view.childNodes.length > 0;
  S.route = route; markHidden();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  navReveal();
  if (!same) {                                         // another page
    if (prev && prev !== route && view.childNodes.length && !S.charts.length && !view.querySelector('canvas, :scope > .empty')) routeSnaps[prev] = { nodes: [...view.childNodes], at: Date.now(), y: window.scrollY };
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    for (const k of Object.keys(routeSnaps)) if (Date.now() - routeSnaps[k].at >= SNAP_MAX_AGE) delete routeSnaps[k];     // old pages are not kept around
    const snap = routeSnaps[route]; delete routeSnaps[route];
    if (snap && Date.now() - snap.at < SNAP_MAX_AGE) { view.replaceChildren(...snap.nodes); window.scrollTo(0, snap.y); same = true; }
    else {                                             // never seen (or too old): start from an empty page, with a thin progress line while it loads
      view.replaceChildren(); view.classList.add('loading');
      try { await ROUTES[route](view); } catch (e) { view.replaceChildren(h('div', { class: 'empty' }, h('b', null, '畫面載入失敗'), e.message)); }
      finally { if (my === S.renderSeq) view.classList.remove('loading'); }
      return;
    }
  }
  // The same page again (a change came in, e.g. the automatic price update): build the new page out of sight and swap it in
  // in one step, so the visible page never goes blank or jumps.
  const oldCharts = S.charts; S.charts = [];
  const stage = h('div', { class: view.className, 'aria-hidden': 'true' });
  stage.style.cssText = `position:absolute;left:0;top:0;width:${view.clientWidth}px;visibility:hidden;pointer-events:none`;
  view.parentNode.appendChild(stage);
  let failed = null;
  try { await ROUTES[route](stage); } catch (e) { failed = e; }
  if (my !== S.renderSeq) { stage.remove(); return; }          // the person moved on to another page meanwhile
  const y = window.scrollY;
  oldCharts.forEach((c) => c.destroy());
  if (failed) view.replaceChildren(h('div', { class: 'empty' }, h('b', null, '畫面載入失敗'), failed.message));
  else view.replaceChildren(...stage.childNodes);
  stage.remove();
  window.scrollTo(0, y);
}
window.addEventListener('hashchange', renderRoute);
// Moving between pages does not pile up "previous pages": the overview stays as the one page Back returns to, and going from one page to
// another replaces the current history entry instead of adding one. (Ctrl/⌘-click, middle click and links that open elsewhere behave as usual.)
let homeBelow = false;                                   // the overview is the entry just below this one
function goRoute(hash) {
  const to = hash.replace('#/', ''), from = currentRoute();
  if (to === from && location.hash === hash) return;
  if (from === 'overview') { homeBelow = true; location.hash = hash; return; }
  if (to === 'overview' && homeBelow) {
    homeBelow = false; history.back();
    setTimeout(() => { if (currentRoute() !== 'overview') location.replace('#/overview'); }, 250);
    return;
  }
  location.replace(hash);
}
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const hash = a.getAttribute('href');
  if (!ROUTES[hash.slice(2).split('?')[0]]) return;      // not a page of ours: leave it alone
  e.preventDefault(); goRoute(hash);
});

// ----------------------------------------------------- transaction form pieces
// Shared by the quick-entry bar and the edit dialog.
function txFields(m, redraw, { editing = false } = {}) {
  const A = (id) => acct(id);
  const pick = activeAccounts().filter((a) => true);
  const keep = (id) => (id && A(id) && A(id).archived ? [A(id)] : []);
  const choices = (selectedId) => [...pick, ...keep(selectedId)];
  const from = A(m.account_id), to = A(m.to_account_id);
  const isT = m.type === 'transfer';
  const cross = isT && from && to && from.currency !== to.currency;
  let hintEl = null, hintFn = null;
  const sel = (id, cur, onchange, label) => h('label', { class: 'field half' }, h('span', null, label),
    h('select', { onchange }, choices(cur).map((a) => h('option', { value: a.id, selected: a.id == cur }, `${a.name}（${a.currency}）`))));
  const out = [];
  if (!editing || m.type !== 'adjust') {
    out.push(h('div', { class: 'seg', role: 'group', 'aria-label': '交易類型' },
      ['expense', 'income', 'transfer'].map((t) => h('button', {
        type: 'button', 'aria-pressed': String(m.type === t),
        onclick: () => { m.type = t; if (t === 'transfer' && (!m.to_account_id || m.to_account_id == m.account_id)) { const o = activeAccounts().find((a) => a.id != m.account_id); m.to_account_id = o ? o.id : null; } redraw(); },
      }, TYPE_LABEL[t]))));
  }
  out.push(h('label', { class: 'field' }, h('span', null, m.type === 'adjust' ? '金額（正數為增加、負數為減少）' : '金額'),
    h('input', { class: 'amt', name: 'amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: m.amount, 'aria-label': '金額', oninput: (e) => { m.amount = e.target.value; if (hintFn) hintFn(); } })));
  if (from) out.push(h('span', { class: 'ccy-tag' }, from.currency));
  out.push(sel(m.account_id, m.account_id, (e) => { m.account_id = +e.target.value; redraw(); }, isT ? '轉出帳戶' : '帳戶'));
  if (isT) {
    out.push(sel(m.to_account_id, m.to_account_id, (e) => { m.to_account_id = +e.target.value; redraw(); }, '轉入帳戶'));
    if (cross) {
      const rates = rateTable();
      const hintText = () => {
        if (!(rates[from.currency] && rates[to.currency])) return '尚未設定匯率，請直接輸入實際轉入金額';
        const amt = Number(String(m.amount).replace(/,/g, ''));
        if (amt > 0) return `依目前匯率約 ${num(amt * rates[from.currency] / rates[to.currency], to.currency)} ${to.currency}，可依實際成交修改`;
        return '留空會依匯率換算';
      };
      hintEl = h('span', { class: 'hint' }, hintText());
      hintFn = () => { hintEl.textContent = hintText(); };
      out.push(h('label', { class: 'field' }, h('span', null, `轉入金額（${to.currency}）`),
        h('input', { name: 'to_amount', inputmode: 'decimal', autocomplete: 'off', value: m.to_amount, 'aria-label': '轉入金額', oninput: (e) => { m.to_amount = e.target.value; } }),
        hintEl));
    }
  } else {
    out.push(catField(m));
  }
  out.push(h('label', { class: 'field grow' }, h('span', null, '備註'),
    h('input', { name: 'note', autocomplete: 'off', value: m.note, maxlength: 500, oninput: (e) => { m.note = e.target.value; } })));
  const adv = editing && m.settle_of ? null : advanceField(m, redraw);
  if (adv) out.push(adv);
  if (m.type !== 'adjust') { out.push(tagField(m, editing ? null : redraw)); out.push(photoField(m)); }
  out.push(h('label', { class: 'field' }, h('span', null, '時間'),
    h('input', { type: 'datetime-local', step: editing ? '1' : '60', value: (m.time || nowLocal()).slice(0, editing ? 19 : 16), 'aria-label': '時間', oninput: (e) => { m.time = e.target.value; } })));
  return out;
}
// Category field: type it with the keyboard, or open the A-Z list of every category used before (the ▾ button, or just start
// typing and the matching ones appear). A name that is not in the list simply becomes a new category.
const catCmp = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; };
function catOptions(current, type, all) {
  const info = S.st.cat_info;
  const kind = type === 'income' || type === 'expense';
  const src = !all && kind && info ? info[type] : (S.st.categories || []);
  const list = src.filter((c) => c && c !== '未分類');
  if (current && current !== '未分類' && !list.includes(current)) list.push(current);   // keep an old transaction's own category in the list
  return list.sort(catCmp);
}
function catField(m) {
  const initial = m.category;                                   // an old transaction's own category stays in the list
  let open = false, hi = -1, shown = [];
  const input = h('input', { name: 'category', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', autocomplete: 'off', autocapitalize: 'off',
    enterkeyhint: 'done', maxlength: 60, value: m.category, placeholder: '未分類', 'aria-label': '類別' });
  const menu = h('ul', { class: 'cat-menu', role: 'listbox', hidden: true });
  const toggle = h('button', { class: 'cat-btn', type: 'button', tabindex: '-1', 'aria-label': '顯示所有類別', title: '顯示所有類別' }, '▾');
  const paint = (all) => {
    const q = input.value.trim().toLowerCase();
    shown = catOptions(initial, m.type, S.catAll).filter((c) => all || !q || c.toLowerCase().includes(q));
    const info = S.st.cat_info, kind = m.type === 'income' || m.type === 'expense';
    const more = kind && info && info[m.type].length < (S.st.categories || []).length;       // the kind's list is shorter than the unified one
    const foot = (more || S.catAll) && kind ? [h('li', { class: 'cat-more', role: 'button', 'data-more': '1' },
      S.catAll ? `只顯示${TYPE_LABEL[m.type]}類別` : `顯示全部類別（${(S.st.categories || []).length}）`)] : [];
    menu.replaceChildren(...shown.map((c, i) => h('li', { role: 'option', class: i === hi ? 'on' : '', 'aria-selected': String(i === hi), 'data-v': c }, catChip(c, 'sm'), h('span', null, c))), ...foot);
    open = shown.length > 0 || foot.length > 0;
    menu.hidden = !open; input.setAttribute('aria-expanded', String(open));
  };
  const close = () => { open = false; hi = -1; menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const pick = (v) => { input.value = v; m.category = v; close(); };
  input.addEventListener('input', () => { m.category = input.value; hi = -1; if (input.value.trim()) paint(false); else close(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!open) paint(true);
      if (shown.length) { hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; paint(menu.dataset.all === '1'); }
    } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && open && hi >= 0) { e.preventDefault(); pick(shown[hi]); }
  });
  // mousedown is stopped so the field keeps its focus (and the phone keeps its keyboard) while a choice is made
  const keep = (e) => e.preventDefault();
  menu.addEventListener('mousedown', keep); toggle.addEventListener('mousedown', keep);
  menu.addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    if (li.dataset.more) { S.catAll = !S.catAll; paint(menu.dataset.all === '1'); return; }       // unified list <-> this kind's list
    pick(li.dataset.v);
  });
  toggle.addEventListener('click', () => { if (open) close(); else { hi = -1; menu.dataset.all = '1'; paint(true); } });
  input.addEventListener('input', () => { menu.dataset.all = ''; });
  return h('label', { class: 'field grow half cat-field' }, h('span', null, '類別'), h('div', { class: 'cat-row' }, input, toggle, menu));
}
function rateTable() {
  const r = { [S.st.base]: 1 };
  S.st.rates.rates.forEach((x) => { if (x.rate) r[x.currency] = x.rate; });
  return r;
}
function payload(m) {
  return { type: m.type, time: m.time || undefined, account_id: m.account_id, to_account_id: m.type === 'transfer' ? m.to_account_id : undefined,
    amount: m.amount, to_amount: m.type === 'transfer' ? m.to_amount : undefined, category: m.type === 'transfer' ? '' : m.category, note: m.note,
    tags: m.type === 'adjust' ? undefined : (m.tags || ''),
    advance: m.type === 'expense' ? (m.advance || '') : '', counterparty: m.type === 'expense' && m.advance ? (m.counterparty || '') : '', due: m.type === 'expense' && m.advance ? (m.due || '') : '',
    no_budget: m.type === 'expense' ? !!m.no_budget : false, no_stats: m.type === 'expense' ? !!m.no_stats : false,
    auto_settle: m.type === 'expense' && m.advance && m.due && m.auto_settle ? m.auto_settle : (m.type === 'expense' && m.advance ? '' : undefined) };
}

function entryBar() {
  const wrap = h('form', { class: 'entry', 'aria-label': '記一筆' });
  const m = S.entry;
  const redraw = () => { const n = entryBar(); wrap.replaceWith(n); const a = $('input[name=amount]', n); if (a && m.amount === '' && !onTouch()) a.focus(); };
  const pin = pinBar();
  if (pin) wrap.appendChild(pin);
  wrap.appendChild(templateBar(m, redraw));
  txFields(m, redraw).forEach((f) => wrap.appendChild(f));
  wrap.appendChild(h('button', { class: 'btn primary', type: 'submit' }, '記下'));
  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await recordEntry(m);
      await refresh();
      const f = $('input[name=amount]'); if (f && !onTouch()) f.focus();
    } catch (err) { fail(err); }
  });
  return wrap;
}
// Save the entry in `m` as a new transaction (shared by the quick-entry bar and the "add" dialogs), then clear what should not carry over.
async function recordEntry(m) {
  const a = acct(m.account_id);
  const made = await api('POST', '/api/transactions', payload(m));
  let lost = 0;
  if (made.queued) { toast('電腦連不上：這筆已先存在手機，電腦回來後自動補送'); if (m.photos && m.photos.length) toast('照片離線時存不了；補送後到編輯再加', true); }
  else if (m.photos && m.photos.length) lost = await uploadPhotos(made.id, m);
  let tplMsg = '';
  if (m.save_tpl) { try { tplMsg = `，已${await saveEntryAsTemplate(m)}範本`; } catch (e) { toast(`交易已記下，但範本沒存成功：${e.message || e}`, true); } }
  let repMsg = '';
  if (m.repeat && !made.queued) { try { repMsg = `，之後每月 ${Number(((m.time ? String(m.time) : nowLocal()).slice(8, 10)))} 日自動記（下一次 ${await createRepeatRule(m)}）`; } catch (e) { toast(`交易已記下，但定期交易沒建成功：${e.message || e}`, true); } }
  else if (m.repeat) toast('離線時沒辦法設定定期交易；電腦連上後再到「設定 → 定期交易」新增', true);
  if (!made.queued) toast(`已記下${m.advance ? ADV_LABEL[m.advance] + '的' : ''}${TYPE_LABEL[m.type]}　${num(Number(String(m.amount).replace(/,/g, '')), a ? a.currency : 'TWD')} ${a ? a.currency : ''}　${a ? a.name : ''}${tplMsg}${repMsg}`);
  if (lost) toast(`有 ${lost} 張照片沒存成功，交易本身已記下；可以到編輯再加一次`, true);
  Object.assign(m, { amount: '', to_amount: '', note: '', category: '', tags: pinnedTags(), time: '', advance: '', counterparty: '', due: '', auto_settle: '', no_budget: false, no_stats: false, save_tpl: false, tpl_ask: false, repeat: false });
  watchSync();
  return made;
}

function openTxDialog(tx) {
  const m = { type: tx.type, account_id: tx.account_id, to_account_id: tx.to_account_id, amount: String(tx.amount), to_amount: tx.to_amount == null ? '' : String(tx.to_amount), category: tx.category, note: tx.note, tags: (tx.tags || []).join(' '), advance: tx.advance || '', counterparty: tx.counterparty || '', due: tx.due || '', auto_settle: tx.auto_account_id || '', no_budget: !!tx.no_budget, no_stats: !!tx.no_stats, settle_of: tx.settle_of || null, receipts: [...(tx.receipts || [])], photos: [], dropped: [], time: tx.time };
  const holder = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const draw = () => { holder.replaceChildren(...[h('div', { class: 'grid2' }, txFields(m, draw, { editing: true }).map((f) => (f.classList && f.classList.contains('ccy-tag')) ? null : f))].filter(Boolean)); };
  draw();
  const editDlg = openDialog({
    title: '編輯交易', body: holder,
    extraFoot: h('button', { class: 'btn danger', type: 'button', style: 'margin-right:auto', onclick: async (e) => {
      const ok = await confirmBox({ title: '刪除這筆交易？', message: h('p', null, `${shortTime(tx.time)}　${TYPE_LABEL[tx.type]}　${num(tx.amount, tx.currency)} ${tx.currency}　${tx.account}。帳戶餘額會立刻重新計算。`), confirmLabel: '刪除', danger: true });
      if (!ok) return;
      try { const r = await api('DELETE', `/api/transactions/${tx.id}`); e.target.closest('dialog').close(); await afterChange('已刪除', undoAction(r.undo)); } catch (err) { fail(err); }
    } }, '刪除'),
    primary: { label: '儲存修改', run: async () => {
      await api('PUT', `/api/transactions/${tx.id}`, payload(m));
      await dropReceipts(m);
      const lost = await uploadPhotos(tx.id, m);
      await afterChange(lost ? `已儲存，但有 ${lost} 張照片沒存成功` : '已儲存修改');
    } },
  });
  editDlg.addEventListener('close', () => forgetPhotos(m));
}

// ------------------------------------------------------------------ overview
// One setting for the monthly totals on the overview and for the reports: do transfers count as income / expense?
function transfersSwitch(note) {
  return h('div', { class: 'tr-switch' },
    h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: !!S.st.prefs.count_transfers, onchange: async (e) => {
      try { await api('PUT', '/api/settings', { count_transfers: e.target.checked }); await afterChange(); } catch (err) { e.target.checked = !e.target.checked; fail(err); }
    } }), h('span', null, '轉帳也算收支')),
    note ? h('span', { class: 'hint' }, note) : null);
}
// Monthly budgets: one bar per category with a limit, most-used first. Green until 80 %, amber up to the limit, red beyond it.
function budgetCard() {
  const list = S.st.summary.budgets || [], base = S.st.base;
  if (!list.length) return null;
  const tone = (r) => (r > 1 ? 'over' : r >= 0.8 ? 'warn' : 'ok');
  const row = (b) => h('div', { class: `bud-row ${tone(b.ratio)}` },
    h('div', { class: 'bud-top' }, catChip(b.category, 'sm'), h('b', null, b.category),
      h('span', { class: 'bud-nums' }, `${num(b.spent, base)} / ${num(b.limit, base)}`)),
    h('div', { class: 'bud-bar', role: 'progressbar', 'aria-label': `${b.category} 預算`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(b.ratio * 100)) },
      h('i', { style: `width:${Math.min(100, b.ratio * 100).toFixed(1)}%` })),
    h('div', { class: 'bud-note' }, b.ratio > 1 ? `超出 ${num(b.spent - b.limit, base)}（${Math.round(b.ratio * 100)}%）` : `還可以花 ${num(b.limit - b.spent, base)}（已用 ${Math.round(b.ratio * 100)}%）`));
  const shown = S.budAll ? list : list.slice(0, 5);
  return h('section', { class: 'section bud-card' },
    h('div', { class: 'section-head' }, h('h2', null, `${S.st.summary.month.label} 預算`), h('a', { class: 'btn sm ghost', href: '#/categories' }, '調整預算')),
    h('div', { class: 'rows' }, shown.map(row),
      list.length > 5 ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { S.budAll = !S.budAll; renderRoute(); } }, S.budAll ? '只顯示最接近上限的 5 個' : `顯示全部 ${list.length} 個`) : null));
}
async function viewOverview(view) {
  const s = S.st.summary, base = S.st.base;
  const tiles = await overviewTiles();
  view.append(
    h('div', { class: 'page-head' }, h('h1', null, '總覽', eyeButton('overview'))),
    tiles, recurringBanner() || '', owedBanner() || '',
    h('div', { class: 'worth' },
      h('div', null, h('div', { class: 'label' }, `總資產（${base}）`), h('div', { class: 'big' }, num(s.total, base), h('small', null, base))),
      h('div', { class: 'month' },
        h('div', null, h('span', { class: 'label muted' }, `${s.month.label} 收入`), h('b', { class: 'pos' }, num(s.month.income, base))),
        h('div', null, h('span', { class: 'label muted' }, '支出'), h('b', { class: 'neg' }, num(s.month.expense, base))),
        h('div', null, h('span', { class: 'label muted' }, '結餘'), h('b', { class: (s.month.income - s.month.expense) >= 0 ? 'pos' : 'neg' }, num(s.month.income - s.month.expense, base, true))))),
    transfersSwitch(s.month.with_transfers ? `本月含 ${s.month.transfers} 筆轉帳：轉出算支出、轉入算收入（換匯與買賣股票也是轉帳）` : ''),
  );
  const bc = budgetCard(); if (bc) view.append(bc);
  if (S.st.notice) view.append(h('div', { class: 'banner' }, h('span', null, S.st.notice)));
  if (s.missing_rates.length) {
    view.append(h('div', { class: 'banner' }, h('span', null, `缺少 ${s.missing_rates.join('、')} 的匯率，這些帳戶還沒有算進總資產與報表。`),
      h('a', { class: 'btn sm', href: '#/settings' }, '去填匯率')));
  }
  const rows = S.st.accounts.filter((a) => !a.archived || a.balance !== 0);
  const ov = S.ov;
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '帳戶'), h('span', { class: 'head-btns' },
      h('button', { class: 'btn sm' + (ov.editAcc ? ' primary' : ' ghost'), type: 'button', 'aria-pressed': String(!!ov.editAcc), onclick: () => { ov.editAcc = !ov.editAcc; renderRoute(); } }, ov.editAcc ? '完成' : '編輯帳戶'),
      h('button', { class: 'btn sm ghost', onclick: () => openCalibrateDialog(null) }, '校正餘額'), h('a', { class: 'btn sm ghost', href: '#/accounts' }, '管理帳戶'))),
    h('p', { class: 'hint tile-hint' }, ov.editAcc ? '點一個帳戶來換圖示、改名、校正餘額；也可以直接拖曳磚塊換位置。' : '點一下看這個帳戶的交易；連點兩下編輯帳戶與圖示；拖曳磚塊換位置（手機先按住一下再拖）。'),
    accountTiles(rows, base)));
  const recent = await api('GET', '/api/transactions?limit=8');
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '最近的紀錄'), h('a', { class: 'btn sm ghost', href: '#/transactions' }, '全部交易')),
    txTable(recent.items, false)));
}

// -------------------------------------------------------------- transactions
// `viewer` = the account the list is filtered to. A transfer is then shown from that account's side:
// money going out is a negative amount (like spending), money coming in is positive (like income).
function amountCell(t, viewer) {
  if (t.type === 'transfer' && viewer && S.txf.transfers) {
    if (t.account_id == viewer) return money(-t.amount, t.currency, { sign: true, tone: true });
    if (t.to_account_id == viewer) return money(t.to_amount, t.to_currency, { sign: true, tone: true });
  }
  if (t.type === 'transfer') {
    const cross = t.currency !== t.to_currency;
    return h('span', { class: 'num' }, `${num(t.amount, t.currency)} ${t.currency}`, cross ? h('span', { class: 'muted' }, ` → ${num(t.to_amount, t.to_currency)} ${t.to_currency}`) : null);
  }
  const signed = t.type === 'expense' ? -t.amount : t.amount;
  return money(signed, t.currency, { sign: true, tone: true });
}
// Balance after the transaction. For a transfer seen from the receiving account, show that account's balance.
function balanceCell(t, viewer) {
  if (t.type === 'transfer' && viewer && S.txf.transfers && t.to_account_id == viewer)
    return h('td', { class: 'r muted c-bal', title: `${t.account} 轉出後：${num(t.new_balance, t.currency)} ${t.currency}` }, num(t.to_new_balance, t.to_currency));
  return h('td', { class: 'r muted c-bal', title: t.type === 'transfer' ? `${t.to_account} 轉入後：${num(t.to_new_balance, t.to_currency)} ${t.to_currency}` : '' }, num(t.new_balance, t.currency));
}
function txTable(items, withBalance = true, viewer = null, sel = null, days = null) {
  if (!items.length) return h('div', { class: 'empty' }, h('b', null, '還沒有符合的交易'), '用上方的「記一筆」開始記帳。');
  return h('table', { class: 'ledger tx' },
    h('thead', null, h('tr', null, sel ? h('th', { class: 'c-sel' }, '') : null, h('th', null, '時間'), h('th', null, '類型'), h('th', null, '類別'), h('th', null, '備註'), h('th', null, '帳戶'), h('th', { class: 'r' }, '金額'), withBalance ? h('th', { class: 'r' }, '餘額') : null, h('th', null, ''))),
    h('tbody', null, items.flatMap((t, i) => [days && (i === 0 || items[i - 1].time.slice(0, 10) !== t.time.slice(0, 10))
      ? dayHeadRow(days.map[t.time.slice(0, 10)], t.time.slice(0, 10), days.base, (sel ? 1 : 0) + 7 + (withBalance ? 1 : 0), days.folded.has(t.time.slice(0, 10)),
        (key, row) => { const now = !days.folded.has(key); if (now) days.folded.add(key); else days.folded.delete(key); toggleDay(row.closest('table'), row, key, now); }) : null,
    h('tr', { class: sel && S.sel.has(t.id) ? 'picked' : '', ...(days ? { 'data-of': t.time.slice(0, 10), hidden: days.folded.has(t.time.slice(0, 10)) } : {}) },
      sel ? h('td', { class: 'c-sel' }, h('input', { type: 'checkbox', checked: S.sel.has(t.id), 'aria-label': `選取 ${shortTime(t.time)} ${t.note || t.category || ''}`, onchange: (e) => { if (e.target.checked) S.sel.add(t.id); else S.sel.delete(t.id); e.target.closest('tr').classList.toggle('picked', e.target.checked); sel.changed(); } })) : null,
      h('td', { class: 'when' }, shortTime(t.time)),
      h('td', { class: 'c-kind' }, h('span', { class: `kind ${t.type}` }, TYPE_LABEL[t.type])),
      h('td', { class: 'c-cat' }, t.type === 'transfer' || t.type === 'adjust' ? typeChip(t.type)
        : h('button', { class: 'chip-btn', type: 'button', title: `更換「${t.category || '未分類'}」的圖示`, 'aria-label': `更換「${t.category || '未分類'}」的圖示`, onclick: () => editCategoryIcon(t.category || '未分類') }, catChip(t.category || '未分類')),
        h('span', { class: 'cat-name' }, t.category || '')),
      h('td', { class: 'note', title: t.note }, t.note, advBadge(t), receiptMark(t), tagChips(t)),
      h('td', { class: 'c-acct' }, t.type === 'transfer' ? `${t.account} → ${t.to_account}` : t.account),
      h('td', { class: 'r c-amt' }, amountCell(t, viewer)),
      withBalance ? balanceCell(t, viewer) : null,
      h('td', { class: 'act' }, h('button', { class: 'btn sm ghost', onclick: () => openTxDialog(t) }, '編輯')))].filter(Boolean))));
}

// The row under the search bar: income / expense over EVERY transaction that matches (not just the rows loaded below).
function tallyBar(r, filtered, onToggle) {
  const t = r.totals, base = t.base, c = t.count;
  const cell = (label, value, cls) => h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, label), h('b', { class: `tally-val ${cls}` }, value, h('span', { class: 'ccy' }, base)));
  const side = [];
  if (c.transfer) {
    if (t.transfers_counted) side.push(`含 ${c.transfer} 筆轉帳：轉出的帳戶算支出，轉入的帳戶算收入${t.both_sides ? '（沒有指定帳戶，所以兩邊都算，淨額不變）' : ''}`);
    else side.push(`另有 ${c.transfer} 筆轉帳沒有算進去`);
  }
  if (c.adjust) side.push(`${c.adjust} 筆歸零調整不算收入或支出`);
  const foreign = t.by_currency.filter((x) => x.currency !== base);
  if (foreign.length) side.push(`含 ${foreign.map((x) => x.currency).join('、')}，已依目前匯率換算成 ${base}`);
  if (t.missing_rates.length) side.push(`缺少 ${t.missing_rates.join('、')} 的匯率，這些金額沒有算進去`);
  return h('div', { class: 'tally', role: 'status', 'aria-label': '符合條件的統計' },
    h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, filtered ? '符合條件' : '全部交易'), h('b', { class: 'tally-val' }, `${r.total} 筆`)),
    cell('總收入', num(t.income, base), 'pos'),
    cell('總支出', num(t.expense, base), 'neg'),
    cell('淨額（收入 − 支出）', num(t.net, base, true), t.net >= 0 ? 'pos' : 'neg'),
    h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: S.txf.transfers, onchange: (e) => onToggle(e.target.checked) }), h('span', null, '轉帳也算收支')),
    side.length ? h('div', { class: 'tally-note hint' }, side.join('；')) : null);
}

async function viewTransactions(view) {
  const f = S.txf;
  view.append(h('div', { class: 'page-head' }, h('h1', null, '交易', eyeButton('transactions'))), entryBar());
  const listBox = h('div');
  const tallyBox = h('div');
  const selBox = h('div');
  let timer, shown = [];
  const paintBar = () => { selBox.replaceChildren(...(S.selMode ? [selectionBar(shown, (full) => { if (full) paintList(); else paintBar(); })] : [])); };
  const paintList = (r) => {
    if (r) listBox._r = r;
    r = listBox._r; if (!r) return;
    const base = r.totals.base;
    if (f.group === 'month' || f.group === 'year') {                     // one line per month / year; a click goes one level down
      shown = [];
      listBox.replaceChildren(periodTable(r.groups || [], f.group, base, (key) => {
        const [from, to] = periodRange(f.group, key);
        f.back = { group: f.group, from: f.from, to: f.to };
        Object.assign(f, { from, to, group: f.group === 'year' ? 'month' : 'day', limit: TX_PAGE });
        renderRoute();
      }), h('div', { class: 'hint', style: 'padding:10px' }, `共 ${r.total} 筆，${(r.groups || []).length} 個${f.group === 'year' ? '年' : '月'}　點一列看${f.group === 'year' ? '每月' : '每日'}明細`));
      paintBar();
      return;
    }
    shown = r.items;
    const live = new Set(shown.map((t) => t.id));
    S.sel.forEach((id) => { if (!live.has(id)) S.sel.delete(id); });       // a filter hid it: it is no longer selected
    const days = { base, folded: f.folded, map: Object.fromEntries((r.groups || []).map((g) => [g.key, g])) };
    listBox.replaceChildren(txTable(r.items, true, f.account_id, S.selMode ? { changed: paintBar } : null, days),
      r.total > r.items.length ? h('div', { style: 'padding:14px 0;text-align:center' }, h('span', { class: 'muted' }, `顯示 ${r.items.length} / ${r.total} 筆　`), h('button', { class: 'btn sm', onclick: () => { f.limit += 100; load(); } }, '載入更多')) : h('div', { class: 'hint', style: 'padding:10px' }, `共 ${r.total} 筆`));
    paintBar();
  };
  const load = async () => {
    const qs = new URLSearchParams({ limit: f.limit, group: f.group });
    if (f.tag) qs.set('tag', f.tag);
    if (!f.transfers) qs.set('transfers', '0');
    if (f.q) qs.set('q', f.q); if (f.type) qs.set('type', f.type); if (f.account_id) qs.set('account_id', f.account_id);
    if (f.from) qs.set('from', f.from); if (f.to) qs.set('to', f.to);
    try {
      const r = await api('GET', '/api/transactions?' + qs);
      tallyBox.replaceChildren(tallyBar(r, !!(f.q || f.type || f.account_id || f.from || f.to || f.tag), (on) => { f.transfers = on; f.limit = TX_PAGE; load(); }));
      paintList(r);
    } catch (e) { tallyBox.replaceChildren(); selBox.replaceChildren(); listBox._r = null; listBox.replaceChildren(h('div', { class: 'empty' }, e.message)); }
  };
  const selBtn = h('button', { class: 'btn ghost', type: 'button', 'aria-pressed': String(S.selMode), onclick: () => {
    S.selMode = !S.selMode; if (!S.selMode) S.sel = new Set();
    selBtn.setAttribute('aria-pressed', String(S.selMode)); selBtn.textContent = S.selMode ? '結束選取' : '選取多筆'; paintList();
  } }, S.selMode ? '結束選取' : '選取多筆');
  if (f.group !== 'day' && S.selMode) { S.selMode = false; S.sel = new Set(); }
  view.append(h('div', { class: 'period-bar' },
    periodSwitch(f.group, (k) => { f.group = k; f.back = null; f.limit = TX_PAGE; renderRoute(); }),
    f.group === 'day' ? h('span', { class: 'fold-btns' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const r = listBox._r; if (r) { (r.groups || []).forEach((g) => f.folded.add(g.key)); paintList(); } } }, '全部收合'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.folded.clear(); paintList(); } }, '全部展開')) : null,
    f.back ? h('button', { class: 'btn ghost', type: 'button', onclick: () => {
      const b = f.back; Object.assign(f, { group: b.group, from: b.from, to: b.to, back: null, limit: TX_PAGE }); renderRoute();
    } }, `‹ 返回按${f.back.group === 'year' ? '年' : '月'}`) : null));
  view.append(h('div', { class: 'filters' },
    h('label', { class: 'field' }, h('span', null, '搜尋'), h('input', { type: 'search', value: f.q, placeholder: '備註、類別、帳戶、標籤', oninput: (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => { f.limit = 100; load(); }, 250); } })),
    h('label', { class: 'field' }, h('span', null, '類型'), h('select', { onchange: (e) => { f.type = e.target.value; load(); } },
      [['', '全部'], ['income', '收入'], ['expense', '支出'], ['transfer', '轉帳'], ['adjust', '調整']].map(([v, l]) => h('option', { value: v, selected: f.type === v }, l)))),
    h('label', { class: 'field' }, h('span', null, '帳戶'), h('select', { onchange: (e) => { f.account_id = e.target.value; load(); } },
      h('option', { value: '' }, '全部'), S.st.accounts.map((a) => h('option', { value: a.id, selected: String(a.id) === String(f.account_id) }, a.name)))),
    (S.st.tag_list && S.st.tag_list.length) || f.tag ? h('label', { class: 'field' }, h('span', null, '標籤'), h('select', { onchange: (e) => { f.tag = e.target.value; f.limit = 100; load(); } },
      h('option', { value: '' }, '全部'), ...[...new Set([...(S.st.tag_list || []).map((x) => x.tag), ...(f.tag ? [f.tag] : [])])].map((t) => h('option', { value: t, selected: t === f.tag }, `#${t}`)))) : null,
    h('label', { class: 'field' }, h('span', null, '從'), h('input', { type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; load(); } })),
    h('label', { class: 'field' }, h('span', null, '到'), h('input', { type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; load(); } })),
    f.group === 'day' ? selBtn : null,
    h('button', { class: 'btn ghost', onclick: () => { Object.assign(f, { q: '', type: '', account_id: '', from: '', to: '', tag: '', limit: TX_PAGE, back: null }); renderRoute(); } }, '清除篩選')));
  view.append(tallyBox, selBox, listBox);
  if (S.focusAdd) { S.focusAdd = false; setTimeout(() => { const a = $('input[name=amount]'); if (a) { a.scrollIntoView({ block: 'center' }); if (!onTouch()) a.focus(); } }, 60); }
  await load();
}

// ------------------------------------------------------------------ accounts
function currencyInput(value, disabled) {
  return h('label', { class: 'field' }, h('span', null, '幣別'),
    h('input', { name: 'currency', list: 'ccy-list', value, maxlength: 3, disabled, autocomplete: 'off', style: 'text-transform:uppercase' }),
    h('datalist', { id: 'ccy-list' }, S.st.currencies.map((c) => h('option', { value: c }))));
}
function openAccountDialog(a) {
  const isNew = !a;
  const name = h('input', { name: 'name', value: a ? a.name : '', maxlength: 40, autocomplete: 'off', placeholder: '例如 Wise USD、玉山銀行' });
  const cur = currencyInput(a ? a.currency : S.st.base, a && a.tx_count > 0);
  const opening = h('input', { name: 'opening', inputmode: 'decimal', value: a ? String(a.opening) : '0', autocomplete: 'off' });
  // icon: '' / '' = chosen automatically (bank, stock, cash...) until the user picks one
  const pick = { icon: a ? a.icon : '', color: a ? a.color : '' };
  const iconBtn = h('button', { class: 'btn ghost icon-pick', type: 'button' });
  const paintIcon = () => {
    const l = accLook({ name: name.value, stock: a && a.stock, icon: pick.icon, color: pick.color });
    iconBtn.replaceChildren(chipEl(l.icon, l.color), h('span', null, pick.icon || pick.color ? '更換圖示' : '圖示：自動（點一下更換）'));
  };
  iconBtn.addEventListener('click', () => {
    const l = accLook({ name: name.value, stock: a && a.stock, icon: pick.icon, color: pick.color });
    openIconPicker({ title: '帳戶圖示', sub: '這個帳戶會用這個圖示', name: name.value || '帳戶', icon: l.icon, color: l.color,
      onSave: async (icon, color) => { pick.icon = icon; pick.color = color; paintIcon(); },
      onReset: (pick.icon || pick.color) ? async () => { pick.icon = ''; pick.color = ''; paintIcon(); } : null });
  });
  name.addEventListener('input', paintIcon); paintIcon();
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('label', { class: 'field' }, h('span', null, '帳戶名稱'), name),
    h('div', { class: 'field' }, h('span', null, '圖示'), iconBtn),
    h('div', { class: 'grid2' }, cur,
      h('label', { class: 'field' }, h('span', null, '期初餘額'), opening, h('span', { class: 'hint' }, '開始記帳前，這個帳戶裡原本有的金額'))),
    a && a.tx_count > 0 ? h('p', { class: 'hint' }, '這個帳戶已有交易，幣別無法更改。') : null);
  const foot = a ? h('div', { style: 'margin-right:auto;display:flex;gap:8px' },
    h('button', { class: 'btn', type: 'button', onclick: async (e) => { try { await api('PUT', `/api/accounts/${a.id}`, { archived: !a.archived }); e.target.closest('dialog').close(); await afterChange(a.archived ? '已取消封存' : '已封存，帳戶清單不再顯示'); } catch (err) { fail(err); } } }, a.archived ? '取消封存' : '封存'),
    h('button', { class: 'btn danger', type: 'button', disabled: a.tx_count > 0, title: a.tx_count > 0 ? '有交易的帳戶不能刪除；請先「歸零」並選擇清除紀錄' : '', onclick: async (e) => {
      const dlg = e.target.closest('dialog');
      if (!(await confirmBox({ title: `刪除帳戶「${a.name}」？`, message: h('p', null, '這個帳戶沒有任何交易，刪除後無法復原。'), confirmLabel: '刪除', danger: true }))) return;
      try { await api('DELETE', `/api/accounts/${a.id}`); dlg.close(); await afterChange('已刪除帳戶'); } catch (err) { fail(err); }
    } }, '刪除帳戶')) : null;
  openDialog({
    title: isNew ? '新增帳戶' : `編輯帳戶：${a.name}`, body, extraFoot: foot,
    primary: {
      label: isNew ? '新增帳戶' : '儲存',
      run: async () => {
        const data = { name: name.value, opening: opening.value, icon: pick.icon, color: pick.color };
        const ccy = cur.querySelector('input').value.trim().toUpperCase();
        if (isNew || !cur.querySelector('input').disabled) data.currency = ccy;
        if (isNew) await api('POST', '/api/accounts', data); else await api('PUT', `/api/accounts/${a.id}`, data);
        const needRate = ccy && ccy !== S.st.base && !S.st.rates.rates.some((r) => r.currency === ccy && r.rate);
        await afterChange(isNew ? `已新增帳戶「${data.name}」` : '已儲存');
        if (needRate) toast(`${ccy} 還沒有匯率，請到「設定」填寫，才會算進總資產。`);
      },
    },
  });
}

// Balance calibration: pick an account, see what the book says, type what the bank really shows; the gap is
// recorded as an ordinary income/expense (category "difference", note "誤差").
function openCalibrateDialog(first) {
  const pool = S.st.accounts.filter((a) => !a.archived && !a.stock);
  if (!pool.length) return toast('沒有可以校正的帳戶');
  const byId = (id) => pool.find((a) => String(a.id) === String(id)) || pool[0];
  let acct = byId(first && first.id);
  const sel = h('select', { name: 'account', 'aria-label': '帳戶', onchange: (e) => { acct = byId(e.target.value); paint(); } },
    pool.map((a) => h('option', { value: a.id, selected: a.id === acct.id }, `${a.name}（${a.currency}）`)));
  const nowBox = h('div', { class: 'cal-now' });
  const actual = h('input', { name: 'actual', autocomplete: 'off', autocapitalize: 'off', placeholder: '帳戶實際顯示的餘額', 'aria-label': '實際餘額', oninput: () => paint() });
  const preview = h('div', { class: 'cal-preview', role: 'status' });
  const read = () => {
    const t = actual.value.replace(/[,\s]/g, '').replace('−', '-');
    if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
    return Number(t);
  };
  function paint() {
    nowBox.replaceChildren(h('span', { class: 'muted' }, '目前餘額（帳上）'), h('b', { class: 'num' + (acct.balance < 0 ? ' neg' : '') }, num(acct.balance, acct.currency, false, true), h('span', { class: 'ccy' }, acct.currency)));
    const v = read(), d = digits(acct.currency), k = 10 ** d;
    if (actual.value.trim() === '') { preview.className = 'cal-preview'; preview.textContent = '輸入實際餘額，這裡會顯示差額與會記下的內容。'; return; }
    if (v == null) { preview.className = 'cal-preview bad'; preview.textContent = '請輸入數字，例如 12345.6'; return; }
    const diff = Math.round(v * k - acct.balance * k) / k;
    if (diff === 0) { preview.className = 'cal-preview'; preview.textContent = '和帳上餘額一樣，不需要校正。'; return; }
    preview.className = 'cal-preview ' + (diff > 0 ? 'pos' : 'neg');
    preview.replaceChildren(
      h('div', null, `差額 `, h('b', { class: 'num' }, num(diff, acct.currency, true, true)), ` ${acct.currency}　→　記一筆`, h('b', null, diff > 0 ? '收入' : '支出'), `，`, h('b', { class: 'num' }, num(Math.abs(diff), acct.currency, false, true)), ` ${acct.currency}`),
      h('div', { class: 'muted' }, '類別 difference、備註「誤差」；校正後帳上餘額 = ', h('b', { class: 'num' }, num(v, acct.currency, false, true)), ` ${acct.currency}`));
  }
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('label', { class: 'field' }, h('span', null, '帳戶'), sel), nowBox,
    h('label', { class: 'field' }, h('span', null, '實際餘額'), actual), preview,
    h('p', { class: 'hint', style: 'margin:0' }, '漏記帳時用：差額會記成一筆收入（帳上比實際少）或支出（帳上比實際多），之後可以在「交易」頁看到或刪除。'));
  paint();
  openDialog({
    title: '校正帳戶餘額', body,
    primary: {
      label: '校正',
      run: async () => {
        if (read() == null) throw new Error('請輸入實際餘額（數字）');
        const r = await api('POST', `/api/accounts/${acct.id}/calibrate`, { actual: actual.value.replace(/[,\s]/g, '').replace('−', '-'), current: acct.balance });
        if (!r.changed) throw new Error('和帳上餘額一樣，不需要校正');
        await afterChange(`「${acct.name}」已校正：記了一筆${r.type === 'income' ? '收入' : '支出'} ${num(r.amount, r.currency, false, true)} ${r.currency}`);
      },
    },
  });
}

async function openResetDialog(a) {
  let prev;
  try { prev = await api('GET', `/api/accounts/${a.id}/wipe-preview`); } catch (e) { return fail(e); }
  let mode = 'adjust';
  const radios = [
    ['adjust', '保留紀錄，餘額調為 0', `新增一筆「歸零調整」交易（${num(-a.balance, a.currency, true)} ${a.currency}），之前的紀錄都留著，也不會算進收入或支出。`],
    ['wipe', '清除這個帳戶的所有紀錄，從零開始', `刪除 ${prev.count} 筆交易並把期初餘額設為 0。適合輸入錯誤太多、想重來的帳戶。執行前會自動備份。`],
  ];
  const warn = h('div', { class: 'banner', hidden: true });
  const typed = h('input', { type: 'text', autocomplete: 'off', 'aria-label': '輸入帳戶名稱確認' });
  const typedBox = h('label', { class: 'field', hidden: true }, h('span', null, `請輸入帳戶名稱「${a.name}」以確認`), typed);
  const sync = () => {
    warn.hidden = !(mode === 'wipe' && prev.transfers > 0);
    typedBox.hidden = mode !== 'wipe';
    const go = document.querySelector('dialog[open] button[type=submit]');
    if (go) { go.classList.toggle('danger', mode === 'wipe'); go.classList.toggle('solid', mode === 'wipe'); go.textContent = mode === 'wipe' ? '清除紀錄並歸零' : '歸零'; }
    if (!warn.hidden) warn.replaceChildren(`其中 ${prev.transfers} 筆是轉帳，刪除後「${prev.affected_accounts.join('、')}」的餘額也會跟著改變。`);
  };
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('p', { style: 'margin:0' }, `目前餘額：`, money(a.balance, a.currency, { tone: true })),
    radios.map(([v, t, d]) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'mode', checked: v === 'adjust', onchange: () => { mode = v; sync(); } }), h('span', null, h('b', null, t), h('br'), h('span', { class: 'muted' }, d)))),
    warn, typedBox);
  openDialog({
    title: `歸零：${a.name}`, body,
    primary: {
      label: '歸零', danger: false,
      run: async () => {
        if (mode === 'wipe' && typed.value.trim() !== a.name) throw new Error('帳戶名稱不相符');
        const r = await api('POST', `/api/accounts/${a.id}/reset`, { mode });
        await afterChange(!r.changed ? '這個帳戶的餘額本來就是 0' : mode === 'adjust' ? `「${a.name}」已歸零` : `已清除 ${r.deleted} 筆交易，「${a.name}」已歸零（備份在 backups 資料夾）`);
      },
    },
  });
}

async function viewAccounts(view) {
  const base = S.st.base;
  const active = S.st.accounts.filter((a) => !a.archived), archived = S.st.accounts.filter((a) => a.archived);
  const table = (rows) => h('table', { class: 'ledger' },
    h('thead', null, h('tr', null, h('th', null, '帳戶'), h('th', { class: 'r' }, '期初餘額'), h('th', { class: 'r' }, '目前餘額'), h('th', { class: 'r' }, `約合 ${base}`), h('th', { class: 'r' }, '交易數'), h('th', null, ''))),
    h('tbody', null, rows.map((a) => h('tr', { class: a.archived ? 'archived' : '' },
      h('td', { class: 'name' }, accChip(a, 'sm'), a.name, h('span', { class: 'badge' }, a.currency)),
      h('td', { class: 'r muted' }, num(a.opening, a.currency)),
      h('td', { class: 'r' }, money(a.balance, a.currency, { tone: true, tag: false })),
      h('td', { class: 'r muted' }, a.currency === base ? '' : (a.base_value == null ? '需要匯率' : num(a.base_value, base))),
      h('td', { class: 'r muted' }, a.tx_count),
      h('td', { class: 'act' },
        h('button', { class: 'btn sm ghost', onclick: () => openAccountDialog(a) }, '編輯'),
        a.archived || a.stock ? null : h('button', { class: 'btn sm ghost', onclick: () => openCalibrateDialog(a) }, '校正'),
        h('button', { class: 'btn sm ghost', onclick: () => openResetDialog(a) }, '歸零'))))));
  view.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '帳戶', eyeButton('accounts')), h('p', { class: 'sub' }, '每個帳戶有自己的幣別。餘額由期初餘額加上所有交易算出，所以修改或刪除舊交易時，餘額會自動跟著對。')),
      h('div', { class: 'head-btns' }, h('button', { class: 'btn', onclick: () => openCalibrateDialog(null) }, '校正餘額'), h('button', { class: 'btn primary', onclick: () => openAccountDialog(null) }, '新增帳戶'))),
    h('section', { class: 'section' }, active.length ? table(active) : h('div', { class: 'empty' }, h('b', null, '還沒有帳戶'), '按右上角「新增帳戶」開始。')));
  if (archived.length) view.append(h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '已封存')), table(archived)));
}

// ------------------------------------------------------------------- reports
function chartDefaults() {
  Chart.defaults.color = css('--ink-2'); Chart.defaults.borderColor = css('--line-2');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}
const yAxis = () => ({ beginAtZero: true, ticks: { callback: (v) => (isHidden() ? '' : v) } });
function mkChart(canvas, cfg) { chartDefaults(); const c = new Chart(canvas, cfg); S.charts.push(c); return c; }
function groupTooltip(groups, base, total) {
  return {
    callbacks: {
      label: (ctx) => { const v = ctx.parsed.y ?? ctx.parsed; return ` ${num(v, base)} ${base}（${total ? (v / total * 100).toFixed(1) : 0}%）`; },
      afterLabel: (ctx) => { const g = groups[ctx.dataIndex]; return [`筆數：${g.count}`, g.accounts.length ? `帳戶：${g.accounts.join('、')}` : '', g.notes.length ? `備註：${g.notes.join('、')}` : ''].filter(Boolean); },
    },
  };
}
function colorsFor(groups) { return groups.map((g, i) => g.label === '其他' ? OTHER_COLOR : PALETTE[i % PALETTE.length]); }

// The list next to / under each chart: colour dot, the category's own picture, name, amount and share. Click a row (pie) to hide / show its slice.
function legendList(part, colors, byCategory, base, chart) {
  const total = part.total;
  const rows = part.groups.map((g, i) => {
    const look = !byCategory || g.label === '其他' ? null : g.label === '轉帳' ? typeChip('transfer') : catChip(g.label, 'sm');
    const row = h('button', { class: 'lg-row', type: 'button', disabled: !chart, title: chart ? '點一下隱藏／顯示這一塊' : '' },
      h('i', { class: 'lg-dot', style: `background:${colors[i]}` }), look, h('span', { class: 'lg-name' }, g.label),
      h('span', { class: 'lg-val' }, num(g.total, base), h('em', null, total ? ` ${(g.total / total * 100).toFixed(1)}%` : '')));
    if (chart) row.addEventListener('click', () => { chart.toggleDataVisibility(i); chart.update(); row.classList.toggle('off', !chart.getDataVisibility(i)); });
    return row;
  });
  return h('div', { class: 'legend', role: 'list', 'aria-label': '圖例' }, rows);
}
function drawBreakdown(box, data, kind, byCategory = true) {
  const base = data.base;
  for (const [key, title, tone] of [['income', '收入', 'pos'], ['expense', '支出', 'neg']]) {
    const part = data[key];
    const cv = h('canvas', { role: 'img', 'aria-label': `${title}${kind === 'pie' ? '圓餅圖' : '長條圖'}` });
    const holder = h('div', { class: 'legend-slot' });
    box.append(h('div', { class: 'chart-box' },
      h('h2', null, title, h('span', { class: `total ${tone}` }, num(part.total, base), h('span', { class: 'ccy' }, base))),
      part.groups.length ? h('div', { class: 'chart-wrap' }, cv) : h('div', { class: 'empty' }, `這段期間沒有${title}紀錄`), holder));
    if (!part.groups.length) continue;
    const labels = part.groups.map((g) => g.label), vals = part.groups.map((g) => g.total), colors = colorsFor(part.groups);
    let chart;
    if (kind === 'pie') {
      chart = mkChart(cv, { type: 'doughnut', data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderColor: css('--surface'), borderWidth: 2 }] },
        options: { maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: groupTooltip(part.groups, base, part.total) } } });
    } else {
      mkChart(cv, { type: 'bar', data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderRadius: 3 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: groupTooltip(part.groups, base, part.total) }, scales: { y: yAxis() } } });
    }
    holder.append(legendList(part, colors, byCategory, base, chart));
  }
}

async function viewReports(view) {
  const r = S.rp;
  view.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, '報表', eyeButton('reports')), h('p', { class: 'sub' }, `金額都換算成 ${S.st.base}（使用目前的匯率）。${S.st.prefs.count_transfers ? '轉帳也算收支：轉出算支出、轉入算收入，類別顯示為「轉帳」；歸零調整不算。' : '轉帳與歸零調整不算收入或支出。'}`))));
  const out = h('div');
  const draw = async () => {
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    out.replaceChildren();
    try {
      if (r.kind === 'pie' || r.kind === 'bar') {
        const d = await api('GET', `/api/reports/breakdown?year=${r.year}${r.month ? '&month=' + r.month : ''}&group_by=${r.group}&max=8`);
        const box = h('div', { class: 'charts' }); out.append(box); drawBreakdown(box, d, r.kind, r.group === 'category'); notice(d.missing_rates);
        if (r.group === 'tag') out.prepend(h('p', { class: 'hint', style: 'margin:10px 0 0' }, '一筆交易有好幾個標籤時，每個標籤各算一次；圖上方的總額每筆只算一次，所以各標籤加起來可能比總額大。沒有標籤的交易歸在「(沒有標籤)」。'));
      } else if (r.kind === 'compare') {
        await drawCompare(out, r);
      } else if (r.kind === 'invest') {
        await drawInvestShare(out, r);
      } else if (r.kind === 'trend') {
        const d = await api('GET', `/api/reports/trend?year=${r.year}${r.month ? '&month=' + r.month : ''}`);
        const cv = h('canvas', { role: 'img', 'aria-label': '收支趨勢折線圖' });
        out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, r.month ? `${r.year}-${pad(r.month)} 每日收支` : `${r.year} 每月收支`), h('div', { class: 'chart-wrap tall' }, cv)));
        mkChart(cv, { type: 'line', data: { labels: d.labels.map((l) => l.slice(r.month ? 8 : 5)), datasets: [
          { label: '收入', data: d.income, borderColor: css('--income'), backgroundColor: css('--income'), tension: .25, pointRadius: 2.5 },
          { label: '支出', data: d.expense, borderColor: css('--expense'), backgroundColor: css('--expense'), tension: .25, pointRadius: 2.5 }] },
          options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: yAxis() },
            plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${num(c.parsed.y, d.base)} ${d.base}` } } } } });
        notice(d.missing_rates);
      } else {
        const sel = r.accounts.length ? r.accounts : ['total'];
        const d = await api('GET', `/api/reports/balances?accounts=${sel.join(',')}&year=${r.year}${r.month ? '&month=' + r.month : ''}`);
        if (!d.labels.length) { out.append(h('div', { class: 'empty' }, h('b', null, '這段期間沒有資料'), '先記幾筆交易，或換一個月份。')); return; }
        const cv = h('canvas', { role: 'img', 'aria-label': '帳戶餘額折線圖' });
        out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, '帳戶餘額（每日收盤）'), h('div', { class: 'chart-wrap tall' }, cv)));
        mkChart(cv, { type: 'line', data: { labels: d.labels, datasets: d.series.map((s, i) => ({ label: `${s.label}（${s.currency}）`, data: s.data, borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], tension: .15, pointRadius: d.labels.length > 60 ? 0 : 2.5, stepped: false })) },
          options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${num(c.parsed.y, c.dataset.label.match(/（(\w+)）$/)[1])}` } } },
            scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { ticks: { callback: (v) => (isHidden() ? '' : v) } } } } });
        notice(d.missing_rates);
      }
    } catch (e) { out.append(h('div', { class: 'empty' }, e.message)); }
  };
  const notice = (missing) => { if (missing && missing.length) out.prepend(h('div', { class: 'banner' }, `缺少 ${missing.join('、')} 的匯率，這些帳戶沒有算進圖表。`, h('a', { class: 'btn sm', href: '#/settings' }, '去填匯率'))); };
  const years = S.st.years;
  const kinds = [['pie', '圓餅圖'], ['bar', '長條圖'], ['trend', '收支趨勢'], ['balance', '帳戶餘額'], ['invest', '投資占比'], ['compare', '月比月']];
  const controls = h('div', { class: 'controls' },
    h('div', { class: 'seg', role: 'group', 'aria-label': '圖表種類' }, kinds.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(r.kind === k), onclick: () => { r.kind = k; renderRoute(); } }, l))),
    r.kind === 'compare' ? h('div', { class: 'seg', role: 'group', 'aria-label': '比較方式' }, [['auto', '上月與去年同月'], ['custom', '自選月份'], ['years', '按年比較']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(r.cmpMode === k), onclick: () => { r.cmpMode = k; renderRoute(); } }, l))) : null,
    r.kind === 'invest' || (r.kind === 'compare' && r.cmpMode !== 'auto') ? null : h('label', { class: 'field' }, h('span', null, '年'), h('select', { onchange: (e) => { r.year = +e.target.value; draw(); } }, years.map((y) => h('option', { value: y, selected: y === r.year }, y)))),
    r.kind === 'invest' || (r.kind === 'compare' && r.cmpMode !== 'auto') ? null : h('label', { class: 'field' }, h('span', null, '月'), h('select', { onchange: (e) => { r.month = +e.target.value; draw(); } }, h('option', { value: 0, selected: !r.month }, '整年'), Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: r.month === i + 1 }, `${i + 1} 月`)))),
    r.kind === 'compare' ? h('div', { class: 'seg', role: 'group', 'aria-label': '比較收入或支出' }, [['expense', '支出'], ['income', '收入']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(r.cmpKind === k), onclick: () => { r.cmpKind = k; renderRoute(); } }, l))) : null,
    r.kind === 'invest' ? h('div', { class: 'seg', role: 'group', 'aria-label': '占比圖種類' }, [['pie', '圓餅'], ['bar', '長條']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(r.shareKind === k), onclick: () => { r.shareKind = k; renderRoute(); } }, l))) : null,
    r.kind === 'invest' ? h('label', { class: 'field' }, h('span', null, '占比依'), h('select', { onchange: (e) => { r.shareBy = e.target.value; draw(); } }, [['value', '庫存市值（預估）'], ['cost', '付出成本']].map(([v, l]) => h('option', { value: v, selected: r.shareBy === v }, l)))) : null,
    (r.kind === 'pie' || r.kind === 'bar') ? h('label', { class: 'field' }, h('span', null, '依'), h('select', { onchange: (e) => { r.group = e.target.value; draw(); } }, [['category', '類別'], ['note', '備註'], ['tag', '標籤']].map(([v, l]) => h('option', { value: v, selected: r.group === v }, l)))) : null);
  view.append(controls);
  if (r.kind === 'pie' || r.kind === 'bar' || r.kind === 'trend' || r.kind === 'compare') view.append(transfersSwitch(''));
  if (r.kind === 'balance') {
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '選擇要畫的帳戶' });
    const items = [['total', `總資產（${S.st.base}）`], ...S.st.accounts.map((a) => [String(a.id), `${a.name}（${a.currency}）`])];
    items.forEach(([k, l]) => chips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(r.accounts.includes(k)), onclick: (e) => {
      r.accounts = r.accounts.includes(k) ? r.accounts.filter((x) => x !== k) : [...r.accounts, k];
      if (!r.accounts.length) r.accounts = ['total'];
      chips.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', String(r.accounts.includes(items[i][0]))));
      draw();
    } }, l)));
    view.append(chips);
  }
  view.append(out);
  await draw();
}

// ------------------------------------------------------------------ settings
// Put the book back the way it was before an import (the backup is taken automatically right before every import).
async function undoImport(backup, done) {
  if (!(await confirmBox({ title: '還原到匯入前？', confirmLabel: '還原', danger: true,
    message: h('p', null, `帳本會退回${backup.time ? ' ' + shortTime(backup.time) : ''}匯入前的樣子，匯入之後新增或修改的紀錄也會一起退回。還原前會先自動再備份一次目前的資料，需要時還能從備份清單救回來。`) }))) return;
  try { await api('POST', '/api/backups/restore', { name: backup.name }); if (done) done(); await afterChange('已還原到匯入前'); } catch (e) { fail(e); }
}

function importReportDialog(rep, title = '匯入完成') {
  const list = (arr, max = 8) => arr.length ? h('ul', { class: 'report-list' }, arr.slice(0, max).map((x) => h('li', null, x)), arr.length > max ? h('li', null, `…還有 ${arr.length - max} 項`) : null) : null;
  let dlg = null;
  const undo = rep.backup ? h('button', { class: 'btn', type: 'button',
    onclick: () => undoImport({ name: rep.backup }, () => dlg && dlg.close()) }, '還原到匯入前') : null;
  dlg = openDialog({ title, wide: true, extraFoot: undo, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('p', { style: 'margin:0' }, `匯入 ${rep.imported} 筆交易；略過 ${rep.duplicates} 筆已存在的重複紀錄；`, rep.accounts_created.length ? `新增 ${rep.accounts_created.length} 個帳戶（${rep.accounts_created.join('、')}）。` : '沒有新增帳戶。'),
    rep.invalid.length ? h('div', null, h('b', null, `${rep.invalid.length} 列無法匯入`), list(rep.invalid)) : null,
    rep.warnings.length ? h('div', null, h('b', null, '提醒'), list(rep.warnings)) : null,
    rep.backup ? h('p', { class: 'hint', style: 'margin:0' }, '匯入前已自動備份。如果匯入的結果不對，可以按下面的「還原到匯入前」退回。') : null) });
}

async function viewSettings(view) {
  const st = S.st, sh = st.sheets;
  view.append(h('div', { class: 'page-head' }, h('h1', null, '設定')));

  // --- appearance
  const colorNow = () => S.st.prefs.color;
  const hexIn = h('input', { class: 'hex', value: colorNow(), maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Hex 色碼' });
  const picker = h('input', { type: 'color', value: colorNow().toLowerCase(), 'aria-label': '用色盤選顏色' });
  const hexHint = h('span', { class: 'hint' }, '');
  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': '常用顏色' });
  const paintSwatches = () => swatches.replaceChildren(...Theme.PRESETS.map(([hex, name]) => h('button', {
    type: 'button', class: 'swatch', 'aria-pressed': String(colorNow() === hex), title: `${name}　${hex}`, onclick: () => choose(hex),
  }, h('i', { style: `background:${hex}` }), name)));
  const preview = (hex) => { Theme.apply(hex); };
  const choose = async (hex, { save = true } = {}) => {
    hex = Theme.normalize(hex);
    preview(hex); S.st.prefs.color = hex; lsSet('pw_color', hex);
    hexIn.value = hex; picker.value = hex.toLowerCase(); hexHint.textContent = ''; paintSwatches();
    if (save) { try { await api('PUT', '/api/settings', { ui_color: hex }); } catch (e) { fail(e); } }
  };
  hexIn.addEventListener('input', () => {
    const t = hexIn.value.trim();
    if (Theme.isHex(t)) { hexHint.textContent = ''; preview(Theme.normalize(t)); picker.value = Theme.normalize(t).toLowerCase(); }
    else hexHint.textContent = '請輸入 6 碼，例如 #E6E6FA';
  });
  hexIn.addEventListener('change', () => { if (Theme.isHex(hexIn.value)) choose(hexIn.value); else { hexHint.textContent = '請輸入 6 碼，例如 #E6E6FA'; Theme.apply(colorNow()); } });
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.dispatchEvent(new Event('change')); });
  picker.addEventListener('input', () => { hexIn.value = picker.value.toUpperCase(); preview(picker.value); });
  picker.addEventListener('change', () => choose(picker.value));
  paintSwatches();
  const hideAllCb = h('input', { type: 'checkbox', checked: S.hideAll, onchange: (e) => setHideAll(e.target.checked) });
  const pageChecks = Object.entries(PAGE_NAMES).map(([k, name]) => h('label', { class: 'row-inline' },
    h('input', { type: 'checkbox', checked: !!S.hidePages[k], disabled: S.hideAll, onchange: (e) => setHidePage(k, e.target.checked) }), h('span', null, name)));
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '外觀')),
    h('div', { class: 'rows' },
      h('div', { class: 'field' }, h('span', { style: 'font-weight:500' }, '介面顏色'), swatches),
      h('div', { class: 'row-inline hexrow' }, h('label', { class: 'field' }, h('span', null, '自訂 Hex 色碼'), h('div', { class: 'row-inline' }, picker, hexIn)),
        hexHint),
      h('p', { class: 'hint', style: 'margin:0' }, '淺色（例如薰衣草紫）會直接當作背景；較深或較飽和的顏色會當作重點色；很深的顏色會自動切成深色版面。文字對比會自動調整，換成什麼顏色都看得清楚。'),
      h('label', { class: 'row-inline' }, hideAllCb, h('span', null, h('b', null, '隱藏所有金額'), '（所有頁面都顯示成 ***）')),
      h('div', { class: 'field' }, h('span', { style: 'font-weight:500' }, '各頁個別隱藏'),
        h('div', { class: 'row-inline', style: 'gap:18px' }, pageChecks),
        h('span', { class: 'hint' }, '每一頁標題旁的眼睛圖示可以單獨隱藏那一頁，彼此獨立，這裡也能設定。打開「隱藏所有金額」時，所有頁面都會隱藏，各頁的個別設定先保留；關閉後就恢復。')))));

  // --- categories live on their own page now
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '類別')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '新增、改名、合併、刪除類別，以及更換每個類別的圖示與顏色，都在「類別」頁。'),
      h('div', null, h('a', { class: 'btn', href: '#/categories' }, '前往類別頁')))));

  // --- currency & rates
  const rateInputs = {};
  const baseSel = h('select', { 'aria-label': '主要幣別' }, st.currencies.map((c) => h('option', { value: c, selected: c === st.base }, c)));
  const rateRows = st.rates.rates.length ? st.rates.rates.map((r) => {
    const inp = h('input', { inputmode: 'decimal', value: r.rate == null ? '' : String(r.rate), placeholder: '尚未設定', 'aria-label': `1 ${r.currency} 等於多少 ${st.base}` });
    rateInputs[r.currency] = inp;
    return [h('span', null, `1 ${r.currency} =`), h('div', { class: 'row-inline' }, inp, h('span', { class: 'muted' }, st.base)), h('span', { class: 'hint' }, r.updated_at ? `更新於 ${shortTime(r.updated_at)}` : '')];
  }) : null;
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '幣別與匯率')),
    h('div', { class: 'rows' },
      h('div', { class: 'row-inline' }, h('label', { class: 'field' }, h('span', null, '主要幣別（總資產與報表使用）'), baseSel),
        h('button', { class: 'btn', onclick: async () => { try { await api('PUT', '/api/settings', { base_currency: baseSel.value }); await afterChange('已切換主要幣別，匯率已重新換算'); } catch (e) { fail(e); } } }, '切換')),
      rateRows ? h('div', { class: 'kv' }, rateRows) : h('p', { class: 'hint', style: 'margin:0' }, '目前所有帳戶都是主要幣別，不需要匯率。新增其他幣別的帳戶後，這裡會出現匯率欄位。'),
      rateRows ? h('div', { class: 'row-inline' },
        h('button', { class: 'btn primary', onclick: async () => {
          const rates = {}; for (const [c, i] of Object.entries(rateInputs)) if (i.value.trim()) rates[c] = i.value.trim();
          try { await api('PUT', '/api/rates', { rates }); await afterChange('匯率已儲存'); } catch (e) { fail(e); } } }, '儲存匯率'),
        h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const r = await api('POST', '/api/rates/refresh'); await afterChange(`已更新 ${r.updated.join('、') || '無'}${r.missing.length ? `；查不到 ${r.missing.join('、')}` : ''}`); } catch (er) { fail(er); e.target.disabled = false; } } }, '從網路更新匯率')) : null,
      h('p', { class: 'hint', style: 'margin:0' }, '報表使用「目前」匯率換算，之後改匯率，過去月份的換算金額也會跟著變。帳戶自己的餘額不受影響。'))));

  view.append(recurringSection());                           // the owner PC, a paired phone and the phone version all have it
  if (st.remote) {         // a paired phone: appearance + currency only. Files, backups and the Google connection stay on the computer.
    view.append(h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '這支手機')),
      h('div', { class: 'rows' }, h('p', { class: 'hint', style: 'margin:0' }, '你正在用手機連到家裡電腦上的 Tallomi。Google 試算表、匯入匯出、備份與手機管理只能在電腦上操作。'),
        h('p', { class: 'hint', style: 'margin:0' }, '鍵盤打不出來？', h('a', { href: 'static/kb-a.html' }, '測試頁 A（完全沒有樣式）'), '　', h('a', { href: 'static/kb-b.html' }, '測試頁 B（套用 Tallomi 樣式）'), '　', h('a', { href: 'static/kb-c.html' }, '測試頁 C（對話框）'))))); 
    view.append(offlineSection());
    return;
  }
  if (st.phone) { await phoneSettings(view); return; }       // the phone version: no folders, Google connection, tray or shutdown
  await settingsPhone(view);

  // --- google sheets
  const keyIn = h('input', { value: sh.key, placeholder: '貼上試算表網址或 ID', style: 'min-width:340px', 'aria-label': '試算表網址或 ID' });
  const wsIn = h('input', { value: sh.worksheet, 'aria-label': '工作表名稱' });
  const auto = h('input', { type: 'checkbox', checked: sh.auto });
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '服務帳戶金鑰', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api('POST', '/api/sheets/service-account', fd, true); await afterChange(`已載入服務帳戶：${r.email}`); } catch (er) { fail(er); }
  } });
  const saveSheets = async () => { const r = await api('PUT', '/api/sheets/config', { key: keyIn.value, worksheet: wsIn.value, auto: auto.checked }); S.st.sheets = r; updateSyncLine(r); return r; };
  const autosave = (msg) => async () => { try { await saveSheets(); if (msg) toast(msg(auto.checked)); await refresh(); } catch (e) { fail(e); } };
  keyIn.addEventListener('change', autosave(() => '已儲存試算表設定'));
  wsIn.addEventListener('change', autosave(() => '已儲存工作表名稱'));
  auto.addEventListener('change', autosave((on) => (on ? '已開啟自動同步' : '已關閉自動同步，之後要按「立即同步全部」才會更新')));
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, 'Google 試算表')),
    h('div', { class: 'rows' },
      h('div', { class: 'status-line' }, h('span', { class: 'dot ' + (sh.status.state === 'ok' ? 'ok' : sh.status.state === 'error' ? 'err' : sh.status.state === 'offline' ? 'off' : '') }, ''),
        h('span', null, [`金鑰：${sh.has_credentials ? '已載入' : '尚未上傳'}`, `試算表：${sh.key ? '已設定' : '尚未設定'}`, `自動同步：${sh.auto ? '開啟' : '關閉'}`].join('　｜　'))),
      h('div', { class: 'hint', style: 'margin-top:-6px' }, sh.status.state === 'offline' ? '目前離線：記帳照常使用，資料都存在這台電腦。連線後會自動重試並補上離線期間的所有紀錄。' : sh.status.state === 'error' ? `上次同步失敗：${sh.status.error}` : sh.status.last_ok ? `上次同步 ${shortTime(sh.status.last_ok)}，${sh.status.rows} 筆` : (sh.configured ? '已就緒，下一次記帳就會同步，也可以按「立即同步全部」。' : '')),
      h('label', { class: 'field' }, h('span', null, '試算表'), keyIn),
      h('label', { class: 'field' }, h('span', null, '寫入的工作表名稱'), wsIn,
        h('span', { class: 'hint' }, '每次有變動，Tallomi 會把整份帳本重新寫進這個工作表（原本的內容會被覆蓋）。其他工作表不會被動到；找不到時會自動建立。')),
      h('label', { class: 'field' }, h('span', null, '服務帳戶金鑰（service_account.json）'), fileIn,
        h('span', { class: 'hint' }, sh.has_credentials ? `已載入：${sh.email}` : '尚未上傳')),
      h('label', { class: 'row-inline' }, auto, h('span', null, '有變動時自動同步到試算表')),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn primary', onclick: async () => { try { await saveSheets(); await afterChange('已儲存 Google 試算表設定'); } catch (e) { fail(e); } } }, '儲存設定'),
        h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await saveSheets(); const r = await api('POST', '/api/sheets/test'); toast(`連線成功：「${r.title}」，共 ${r.worksheets.length} 個工作表`); } catch (er) { fail(er); } e.target.disabled = false; } }, '測試連線'),
        h('button', { class: 'btn', onclick: async (e) => {
          e.target.disabled = true;
          try {
            await saveSheets();
            let r;
            try { r = await api('POST', '/api/sheets/push', {}); }
            catch (er) {
              if (er.status !== 409) throw er;
              const ok = await confirmBox({ title: '覆蓋這個工作表？', message: h('p', null, er.message), confirmLabel: '覆蓋並同步', danger: true });
              if (!ok) { e.target.disabled = false; return; }
              r = await api('POST', '/api/sheets/push', { force: true });
            }
            await afterChange(`已同步 ${r.rows} 筆到「${r.worksheet}」`);
          } catch (er) { fail(er); await refresh().catch(() => {}); }
          e.target.disabled = false;
        } }, '立即同步全部'),
        sh.key ? h('button', { class: 'btn', onclick: () => api('POST', '/api/sheets/open').catch(fail) }, '開啟試算表') : null,
        h('button', { class: 'btn', onclick: async () => {
          try {
            await saveSheets(); const info = await api('POST', '/api/sheets/test');
            const pickWs = h('select', null, info.worksheets.map((w) => h('option', { value: w }, w)));
            openDialog({ title: '從試算表匯入', body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
              h('p', { style: 'margin:0' }, '選擇舊版記帳表所在的工作表（需有 time、type、amount、account 等欄位）。已經在 Tallomi 裡的紀錄會自動略過，不會重複。'),
              h('label', { class: 'field' }, h('span', null, '工作表'), pickWs)),
              primary: { label: '匯入', run: async (dlg) => { const rep = await api('POST', '/api/sheets/import', { worksheet: pickWs.value }); dlg.close(); await refresh(); importReportDialog(rep); return false; } } });
          } catch (e) { fail(e); }
        } }, '從試算表匯入…')),
      h('details', null, h('summary', { class: 'hint', style: 'cursor:pointer' }, '第一次設定怎麼做？'),
        h('ol', { class: 'steps' },
          h('li', null, '到 Google Cloud Console 建立專案，啟用「Google Sheets API」。'),
          h('li', null, '建立「服務帳戶」，新增 JSON 金鑰並下載（就是你原本使用的 service_account.json）。'),
          h('li', null, '打開你的 Google 試算表，按「共用」，把服務帳戶的 email 加為「編輯者」。'),
          h('li', null, '回到這裡上傳金鑰、貼上試算表網址，按「測試連線」。'))))));

  // --- import
  view.append(importSection());

  // --- export & backup
  const backupBox = h('div');
  let picked = new Set();
  const delBackups = async (names, what) => {
    if (!names.length) return;
    if (!(await confirmBox({ title: `刪除 ${what}？`, confirmLabel: '刪除', danger: true,
      message: h('p', null, '刪除後無法復原（不會進資源回收筒）。目前正在使用的帳本不受影響。') }))) return;
    try { const r = await api('DELETE', '/api/backups', { names }); toast(`已刪除 ${r.deleted} 份備份`); picked = new Set(); await loadBackups(); } catch (e) { fail(e); }
  };
  const loadBackups = async () => {
    const r = await api('GET', '/api/backups');
    const items = r.items, names = new Set(items.map((b) => b.name));
    picked = new Set([...picked].filter((n) => names.has(n)));
    if (!items.length) { backupBox.replaceChildren(h('p', { class: 'hint', style: 'margin:0' }, '還沒有備份。')); return; }
    const delSel = h('button', { class: 'btn sm danger', type: 'button', disabled: !picked.size, onclick: () => delBackups([...picked], `選取的 ${picked.size} 份備份`) }, `刪除選取的（${picked.size}）`);
    const sync = () => { delSel.disabled = !picked.size; delSel.textContent = `刪除選取的（${picked.size}）`; all.checked = picked.size === items.length; };
    const all = h('input', { type: 'checkbox', 'aria-label': '全選', checked: picked.size === items.length, onchange: (e) => {
      picked = e.target.checked ? new Set(items.map((b) => b.name)) : new Set();
      backupBox.querySelectorAll('input.bk').forEach((c) => { c.checked = e.target.checked; }); sync();
    } });
    const keep = h('select', { 'aria-label': '只保留最近幾份', onchange: async (e) => {
      const n = +e.target.value; e.target.value = ''; if (!n) return;
      const old = items.slice(n).map((b) => b.name);                      // items are newest first
      if (!old.length) { toast(`目前只有 ${items.length} 份，不需要刪`); return; }
      await delBackups(old, `${old.length} 份較舊的備份（只保留最新 ${n} 份）`);
    } }, h('option', { value: '' }, '只保留最近…'), [3, 5, 10].map((n) => h('option', { value: n }, `最近 ${n} 份`)));
    backupBox.replaceChildren(
      h('div', { class: 'row-inline bk-bar' }, h('label', { class: 'row-inline' }, all, h('span', null, `全選（共 ${items.length} 份）`)), delSel, keep),
      h('div', { class: 'bk-list' }, h('table', { class: 'ledger' }, h('tbody', null, items.map((b) => h('tr', null,
        h('td', { class: 'bk-pick' }, h('input', { class: 'bk', type: 'checkbox', 'aria-label': `選取 ${b.name}`, checked: picked.has(b.name), onchange: (e) => { e.target.checked ? picked.add(b.name) : picked.delete(b.name); sync(); } })),
        h('td', { class: 'when' }, shortTime(b.time)), h('td', { class: 'note' }, b.name, /-auto/.test(b.name) ? h('span', { class: 'bk-tag' }, '自動') : null), h('td', { class: 'r muted' }, `${Math.max(1, Math.round(b.size / 1024))} KB`),
        h('td', { class: 'act' },
          h('button', { class: 'btn sm ghost', onclick: async () => {
            if (!(await confirmBox({ title: '還原這個備份？', message: h('p', null, `目前的資料會被 ${shortTime(b.time)} 的備份取代。還原前會先自動再備份一次目前的資料。`), confirmLabel: '還原', danger: true }))) return;
            try { await api('POST', '/api/backups/restore', { name: b.name }); await afterChange('已還原備份'); } catch (e) { fail(e); }
          } }, '還原'),
          h('button', { class: 'btn sm ghost', onclick: () => delBackups([b.name], `這份備份（${shortTime(b.time)}）`) }, '刪除'))))))));
  };
  // --- automatic daily backup + second folder
  const abBox = h('div', { class: 'ab-box' });
  const loadAuto = async () => {
    const i = await api('GET', '/api/autobackup');
    const folder = h('input', { name: 'abfolder', value: i.folder, placeholder: i.default_folder || 'D:\\pennyworth\\備份', autocomplete: 'off', spellcheck: 'false', 'aria-label': '第二份存放處' });
    const when = (t) => (t ? shortTime(t) : '尚未');
    abBox.replaceChildren(
      h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: i.enabled, onchange: async (e) => {
        try { await api('PUT', '/api/autobackup', { enabled: e.target.checked }); await loadAuto(); } catch (err) { e.target.checked = !e.target.checked; fail(err); } } }),
        h('span', null, `每天自動備份一次（只保留最近 ${i.keep} 份；按「結束 Tallomi」時若有變動，也會再備份一次）`)),
      h('div', { class: 'ab-folder' }, h('label', { class: 'field' }, h('span', null, '第二份存放處（每次自動備份都會複製一份到這裡；留空就不複製）'), folder),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api('PUT', '/api/autobackup', { folder: folder.value }); toast(folder.value.trim() ? '已儲存第二份存放處' : '已關閉第二份存放'); await loadAuto(); } catch (err) { fail(err); } } }, '儲存資料夾'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api('POST', '/api/autobackup/run'); toast('已完成一次自動備份'); await loadAuto(); await loadBackups(); } catch (err) { fail(err); } } }, '現在就備份一次')),
      h('div', { class: 'ab-status' },
        h('span', null, `上次自動備份：${when(i.last_ok)}`),
        i.folder ? h('span', { class: i.second_error ? 'bad' : '' }, i.second_error ? `第二份存放處失敗：${i.second_error}` : `第二份存放處最近一次成功：${when(i.last_second_ok)}`) : h('span', null, '第二份存放處：未設定'),
        i.error ? h('span', { class: 'bad' }, `備份失敗：${i.error}`) : null));
  };
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '匯出與備份')),
    h('div', { class: 'rows' },
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn', onclick: async () => { try { await exported(await api('POST', '/api/export')); } catch (e) { fail(e); } } }, '匯出 CSV（Excel 可開）'),
        h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/backups'); toast('已建立備份'); await loadBackups(); } catch (e) { fail(e); } } }, '立即備份'),
        h('button', { class: 'btn', onclick: () => api('POST', '/api/open-folder', { which: 'data' }).then((r) => toast(`資料夾：${r.path}`)).catch(fail) }, '開啟資料夾')),
      abBox,
      h('p', { class: 'hint', style: 'margin:0' }, receiptNote()),
      h('p', { class: 'hint', style: 'margin:0' }, '歸零（清除紀錄）、清除全部、還原備份之前，都會自動備份。手動備份最多保留 30 份；不想留的舊備份可以勾選後刪除，或用「只保留最近…」一次清掉舊的。'),
      backupBox)));
  loadAuto().catch(fail);
  loadBackups().catch(fail);

  view.append(lockSection());
  { const us = updateSection(); if (us) view.append(us); }
  { const ms = modeSection(); if (ms) view.append(ms); }
  { const fs = feedbackSection(); if (fs) view.append(fs); }

  // --- danger
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '危險區')),
    h('div', { class: 'rows' }, h('div', { class: 'danger-zone' },
      h('p', { style: 'margin-top:0' }, h('b', null, '清除所有交易，帳戶回到初始金額'), h('br'), h('span', { class: 'muted' }, '帳戶本身會保留，交易紀錄全部刪除。原有帳戶（Cash、Cube Bank …）回到舊版的初始金額，其他帳戶為 0。相當於舊版的「Clear and Reset Account」。執行前會自動備份。')),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox({ title: '清除所有交易？', message: h('p', null, '所有交易會被刪除，帳戶餘額回到初始金額。'), confirmLabel: '清除全部', danger: true, typed: '清除全部' }))) return;
        try { const r = await api('POST', '/api/clear-all', { confirm: '清除全部' }); await afterChange(`已清除 ${r.deleted} 筆交易`); } catch (e) { fail(e); }
      } }, '清除所有交易…')))));

  {
    const autoBox = h('div', { class: 'auto-start' });
    view.append(h('section', { class: 'section' }, h('div', { class: 'rows' }, autoBox, h('p', { class: 'hint', style: 'margin:0' }, '關掉 Tallomi 的視窗後，程式仍會留在背景執行（照常更新匯率、股價，手機也連得上）。Windows 右下角的通知區域（可能收在「^」裡）會有 Tallomi 圖示：點一下開啟，按右鍵可以開啟或結束。要完全關閉，請按下面的按鈕，或用那個圖示的「結束 Tallomi」。'), h('button', { class: 'btn', onclick: async () => {
      try { await api('POST', '/api/shutdown'); document.body.replaceChildren(h('p', { style: 'padding:40px' }, 'Tallomi 已關閉，可以關掉這個分頁。')); } catch (e) { fail(e); } } }, '結束 Tallomi'))));
    loadAutostart(autoBox).catch(() => {});
  }
}

// On a phone a wide table turns into a stack of cards (see style.css). Each cell gets its column name as a label.
// Tables are marked once when they appear; `.keep` tables stay tables, `.tx` has its own card layout.
function stackTable(t) {
  if (t.classList.contains('stack')) return;
  t.classList.add('stack');
  const labels = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  t.querySelectorAll('tbody > tr').forEach((tr) => {
    const cells = [...tr.children];
    if (cells.some((td) => td.colSpan > 1)) return;
    cells.forEach((td, i) => { if (labels[i]) td.dataset.label = labels[i]; });
  });
}
function watchTables() {
  const view = $('#view');
  const scan = () => view.querySelectorAll('table.ledger:not(.stack):not(.tx):not(.keep):not(.inv-lot-table)').forEach(stackTable);
  new MutationObserver(scan).observe(view, { childList: true, subtree: true });
  scan();
}

// ------------------------------------------------------- live refresh
// Everything that is written (from this computer's window, a phone, or a background update) raises a counter on the
// computer. This loop waits on it, so a change made anywhere shows up here within a moment.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function busyTyping() {
  const el = document.activeElement;
  return !!(el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.closest('#view')) || !!document.querySelector('dialog[open]');
}
async function applyRemoteChange() {
  for (let i = 0; i < 400 && S.pendingChange; i++) {                   // never pull the page out from under a half-typed entry
    if (document.visibilityState === 'visible' && !busyTyping()) {
      S.pendingChange = false;
      const y = window.scrollY;
      try { await refresh(); window.scrollTo(0, y); } catch { /* computer unreachable: the next poll will say so */ }
      return;
    }
    await sleep(1500);
  }
}
// An update copied onto the computer changes the program's files; every open window and phone notices (the fingerprint in
// the page no longer matches) and reloads itself as soon as nothing is being typed.
const PW_BUILD = (document.querySelector('meta[name="pw-build"]') || {}).content || '';
async function reloadForUpdate() {
  let last = 0; try { last = Number(sessionStorage.getItem('pw_reloaded') || 0); } catch { /* ignore */ }
  if (Date.now() - last < 30000) return;                     // never loop
  for (let i = 0; i < 400; i++) {
    if (document.visibilityState === 'visible' && !busyTyping()) break;
    await sleep(1500);
  }
  try { sessionStorage.setItem('pw_reloaded', String(Date.now())); } catch { /* ignore */ }
  toast('Tallomi 有新版本，正在更新…');
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* no service worker */ }
  await sleep(600);
  location.reload();
}
let updating = false;
let revRunning = false;
const visibleAgain = () => new Promise((resolve) => {
  const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); resolve(); } };
  document.addEventListener('visibilitychange', f);
});
const stopRevWait = () => { if (S.revAbort) { try { S.revAbort.abort(); } catch { /* done */ } } };
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stopRevWait(); });
window.addEventListener('pagehide', stopRevWait);
// While the screen is off or another app is in front the phone must be quiet: no waiting request is left hanging, and the
// first thing after coming back is one quick look at whether anything changed.
async function revWatch() {
  if (revRunning) return;
  revRunning = true;
  let fails = 0;
  for (;;) {
    if (document.visibilityState !== 'visible') { await visibleAgain(); fails = 0; continue; }
    const ac = new AbortController(); S.revAbort = ac;
    const guard = setTimeout(() => ac.abort(), 35000);       // a request iOS froze while we were away never answers
    try {
      const since = S.rev == null ? -1 : S.rev;
      const r = await fetch(`/api/rev?since=${since}&wait=20`, { headers: { 'X-Pennyworth': '1' }, cache: 'no-store', signal: ac.signal });
      if (r.status === 401) {
        const j = await r.json().catch(() => ({}));
        if (j.locked) { await showLock(); continue; }
        location.replace('/pair'); return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      fails = 0;
      if (d.build && PW_BUILD && !PW_BUILD.startsWith('__') && d.build !== PW_BUILD && !updating) { updating = true; reloadForUpdate().finally(() => { updating = false; }); }
      if (S.rev == null) S.rev = d.rev;
      else if (d.rev !== S.rev) { S.rev = d.rev; S.pendingChange = true; applyRemoteChange(); }
      if (!d.waited) await sleep(4000);
    } catch (e) {
      if (e && e.name === 'AbortError') continue;           // we stopped it ourselves (screen off) or it hung: just start again
      fails += 1; await sleep(Math.min(30000, 3000 * fails));
    } finally { clearTimeout(guard); if (S.revAbort === ac) S.revAbort = null; }
  }
}

// --------------------------------------------------------------------- boot
(async function boot() {
  try { await refresh(); } catch (e) { $('#view').replaceChildren(h('div', { class: 'empty' }, h('b', null, '無法啟動'), e.message)); }
  const remote = !!(S.st && S.st.remote);
  const phone = !!(S.st && S.st.phone);
  if (phone) phoneStartup();
  if (S.st && S.st.onboarding && typeof onboardingWizard === 'function') onboardingWizard();
  const ping = () => { if (!remote && !phone) fetch('/api/ping').catch(() => {}); };
  setInterval(ping, 5000);
  if ((remote || offlineOn()) && 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) navigator.serviceWorker.register('/sw.js').catch(() => {});
  watchTables();
  // Phone keyboard (iPhone): the page does not shrink when the keyboard slides up, only the visible part does. Measure the gap,
  // lift bottom sheets above the keyboard, hide the tab bar while typing, and put the page back where it was once the keyboard is gone.
  (function keyboardGuard() {
    const vv = window.visualViewport; if (!vv) return;
    const root = document.documentElement;
    let was = false, y0 = 0;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const a = document.activeElement;
      const typing = !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|file|color)$/.test(a.type)));
      const open = kb > 90 && typing;                                        // a gap without a focused text box is scrolling / bounce, not a keyboard
      if (open && !was) y0 = window.scrollY;
      root.style.setProperty('--kb', open ? `${kb}px` : '0px');
      root.classList.toggle('kb-open', open);
      if (was && !open) setTimeout(() => {                                   // iOS can leave the page scrolled / shifted after the keyboard closes
        const a = document.activeElement;
        if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
        if (!document.querySelector('dialog[open]')) window.scrollTo(0, y0);
        if (vv.offsetTop) window.scrollTo(0, window.scrollY);
      }, 80);
      was = open;
    };
    vv.addEventListener('resize', update); vv.addEventListener('scroll', update);
    document.addEventListener('focusout', () => setTimeout(update, 120));
  })();
  // Phone keyboard: once it has slid up, keep the box being typed in on screen.
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el.tagName === 'INPUT' && /^(text|search|tel|url|email|number|password)$/.test(el.type)) && el.tagName !== 'TEXTAREA') return;
    if (window.matchMedia('(max-width: 720px)').matches) setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
  });
  if (!phone) revWatch();
  // Screen locked / another app in front: remember when we left. Coming back, only a long absence or a new day reloads the
  // whole book; anything newer from the computer is picked up by the (restarted) change watcher.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { S.hiddenAt = Date.now(); return; }
    ping();
    const away = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
    if ((away > 30 * 60 * 1000 || (S.day && S.day !== nowLocal().slice(0, 10))) && !document.querySelector('dialog[open]')) refresh().catch(() => {});
  });
  window.addEventListener('offline', () => { toast(remote ? '手機目前沒有網路，連不上你的電腦' : '目前沒有網路：記帳照常使用，資料先存在這台電腦，連線後自動同步'); if (S.st) updateSyncLine(S.st.sheets); });
  window.addEventListener('online', async () => {
    toast('網路已恢復');
    try { await api('POST', '/api/sheets/retry'); } catch { /* not configured */ }
    watchSync(); try { updateSyncLine(await api('GET', '/api/sheets')); } catch { /* ignore */ }
  });
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || remote || phone) return;        // only the computer's own window shows this line
    try { updateSyncLine(await api('GET', '/api/sheets')); } catch { /* server closed */ }
  }, 8000);
})();
