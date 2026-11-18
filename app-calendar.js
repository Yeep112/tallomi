/* 月曆: every day of the month with its net amount (income minus expense); tap a day to see its entries and add one on that day. */
'use strict';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CAL_WEEK = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

// 12,345 -> "12,345"; 120,000 -> "12萬" (the cells are narrow)
function calAmount(v) {
  const a = Math.abs(v);
  if (a >= 100000) return `${(a / 10000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '')}萬`;
  return num(a, S.st.base);
}

// Long press a day (or right click it): choose what to write on that day - spending is the plain tap, this adds income and transfer.
function dayMenu(key) {
  S.calHold = Date.now(); S.calSkip = true;
  const dlg = openDialog({ title: `${key.slice(5).replace('-', '/')} 要記哪一種？`, body: h('div', { class: 'cat-menu-list' },
    ...[['🧾', '支出', 'expense'], ['💰', '收入', 'income'], ['🔁', '轉帳', 'transfer']].map(([ico, label, type]) =>
      h('button', { class: 'btn cat-menu-item', type: 'button', onclick: () => { dlg.close(); openQuickAdd({ type, date: key }); } }, h('span', { 'aria-hidden': 'true' }, ico), `記一筆${label}`)),
    h('button', { class: 'btn cat-menu-item', type: 'button', onclick: async () => {
      dlg.close();
      const c = S.cal; if (!c) return;
      c.sel = key; c.y = +key.slice(0, 4); c.m = +key.slice(5, 7);
      await renderRoute();
      const p = document.querySelector('.cal-day'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } }, h('span', { 'aria-hidden': 'true' }, '📋'), '看這天明細')) });
}
function holdDay(e, key, day) {
  S.calSkip = false;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  const off = () => { clearTimeout(timer); document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', off); document.removeEventListener('pointercancel', off); };
  const mv = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) off(); };               // moved: it is a scroll, not a press
  const timer = setTimeout(() => { off(); dayMenu(key); }, 500);
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', off); document.addEventListener('pointercancel', off);
}

async function viewCalendar(view) {
  const c = S.cal || (S.cal = { y: new Date().getFullYear(), m: new Date().getMonth() + 1, sel: ymd(new Date()) });
  const first = new Date(c.y, c.m - 1, 1), start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));                       // the grid starts on the Monday on or before the 1st
  const lastDay = new Date(c.y, c.m, 0), weeks = Math.ceil(((first.getDay() + 6) % 7 + lastDay.getDate()) / 7);
  const end = new Date(start); end.setDate(start.getDate() + weeks * 7 - 1);
  const qs = new URLSearchParams({ group: 'day', from: ymd(start), to: ymd(end), limit: 1000, transfers: S.st.prefs.count_transfers ? '1' : '0' });
  const d = await api('GET', `/api/transactions?${qs}`);
  const base = d.totals.base, days = Object.fromEntries((d.groups || []).map((g) => [g.key, g]));
  const byDay = {};
  d.items.forEach((t) => { (byDay[t.time.slice(0, 10)] = byDay[t.time.slice(0, 10)] || []).push(t); });
  const inMonth = (key) => key.slice(0, 7) === `${c.y}-${String(c.m).padStart(2, '0')}`;
  let inc = 0, exp = 0;
  Object.values(days).forEach((g) => { if (inMonth(g.key)) { inc += g.income; exp += g.expense; } });
  const today = ymd(new Date());
  const go = (n) => { const x = new Date(c.y, c.m - 1 + n, 1); c.y = x.getFullYear(); c.m = x.getMonth() + 1; c.sel = ''; renderRoute(); };

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const key = ymd(day), g = days[key], out = !inMonth(key);
    const net = g ? g.net : 0, has = g && g.count > 0;
    cells.push(h('button', { type: 'button', class: `cal-cell${out ? ' out' : ''}${key === today ? ' today' : ''}${key === c.sel ? ' sel' : ''}`, 'aria-pressed': String(key === c.sel),
      'aria-label': `${key}${has ? `，淨額 ${num(net, base, true)}，${g.count} 筆` : '，沒有交易'}`,
      onclick: () => {
        if (S.calSkip && Date.now() - (S.calHold || 0) < 3000) { S.calSkip = false; return; }   // the click that ends a long press
        c.sel = key; if (out) { c.y = day.getFullYear(); c.m = day.getMonth() + 1; } renderRoute(); openQuickAdd({ date: key });
      },
      onpointerdown: (e) => holdDay(e, key, day), oncontextmenu: (e) => { e.preventDefault(); if (Date.now() - (S.calHold || 0) > 800) dayMenu(key); } },
      h('span', { class: 'cal-d' }, String(day.getDate())),
      has ? h('span', { class: 'cal-nums' },
        g.income ? h('span', { class: 'cal-in' }, '+' + calAmount(g.income)) : null,
        g.expense ? h('span', { class: 'cal-out' }, '−' + calAmount(g.expense)) : null,
        g.income && g.expense ? h('span', { class: `cal-net ${net < 0 ? 'neg' : 'pos'}` }, (net < 0 ? '−' : net > 0 ? '+' : '') + calAmount(net)) : null,
        !g.income && !g.expense ? h('span', { class: 'cal-net' }, '0') : null) : null,
      has ? h('span', { class: 'cal-dot', 'aria-hidden': 'true' }) : null));
  }

  const picker = h('input', { class: 'cal-picker', tabindex: '-1', 'aria-hidden': 'true', type: 'month', value: `${c.y}-${String(c.m).padStart(2, '0')}`, 'aria-label': '跳到某個月', onchange: (e) => {
    const v = e.target.value; if (/^\d{4}-\d{2}$/.test(v)) { c.y = +v.slice(0, 4); c.m = +v.slice(5); c.sel = ''; renderRoute(); } } });
  const intro = pageIntro('每一天標出當天的收入（綠）和支出（紅），兩者都有時再多一行淨額；點某一天就直接在那天記一筆支出，關掉視窗後下方會看到那天的明細；長按（電腦可按右鍵）則可選記收入或轉帳。');
  view.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '月曆', eyeButton('calendar'), intro.btn), intro.p)),
    h('div', { class: 'cal-top' },
      h('div', { class: 'month-nav cal-nav', role: 'group', 'aria-label': '切換月份' },
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': '上一個月', onclick: () => go(-1) }, '‹'),
        h('button', { class: 'cal-title', type: 'button', title: '點一下跳到某個月', onclick: () => { try { picker.showPicker(); } catch (e) { picker.focus(); picker.click(); } } }, `${c.y} 年 ${c.m} 月`),
        picker,
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': '下一個月', onclick: () => go(1) }, '›'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { const t = new Date(); c.y = t.getFullYear(); c.m = t.getMonth() + 1; c.sel = ymd(t); renderRoute(); } }, '今天'))),
    h('div', { class: 'cal', role: 'group', 'aria-label': `${c.y} 年 ${c.m} 月` },
      h('div', { class: 'cal-week', 'aria-hidden': 'true' }, CAL_WEEK.map((w) => h('span', null, w))),
      h('div', { class: 'cal-grid' }, cells),
      h('div', { class: 'cal-sum' },
        h('div', null, h('span', { class: 'muted' }, '收入'), h('b', { class: 'pos num' }, num(inc, base))),
        h('div', null, h('span', { class: 'muted' }, '支出'), h('b', { class: 'neg num' }, num(exp, base))),
        h('div', null, h('span', { class: 'muted' }, '結餘'), h('b', { class: 'num ' + (inc - exp >= 0 ? 'pos' : 'neg') }, num(inc - exp, base, true))))),
    transfersSwitch(S.st.prefs.count_transfers ? '已把轉帳算進來：轉出算支出、轉入算收入，每天的數字和上面的合計都含轉帳' : '轉帳不算收支，月曆只看收入和支出'));
  // phone: slide the month grid left for the next month, right for the one before
  const cal = view.querySelector('.cal');
  if (cal && isPhone() && onTouch()) {
    let st = null;
    cal.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || !e.isPrimary) return; const W = document.documentElement.clientWidth; st = (e.clientX < 22 || e.clientX > W - 22) ? null : { x: e.clientX, y: e.clientY }; });
    cal.addEventListener('pointerup', (e) => {
      if (!st) return; const dx = e.clientX - st.x, dy = e.clientY - st.y; st = null;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { S.calSwiped = Date.now(); go(dx < 0 ? 1 : -1); }
    });
    cal.addEventListener('pointercancel', () => { st = null; });
    cal.addEventListener('click', (e) => { if (Date.now() - (S.calSwiped || 0) < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  if (d.total > d.items.length) view.append(h('div', { class: 'hint' }, `這個月份的交易太多，月曆只列出最近的 ${d.items.length} 筆明細；每天的淨額仍然是完整的。`));

  if (c.sel) {
    const list = (byDay[c.sel] || []).slice().reverse(), g = days[c.sel];
    const wd = CAL_WEEK[(new Date(`${c.sel}T00:00:00`).getDay() + 6) % 7];
    view.append(h('section', { class: 'section cal-day' },
      h('div', { class: 'section-head' },
        h('h2', null, `${c.sel.slice(5).replace('-', '/')}　${wd}`, g ? h('span', { class: 'cal-day-net' }, `　淨額 `, h('b', { class: 'num ' + (g.net >= 0 ? 'pos' : 'neg') }, num(g.net, base, true))) : null),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openQuickAdd({ date: c.sel }) }, `＋ 在 ${c.sel.slice(5).replace('-', '/')} 記一筆`)),
      list.length ? pickableList(list) : h('div', { class: 'empty' }, h('b', null, '這一天還沒有交易'), '按右上角的按鈕，直接記在這一天。')));
  }
}
