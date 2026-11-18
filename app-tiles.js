/* Overview: every category as a coloured tile with this month's total; tap one to record an entry in it.
   "編輯類別" turns the tiles into an editor (picture, name, budget, delete) and each section ends with a "新增類別" tile.
   Also the "add an entry" dialog the tiles and the calendar use. Only functions here: nothing touches `S` until a page is drawn. */
'use strict';

// ---- add an entry in a dialog (type / category / day already chosen)
function openQuickAdd({ type = 'expense', category = '', date = '', seed = null, title: given = '' } = {}) {
  const first = activeAccounts()[0];
  const m = { type, account_id: S.entry.account_id || (first ? first.id : null), to_account_id: null, amount: '', to_amount: '', category, note: '', tags: pinnedTags(), time: '',
    advance: '', counterparty: '', due: '', no_budget: false, no_stats: false };
  if (seed) Object.assign(m, seed, { time: '' });                    // "record it again": same fields, the time is now
  if (date) m.time = date === nowLocal().slice(0, 10) ? nowLocal().slice(0, 16) : `${date}T${nowLocal().slice(11, 16)}`;
  if (type === 'transfer') { const o = activeAccounts().find((a) => a.id != m.account_id); m.to_account_id = o ? o.id : null; }
  const holder = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const draw = (focus) => {
    holder.replaceChildren(templateBar(m, draw), h('div', { class: 'grid2' }, txFields(m, draw).map((f) => (f.classList && f.classList.contains('ccy-tag')) ? null : f).filter(Boolean)));
    const a = holder.querySelector('input[name=amount]'); if (a && (focus || m.amount === '')) a.focus();
  };
  draw();
  const title = given || `${date ? date.slice(5).replace('-', '/') + ' ' : ''}記一筆${category ? '：' + category : ''}`;
  openDialog({ title, wide: true, body: holder,
    primary: { label: '記下', run: async () => { const acctId = m.account_id; await recordEntry(m); S.entry.account_id = acctId; await refresh(); } } });
}

// ---- the tiles
// the order the user dragged them into first; categories added since (or never dragged) follow, most used first
function tileOrder(names, usage, kind, saved = []) {
  const n = (c) => { const u = usage[c]; return u ? u[kind] : 0; };
  const set = new Set(names), mine = saved.filter((c) => set.has(c)), seen = new Set(mine);
  return [...mine, ...[...names].filter((c) => !seen.has(c)).sort((a, b) => n(b) - n(a) || catCmp(a, b))];
}
async function saveTileOrder(kind, names) {
  try {
    S.st.prefs.tile_order = { ...(S.st.prefs.tile_order || {}), [kind]: names };
    await api('PUT', '/api/settings', { tile_order: { [kind]: names } });
    if (typeof watchSync === 'function') watchSync();
  } catch (e) { fail(e); }
}
// Drag a tile to a new place: a mouse drag starts after a few pixels; on a touch screen press and hold for a moment first
// (so scrolling the page still works). The grid is reordered live and the order is saved when the tile is dropped.
function enableTileDrag(grid, kind, onOrder) {
  const HOLD = 320, SLOP = 6;
  let st = null;
  const tiles = () => [...grid.querySelectorAll('.tile:not(.add)')];
  const begin = () => {
    const r = st.el.getBoundingClientRect();
    st.on = true; st.dx = st.x0 - r.left; st.dy = st.y0 - r.top;
    st.ghost = st.el.cloneNode(true); st.ghost.classList.add('tile-ghost'); st.ghost.removeAttribute('aria-label');
    Object.assign(st.ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
    document.body.append(st.ghost); st.el.classList.add('tile-lifted'); grid.classList.add('dragging');
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* not everywhere */ }
  };
  const stop = () => {
    clearTimeout(st.timer);
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end);
    document.removeEventListener('touchmove', block);
    const was = st; st = null; return was;
  };
  function move(e) {
    if (!st || e.pointerId !== st.id) return;
    const far = Math.hypot(e.clientX - st.x0, e.clientY - st.y0);
    st.far = Math.max(st.far, far);
    if (!st.on) {
      if (far < SLOP) return;
      if (st.touch) { stop(); return; }                                      // the finger moved before the hold: it is a scroll
      clearTimeout(st.timer); begin();
    }
    e.preventDefault();
    Object.assign(st.ghost.style, { left: `${e.clientX - st.dx}px`, top: `${e.clientY - st.dy}px` });
    st.ghost.hidden = true; const under = document.elementFromPoint(e.clientX, e.clientY); st.ghost.hidden = false;
    const over = under && under.closest && under.closest('.tile:not(.add)');
    if (over && over !== st.el && over.parentNode === grid) {
      const list = tiles(), from = list.indexOf(st.el), to = list.indexOf(over);
      if (from < to) over.after(st.el); else over.before(st.el);
    }
  }
  function end(e) {
    if (!st || (e && e.pointerId !== st.id)) return;
    const was = stop();
    if (!was.on) return;
    was.ghost.remove(); was.el.classList.remove('tile-lifted'); grid.classList.remove('dragging');
    S.tileDragAt = Date.now();                                              // the click that follows the drop must not open the tile
    const names = tiles().map((t) => t.dataset.name);
    if (names.join('\n') !== was.before.join('\n')) (onOrder ? onOrder(names) : saveTileOrder(kind, names));
  }
  function block(e) { if (st && st.on && e.cancelable) e.preventDefault(); }
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('.tile:not(.add)');
    if (!el || el.parentNode !== grid || (e.pointerType === 'mouse' && e.button !== 0) || st) return;
    st = { id: e.pointerId, el, x0: e.clientX, y0: e.clientY, on: false, far: 0, touch: e.pointerType !== 'mouse', before: tiles().map((t) => t.dataset.name) };
    if (st.touch) st.timer = setTimeout(() => { if (st && !st.on) begin(); }, HOLD);      // touch: hold a moment to lift the tile (a quick swipe still scrolls)
    document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    document.addEventListener('touchmove', block, { passive: false });
  });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.tile:not(.add)')) e.preventDefault(); });   // no browser menu on a tile
  grid.addEventListener('dragstart', (e) => e.preventDefault());
}
// the same thing without a pointer: move a tile one place with the buttons in its menu
async function nudgeTile(kind, name, delta) {
  const grid = document.querySelector(`.tile-grid[data-kind="${kind}"]`); if (!grid) return;
  const names = [...grid.querySelectorAll('.tile:not(.add)')].map((t) => t.dataset.name), i = names.indexOf(name), j = i + delta;
  if (i < 0 || j < 0 || j >= names.length) return;
  [names[i], names[j]] = [names[j], names[i]];
  await saveTileOrder(kind, names); renderRoute();
}
// The monthly budget on an expense tile: "預算 2,700" with a bar that fills as the month's spending approaches it (yellow from 80%, red once over).
function tileBudget(name, kind, spent, base) {
  const cap = Number((S.st.budgets || {})[name]);
  if (kind !== 'expense' || !(cap > 0)) return null;
  const used = Math.max(0, Number(spent) || 0), pct = Math.round(used / cap * 100), left = cap - used;
  const tone = used > cap ? 'over' : pct >= 80 ? 'warn' : 'ok';
  const text = used > cap ? `超支 ${num(used - cap, base)}` : `剩 ${num(left, base)}`;
  return { tone, label: `預算 ${num(cap, base)}，已用 ${pct}%，${text}`,
    el: h('span', { class: `tile-bud ${tone}` },
      h('span', { class: 'tile-bar-track', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(100, pct)}%` })),
      h('small', { class: 'num' }, `預算 ${num(cap, base)}`, h('em', null, ` · ${text}`))) };
}
function categoryTile(name, amount, kind, editing, base, spent) {
  const l = catLook(name), pic = isPicture(l.icon), bud = tileBudget(name, kind, spent, base);
  return h('button', { type: 'button', class: 'tile' + (editing ? ' editing' : '') + (bud ? ' has-bud ' + bud.tone : ''), style: pic ? '' : `--tile:${l.color}`, 'data-name': name,
    'aria-label': editing ? `編輯類別「${name}」` : `${TYPE_LABEL[kind]}・${name}，本月 ${num(amount, base)}${bud ? '，' + bud.label : ''}，點一下記一筆`,
    onclick: () => {
      if (Date.now() - (S.tileDragAt || 0) < 400) return;                    // the click that ends a drag
      if (editing) { openCategoryMenu(name, kind); return; }
      const p = S.tileTap;                                                   // two quick taps on the same tile: edit it; one tap: record an entry
      if (p && p.name === name && p.kind === kind) { clearTimeout(p.timer); S.tileTap = null; openCategoryMenu(name, kind); return; }
      S.tileTap = { name, kind, timer: setTimeout(() => { S.tileTap = null; openQuickAdd({ type: kind, category: name }); }, 300) };
    } },
    editing ? h('span', { class: 'tile-edit', 'aria-hidden': 'true' }, '✎') : null,
    h('span', { class: 'tile-name' }, name), chipEl(l.icon, l.color, 'xl'), h('b', { class: 'tile-amt num' }, num(amount, base)), bud ? bud.el : null);
}

function addCategoryDialog(kind) {
  const name = h('input', { maxlength: 60, autocomplete: 'off', placeholder: '例如：早餐、獎金、旅遊', 'aria-label': '類別名稱' });
  openDialog({ title: `新增${TYPE_LABEL[kind]}類別`, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('label', { class: 'field' }, h('span', null, '類別名稱'), name),
    h('p', { class: 'hint', style: 'margin:0' }, '建立後可以馬上挑圖示和顏色，之後隨時都能改。')),
    primary: { label: '新增並選圖示', run: async () => {
      const nm = name.value.trim();
      await api('POST', '/api/categories', { name: nm, kind });
      await afterChange('已新增類別');
      editCategoryIcon(nm);
    } } });
}

function openCategoryMenu(name, kind) {
  const dlg = openDialog({ title: `編輯類別：${name}`, body: h('div', { class: 'cat-menu-list' },
    ...[...(kind ? [['◀', '往前移一格', () => nudgeTile(kind, name, -1)], ['▶', '往後移一格', () => nudgeTile(kind, name, 1)]] : []),['🎨', '更換圖示與顏色', () => editCategoryIcon(name)], ['✏️', '改名／合併', () => openCategoryRename(name)],
      ['🎯', S.st.budgets[name] ? '調整每月預算' : '設定每月預算', () => openBudget(name)], ['🗑️', '刪除類別', () => deleteCategory(name)]]
      .map(([ico, label, run]) => h('button', { class: 'btn cat-menu-item', type: 'button', onclick: () => { dlg.close(); run(); } }, h('span', { 'aria-hidden': 'true' }, ico), label))) });
}

async function overviewTiles() {
  const o = S.ov || (S.ov = { y: new Date().getFullYear(), m: new Date().getMonth() + 1, edit: false, shut: {} });
  const now = new Date(), isNow = o.y === now.getFullYear() && o.m === now.getMonth() + 1;
  const d = await api('GET', `/api/reports/breakdown?year=${o.y}&month=${o.m}&group_by=category&max=30`);
  const base = d.base, info = S.st.cat_info;
  const move = (n) => { const x = new Date(o.y, o.m - 1 + n, 1); o.y = x.getFullYear(); o.m = x.getMonth() + 1; renderRoute(); };
  const section = (kind) => {
    const g = d[kind], by = Object.fromEntries(g.groups.map((x) => [x.label, x.total]));
    const names = new Set(info[kind]);
    g.groups.forEach((x) => { if (x.label !== '轉帳' && x.label !== '其他' && x.total) names.add(x.label); });
    if (!by['未分類']) names.delete('未分類');
    const shut = !!o.shut[kind];
    return h('section', { class: 'tile-sec' },
      h('button', { type: 'button', class: 'tile-head', 'aria-expanded': String(!shut), onclick: () => { o.shut[kind] = !shut; renderRoute(); } },
        h('span', null, `${TYPE_LABEL[kind]} `, h('b', { class: 'num ' + (kind === 'income' ? 'pos' : 'neg') }, num(g.total, base)), h('small', { class: 'muted' }, ` ${base}`)),
        h('span', { class: 'tile-chev', 'aria-hidden': 'true' }, shut ? '▸' : '▾')),
      shut ? null : h('div', { class: 'tile-grid', 'data-kind': kind },
        tileOrder(names, info.usage, kind, (S.st.prefs.tile_order || {})[kind] || []).map((c) => categoryTile(c, by[c] || 0, kind, o.edit, base, (d.budget_spent || {})[c] || 0)),
        h('button', { type: 'button', class: 'tile add', 'aria-label': `新增${TYPE_LABEL[kind]}類別`, onclick: () => addCategoryDialog(kind) }, h('span', { class: 'tile-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'tile-name' }, '新增類別'))));
  };
  const root = h('div', { class: 'tiles' },
    h('div', { class: 'tile-bar' },
      h('div', { class: 'month-nav', role: 'group', 'aria-label': '切換月份' },
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': '上一個月', onclick: () => move(-1) }, '‹'),
        h('b', null, isNow ? '本月' : `${o.y} 年 ${o.m} 月`),
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': '下一個月', onclick: () => move(1) }, '›'),
        isNow ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { o.y = now.getFullYear(); o.m = now.getMonth() + 1; renderRoute(); } }, '回本月')),
      h('span', { class: 'head-btns' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => openQuickAdd({ type: 'transfer' }) }, '轉帳'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openQuickAdd({}) }, '記一筆'),
        h('button', { class: 'btn sm' + (o.edit ? ' primary' : ' ghost'), type: 'button', 'aria-pressed': String(o.edit), onclick: () => { o.edit = !o.edit; renderRoute(); } }, o.edit ? '完成' : '編輯類別'))),
    h('p', { class: 'hint tile-hint' }, o.edit ? '點一個類別來換圖示、改名、設預算或刪除；點最後的「＋」新增自己的類別。也可以直接拖曳磚塊換位置。' : '點一下磚塊記一筆；連點兩下編輯類別與圖示；拖曳磚塊換位置（手機先按住一下再拖）。'),
    d.missing_rates.length ? h('div', { class: 'banner' }, `缺少 ${d.missing_rates.join('、')} 的匯率，這些帳戶沒有算進去。`) : null,
    section('expense'), section('income'));
  root.querySelectorAll('.tile-grid').forEach((g) => enableTileDrag(g, g.dataset.kind));
  return root;
}

// ---- accounts as tiles (overview): same look and the same drag-to-reorder as the categories
async function saveAccountOrder(ids) {
  try {
    S.st.accounts.sort((a, b) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)));
    await api('PUT', '/api/accounts/order', { ids: ids.map(Number) });
    if (typeof watchSync === 'function') watchSync();
  } catch (e) { fail(e); }
}
async function nudgeAccount(id, delta) {
  const grid = document.querySelector('.tile-grid[data-kind="account"]'); if (!grid) return;
  const ids = [...grid.querySelectorAll('.tile:not(.add)')].map((t) => t.dataset.name), i = ids.indexOf(String(id)), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await saveAccountOrder(ids); renderRoute();
}
function accountTile(a, editing, base) {
  const l = accLook(a), pic = isPicture(l.icon);
  const conv = a.currency !== base && a.base_value != null ? `約 ${num(a.base_value, base)} ${base}` : (a.currency !== base ? '需要匯率' : '');
  return h('button', { type: 'button', class: 'tile' + (editing ? ' editing' : ''), style: pic ? '' : `--tile:${l.color}`, 'data-name': String(a.id),
    'aria-label': editing ? `編輯帳戶「${a.name}」` : `${a.name}，餘額 ${num(a.balance, a.currency)} ${a.currency}，點一下看這個帳戶的交易`,
    onclick: () => {
      if (Date.now() - (S.tileDragAt || 0) < 400) return;
      if (editing) { openAccountMenu(a); return; }
      const p = S.tileTap;                                                   // two quick taps: edit; one tap: the account's transactions
      if (p && p.acct === a.id) { clearTimeout(p.timer); S.tileTap = null; openAccountMenu(a); return; }
      S.tileTap = { acct: a.id, timer: setTimeout(() => { S.tileTap = null; S.txf.account_id = String(a.id); location.hash = '#/transactions'; }, 300) };
    } },
    editing ? h('span', { class: 'tile-edit', 'aria-hidden': 'true' }, '✎') : null,
    h('span', { class: 'tile-name' }, a.name), chipEl(l.icon, l.color, 'xl'),
    h('b', { class: 'tile-amt num' + (a.balance < 0 ? ' neg' : '') }, num(a.balance, a.currency), h('small', { class: 'muted' }, ` ${a.currency}`)),
    conv ? h('span', { class: 'tile-sub muted num' }, conv) : null);
}
function openAccountMenu(a) {
  const dlg = openDialog({ title: `編輯帳戶：${a.name}`, body: h('div', { class: 'cat-menu-list' },
    ...[['◀', '往前移一格', () => nudgeAccount(a.id, -1)], ['▶', '往後移一格', () => nudgeAccount(a.id, 1)],
      ['🎨', '更換圖示與顏色', () => editAccountIcon(a)], ['✏️', '名稱、期初餘額、封存…', () => openAccountDialog(a)],
      ...(a.archived || a.stock ? [] : [['⚖️', '校正餘額', () => openCalibrateDialog(a)]])]
      .map(([ico, label, run]) => h('button', { class: 'btn cat-menu-item', type: 'button', onclick: () => { dlg.close(); run(); } }, h('span', { 'aria-hidden': 'true' }, ico), label))) });
}
function editAccountIcon(a) {
  const l = accLook(a);
  openIconPicker({ title: '帳戶圖示', sub: `「${a.name}」會用這個圖示`, name: a.name, icon: l.icon, color: l.color,
    onSave: async (icon, color) => { await api('PUT', `/api/accounts/${a.id}`, { icon, color }); await afterChange('已更換圖示'); },
    onReset: (a.icon || a.color) ? async () => { await api('PUT', `/api/accounts/${a.id}`, { icon: '', color: '' }); await afterChange('已改回自動圖示'); } : null });
}
function accountTiles(rows, base) {
  const o = S.ov || (S.ov = { y: new Date().getFullYear(), m: new Date().getMonth() + 1, edit: false, shut: {} });
  const grid = h('div', { class: 'tile-grid', 'data-kind': 'account' },
    rows.map((a) => accountTile(a, !!o.editAcc, base)),
    h('button', { type: 'button', class: 'tile add', 'aria-label': '新增帳戶', onclick: () => openAccountDialog(null) }, h('span', { class: 'tile-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'tile-name' }, '新增帳戶')));
  enableTileDrag(grid, 'account', saveAccountOrder);
  return grid;
}

// owed money (advances) in one line on the overview
function owedBanner() {
  const g = S.st.owed || [], al = S.st.owed_alerts || {};
  if (!g.length) return null;
  const text = g.slice(0, 3).map((x) => `${x.counterparty} ${x.remaining.map((r) => `${num(r.amount, r.currency)} ${r.currency}`).join('、')}`).join('；');
  const warn = [al.overdue ? `${al.overdue} 筆已逾期` : '', al.soon ? `${al.soon} 筆 ${al.soon_days} 天內到期` : ''].filter(Boolean).join('、');
  return h('div', { class: 'banner owed' + (al.overdue ? ' late' : '') },
    h('span', null, warn ? h('b', { class: 'due-mark ' + (al.overdue ? 'late' : 'soon') }, `有 ${warn}　`) : null, `待收回的代墊：${text}${g.length > 3 ? ` 等 ${g.length} 位` : ''}`),
    h('a', { class: 'btn sm', href: '#/advances' }, '查看'));
}
