// Transactions by day / month / year: the day heading rows, the month / year summary tables and the switch.
// (Only functions here - nothing touches `S` until a page is drawn, because app.js loads after this file.)

const PERIOD_KINDS = [['day', '按日'], ['month', '按月'], ['year', '按年']];
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function periodLabel(kind, key) {
  if (kind === 'year') return `${key} 年`;
  if (kind === 'month') return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`;
  const d = new Date(`${key}T00:00:00`);
  return `${key}　週${WEEKDAY[d.getDay()]}`;
}

// the first and last day of a month ("2026-11") or year ("2026")
function periodRange(kind, key) {
  if (kind === 'year') return [`${key}-01-01`, `${key}-12-31`];
  const last = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
  return [`${key}-01`, `${key}-${String(last).padStart(2, '0')}`];
}

function periodFigures(g, base) {
  const part = (label, text, cls) => h('span', { class: 'pf' }, h('span', { class: 'pf-l' }, label), h('b', { class: `num ${cls || ''}` }, text));
  return [part('收入', num(g.income, base), 'pos'), part('支出', num(g.expense, base), 'neg'), part('淨額', num(g.net, base, true), g.net >= 0 ? 'pos' : 'neg'),
    h('span', { class: 'pf-n' }, `${g.count} 筆`)];
}

// the heading row above each day's transactions; its button folds the day's rows away (the totals stay visible)
function dayHeadRow(g, key, base, cols, folded, onToggle) {
  const btn = h('button', { type: 'button', class: 'day-toggle', 'aria-expanded': String(!folded), title: folded ? '展開這一天' : '收起這一天',
    onclick: () => onToggle(key, btn.closest('tr')) }, h('span', { class: 'day-chev', 'aria-hidden': 'true' }, folded ? '▸' : '▾'), h('b', { class: 'day-name' }, periodLabel('day', key)));
  return h('tr', { class: 'day-row' + (folded ? ' folded' : ''), 'data-day': key }, h('td', { colspan: cols }, h('div', { class: 'day-head' }, btn, g ? periodFigures(g, base) : null)));
}

// fold / unfold one day without redrawing the table
function toggleDay(table, row, key, folded) {
  row.classList.toggle('folded', folded);
  const b = row.querySelector('.day-toggle');
  b.setAttribute('aria-expanded', String(!folded)); b.title = folded ? '展開這一天' : '收起這一天';
  b.querySelector('.day-chev').textContent = folded ? '▸' : '▾';
  table.querySelectorAll('tr[data-of]').forEach((tr) => { if (tr.dataset.of === key) tr.hidden = folded; });
}

// month / year summary: one line per period; a click opens the next level down
function periodTable(groups, kind, base, onOpen) {
  if (!groups.length) return h('div', { class: 'empty' }, h('b', null, '還沒有符合的交易'), '用上方的「記一筆」開始記帳。');
  const top = Math.max(...groups.map((g) => g.expense), 0) || 1;
  const open = (g) => onOpen(g.key);
  return h('table', { class: 'ledger stack period' },
    h('thead', null, h('tr', null, h('th', null, kind === 'year' ? '年' : '月'), h('th', { class: 'r' }, '筆數'), h('th', { class: 'r' }, '收入'), h('th', { class: 'r' }, '支出'),
      h('th', { class: 'r' }, '淨額'), h('th', null, '支出比例'), h('th', null, ''))),
    h('tbody', null, groups.map((g) => h('tr', { class: 'click', tabindex: '0', role: 'button', 'aria-label': `查看 ${periodLabel(kind, g.key)} 的${kind === 'year' ? '每月' : '每日'}明細`,
      onclick: () => open(g), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(g); } } },
      h('td', { class: 'name' }, periodLabel(kind, g.key)),
      h('td', { class: 'r', 'data-label': '筆數' }, String(g.count)),
      h('td', { class: 'r pos num', 'data-label': '收入' }, num(g.income, base)),
      h('td', { class: 'r neg num', 'data-label': '支出' }, num(g.expense, base)),
      h('td', { class: `r num ${g.net >= 0 ? 'pos' : 'neg'}`, 'data-label': '淨額' }, num(g.net, base, true)),
      h('td', { class: 'pbar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((g.expense / top) * 100)}%` })),
      h('td', { class: 'act' }, h('span', { class: 'muted' }, kind === 'year' ? '看每月 ›' : '看每日 ›'))))));
}

function periodSwitch(current, onPick) {
  return h('div', { class: 'seg period-seg', role: 'group', 'aria-label': '交易的統計單位' },
    PERIOD_KINDS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(current === k), onclick: () => onPick(k) }, l)));
}
