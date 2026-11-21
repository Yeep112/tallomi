/* Desktop keyboard: Ctrl+K (⌘K) opens a command palette — jump to a page, record an entry, search or filter the transactions, open a setting.
   Single keys when no box has the cursor: N record · / search · [ ] month · G then a letter go to a page · ? list the keys.
   Only functions and constants here (the key listener is added once at the bottom, and does nothing until a page is drawn). */
'use strict';

const GO_KEYS = { o: 'overview', c: 'calendar', t: 'transactions', d: 'advances', x: 'exchange', i: 'invest', a: 'accounts', r: 'reports', k: 'categories', g: 'tags', s: 'settings' };
const GO_NAMES = { overview: '總覽', calendar: '月曆', transactions: '交易', advances: '代墊', exchange: '換匯', invest: '投資', accounts: '帳戶', reports: '報表', categories: '類別', tags: '標籤', settings: '設定' };
const KEY_LIST = [
  ['Ctrl + K', '開啟指令面板（跳頁、記帳、搜尋、設定）'], ['N', '記一筆'], ['/', '搜尋交易'], ['[  ]', '上個月 / 下個月（有月份的頁面）'],
  ['G 然後 O', '總覽'], ['G 然後 C', '月曆'], ['G 然後 T', '交易'], ['G 然後 D', '代墊'], ['G 然後 X', '換匯'], ['G 然後 I', '投資'],
  ['G 然後 A', '帳戶'], ['G 然後 R', '報表'], ['G 然後 K', '類別'], ['G 然後 G', '標籤'], ['G 然後 S', '設定'], ['?', '顯示這份快捷鍵清單'],
];

// Is the cursor in something you type into, or is a box / the PIN pad on top? Then single keys are letters, not commands.
function typingNow(e) {
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
  return !!document.querySelector('dialog[open], .lockscreen');
}

// Show the transactions page with these filters (everything else cleared).
function goTransactions(patch = {}) {
  S.txf = { ...S.txf, q: '', type: '', account_id: '', from: '', to: '', tag: '', limit: TX_PAGE, back: null, ...patch };
  if (currentRoute() === 'transactions') renderRoute(); else location.hash = '#/transactions';
}
// Run something once this page is on screen (straight away when it already is).
function goThen(route, fn) {
  if (currentRoute() === route) { fn(); return; }
  S.goAfter = fn; location.hash = '#/' + route;
}
function focusSearch() {
  goThen('transactions', () => { const i = document.querySelector('#view input[type=search]'); if (i) { i.focus(); i.select(); } });
}
function stepMonth(dir) {
  const b = document.querySelector(`#view button[aria-label="${dir < 0 ? '上一個月' : '下一個月'}"]`);
  if (b) b.click(); else toast('這一頁沒有月份可以切換');
}

// The things the palette can do right now: [group, label, extra search words, action]
function paletteItems() {
  const st = S.st || {}, out = [];
  out.push(['記帳', '記一筆支出', 'expense 新增 記帳 n', () => openQuickAdd({ type: 'expense' })]);
  out.push(['記帳', '記一筆收入', 'income 新增 薪水', () => openQuickAdd({ type: 'income' })]);
  if (activeAccounts().length > 1) out.push(['記帳', '記一筆轉帳', 'transfer 轉帳 轉入 轉出', () => openQuickAdd({ type: 'transfer' })]);
  for (const [r, label] of Object.entries(GO_NAMES)) out.push(['前往', `前往 ${label}`, `${r} 跳到 開啟 頁面`, () => { location.hash = '#/' + r; }]);
  out.push(['前往', '儲蓄目標', '目標 存錢 goal saving 進度', () => { if (typeof openGoalsManager === 'function') openGoalsManager(); }]);
  out.push(['前往', '月度回顧', '回顧 上個月 review 每月 異常', () => { if (typeof openReviewDialog === 'function') openReviewDialog(); }]);
  out.push(['設定', '管理分類規則', '分類規則 自動分類 備註 關鍵字 rules', () => goThen('settings', () => openCatRulesEditor())]);
  out.push(['設定', '管理定期交易', '定期 訂閱 房租 固定', () => goThen('settings', () => openRecurringManager())]);
  out.push(['設定', S.hideAll ? '顯示所有金額' : '隱藏所有金額', '隱藏 金額 眼睛 隱私', () => setHideAll(!S.hideAll)]);
  out.push(['說明', '快捷鍵清單', 'keyboard shortcuts 快捷鍵 按鍵 ?', () => openKeyHelp()]);
  for (const a of activeAccounts()) out.push(['帳戶', `看帳戶：${a.name}`, `account ${a.currency}`, () => goTransactions({ account_id: String(a.id) })]);
  const cats = [...new Set([...((st.cat_info || {}).expense || []), ...((st.cat_info || {}).income || [])])];
  for (const c of cats) out.push(['類別', `看類別：${c}`, 'category', () => goTransactions({ q: c })]);
  for (const t of (st.tag_list || []).slice(0, 40)) out.push(['標籤', `看標籤：#${t.tag}`, 'tag', () => goTransactions({ tag: t.tag })]);
  return out;
}
// Every typed word has to appear somewhere in the label or its extra words (case does not matter).
function paletteFilter(items, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((it) => it[0] === '記帳' || it[0] === '前往').slice(0, 14);
  const hay = (it) => `${it[1]} ${it[2]}`.toLowerCase();
  const hit = items.filter((it) => words.every((w) => hay(it).includes(w)));
  hit.sort((a, b) => (a[1].toLowerCase().includes(words[0]) ? 0 : 1) - (b[1].toLowerCase().includes(words[0]) ? 0 : 1));
  return hit.slice(0, 30);
}

let paletteOpen = false;
function openPalette() {
  if (paletteOpen || document.querySelector('dialog[open], .lockscreen') || !S.st) return;
  paletteOpen = true;
  const items = paletteItems();
  let shown = [], sel = 0;
  const list = h('div', { class: 'pal-list', role: 'listbox', id: 'pal-list' });
  const input = h('input', { class: 'pal-input', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '想做什麼？例如：報表、星巴克、記一筆', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-label': '指令面板' });
  const dlg = h('dialog', { class: 'pal', 'aria-label': '指令面板' }, h('div', { class: 'pal-box' }, input, list, h('div', { class: 'pal-foot hint' }, '↑ ↓ 選擇　Enter 執行　Esc 關閉')));
  const run = (fn) => { dlg.close(); setTimeout(fn, 0); };
  const paint = () => {
    const q = input.value.trim();
    shown = paletteFilter(items, q);
    if (q) shown.push(['搜尋', `搜尋交易：${q}`, '', () => goTransactions({ q })]);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown : [[null, '沒有符合的項目', '']]).flatMap((it, i) => {
      const row = it[0] === null ? h('div', { class: 'pal-empty' }, it[1]) : h('div', { class: 'pal-item' + (i === sel ? ' on' : ''), role: 'option', id: `pal-${i}`, 'aria-selected': String(i === sel), 'data-i': i,
        onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => run(it[3]) }, h('span', null, it[1]), h('small', null, it[0]));
      return [row];
    }));
    input.setAttribute('aria-activedescendant', shown.length ? `pal-${sel}` : '');
  };
  const mark = () => {
    list.querySelectorAll('.pal-item').forEach((n, i) => { const on = i === sel; n.classList.toggle('on', on); n.setAttribute('aria-selected', String(on)); if (on) n.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
  };
  input.addEventListener('input', () => { sel = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) run(shown[sel][3]); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); paletteOpen = false; unlockScroll(); });
  document.body.appendChild(dlg); lockScroll(); paint(); dlg.showModal(); input.focus();
}

function openKeyHelp() {
  return openDialog({ title: '快捷鍵', body: h('div', { class: 'keyhelp' }, KEY_LIST.map(([k, t]) => h('div', { class: 'kh-row' }, h('kbd', null, k), h('span', null, t)))) });
}

let goWait = 0;
document.addEventListener('keydown', (e) => {
  if (!S || !S.st) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    if (document.querySelector('.lockscreen')) return;
    e.preventDefault(); openPalette(); return;
  }
  if (mod || e.altKey || e.isComposing || typingNow(e)) return;
  const k = e.key;
  if (goWait && Date.now() - goWait < 1200 && GO_KEYS[k.toLowerCase()]) { e.preventDefault(); goWait = 0; location.hash = '#/' + GO_KEYS[k.toLowerCase()]; return; }
  goWait = 0;
  if (k === 'g' || k === 'G') { goWait = Date.now(); return; }
  if (k === 'n' || k === 'N') { e.preventDefault(); openQuickAdd({}); }
  else if (k === '/') { e.preventDefault(); focusSearch(); }
  else if (k === '[') stepMonth(-1);
  else if (k === ']') stepMonth(1);
  else if (k === '?') { e.preventDefault(); openKeyHelp(); }
});
