'use strict';
/* 報表 → 帳戶餘額 (1.65.0): every account on one chart that reads at a glance.
   · 期間: 年／月 (as before), 近 30 天, 近 90 天, 近 1 年, 全部.
   · 折線 or 堆疊面積 (every account converted to the main currency, stacked, with the 總資產 line on top: how the total is made up).
   · Accounts of different currencies are converted automatically when drawn together, so they share one axis (a single foreign account still shows its own currency).
   · Under the chart: 期初, 期末, 變化, 最高, 最低 for each line. Click a day to see that day's transactions. Amounts follow the 隱藏金額 setting.
   Only functions and constants here; helpers (h, api, num, mkChart, PALETTE ...) come from app.js at run time. */
const BAL_RANGES = [['ym', '年／月'], ['30', '近 30 天'], ['90', '近 90 天'], ['365', '近 1 年'], ['all', '全部']];
const BAL_MAX_POINTS = 400;

// Colours stay with the account when others are switched on or off.
const balColor = (key) => {
  if (key === 'total') return css('--ink');
  const i = S.st.accounts.findIndex((a) => String(a.id) === String(key));
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
};

function balanceQuery(r) {
  const stack = r.bview === 'stack';
  let sel = r.accounts.length ? r.accounts.slice() : ['total'];
  if (stack) {
    let ids = sel.filter((k) => k !== 'total');
    if (!ids.length) ids = activeAccounts().map((a) => String(a.id));                 // stacked with nothing picked: all accounts
    sel = ['total', ...ids];
  }
  const q = new URLSearchParams({ accounts: sel.join(',') });
  if (r.range === 'ym') { q.set('year', r.year); if (r.month) q.set('month', r.month); } else if (r.range !== 'all') q.set('days', r.range);
  const ccy = new Set(sel.filter((k) => k !== 'total').map((k) => (S.st.accounts.find((a) => String(a.id) === k) || {}).currency));
  const mixed = sel.includes('total') ? ccy.size > 0 : ccy.size > 1;
  if (stack || mixed) q.set('convert', '1');
  return { q, sel, stack, converted: stack || mixed };
}

// A long range has more days than the screen has pixels: keep about BAL_MAX_POINTS of them (always the last day), the day counts are added up.
function balSample(d) {
  const n = d.labels.length;
  if (n <= BAL_MAX_POINTS) return d;
  const step = Math.ceil(n / BAL_MAX_POINTS), idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const counts = idx.map((i, k) => { let s = 0; for (let j = k ? idx[k - 1] + 1 : 0; j <= i; j++) s += d.counts[j] || 0; return s; });
  return { ...d, labels: idx.map((i) => d.labels[i]), counts, series: d.series.map((s) => ({ ...s, data: idx.map((i) => s.data[i]) })) };
}

function balStats(s) {
  const v = s.data; if (!v.length) return null;
  let hi = 0, lo = 0;
  v.forEach((x, i) => { if (x > v[hi]) hi = i; if (x < v[lo]) lo = i; });
  return { first: v[0], last: v[v.length - 1], hi, lo };
}

function balanceChips(r, draw) {
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '選擇要畫的帳戶' });
  const items = [['total', `總資產（${S.st.base}）`], ...activeAccounts().map((a) => [String(a.id), `${a.name}（${a.currency}）`])];
  const sync = () => chips.querySelectorAll('.chip[data-k]').forEach((c) => c.setAttribute('aria-pressed', String(r.accounts.includes(c.dataset.k))));
  chips.append(h('button', { class: 'chip', type: 'button', title: '一次選取全部帳戶', onclick: () => { r.accounts = items.map((i) => i[0]).filter((k) => k !== 'total'); if (r.bview === 'lines' && r.accounts.length > 1) r.accounts.unshift('total'); sync(); draw(); } }, '所有帳戶'));
  items.forEach(([k, l]) => chips.append(h('button', { class: 'chip', type: 'button', 'data-k': k, 'aria-pressed': String(r.accounts.includes(k)), onclick: () => {
    r.accounts = r.accounts.includes(k) ? r.accounts.filter((x) => x !== k) : [...r.accounts, k];
    if (!r.accounts.length) r.accounts = ['total'];
    sync(); draw();
  } }, l)));
  return chips;
}

function balanceControls(r, draw, rebuild) {
  const seg = (label, list, key, after) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, list.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(r[key] === k), onclick: () => { r[key] = k; after(); } }, l)));
  return [seg('期間', BAL_RANGES, 'range', rebuild), seg('畫法', [['lines', '折線'], ['stack', '堆疊面積']], 'bview', rebuild)];
}

async function drawBalanceChart(out, r, notice) {
  const { q, sel, stack, converted } = balanceQuery(r);
  const d0 = await api('GET', '/api/reports/balances?' + q);
  if (!d0.labels.length || !d0.series.length) { out.append(h('div', { class: 'empty' }, h('b', null, '這段期間沒有資料'), '先記幾筆交易，或換一個期間。')); return; }
  // Accounts whose balance stayed 0 all through the period add nothing to the chart or the table: leave them out (and say so), unless that would leave nothing.
  const idle = d0.series.filter((s) => s.key !== 'total' && s.data.every((v) => v === 0));
  const live = d0.series.filter((s) => !idle.includes(s));
  const d = balSample(live.length ? { ...d0, series: live } : d0), base = d.base, hidden = live.length ? idle.length : 0;
  const stacked = d.series.filter((s) => s.key !== 'total');
  const cv = h('canvas', { role: 'img', 'aria-label': stack ? '所有帳戶餘額堆疊面積圖' : '帳戶餘額折線圖' });
  const title = stack ? `帳戶餘額組成（換算成 ${base}，每日收盤）` : '帳戶餘額（每日收盤）';
  out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, title),
    converted ? h('p', { class: 'hint', style: 'margin:0 0 8px' }, `不同幣別已用目前匯率換算成 ${base}，才能畫在同一條軸上；只選一個外幣帳戶時會顯示原幣。`) : null,
    hidden ? h('p', { class: 'hint', style: 'margin:0 0 8px' }, `另有 ${hidden} 個帳戶這段期間餘額一直是 0，沒有畫出來。`) : null,
    h('div', { class: 'chart-wrap tall' }, cv)));
  const dots = d.labels.length > 60 ? 0 : 2.5;
  const datasets = d.series.map((s) => {
    const total = s.key === 'total', color = balColor(s.key);
    const name = `${s.label}（${s.native ? s.native + '→' : ''}${s.currency}）`;
    if (stack) return total
      ? { label: name, data: s.data, borderColor: color, backgroundColor: color, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 8, fill: false, stack: 'total', order: 0, tension: .1 }
      : { label: name, data: s.data, borderColor: color, backgroundColor: color + 'CC', borderWidth: 1, pointRadius: 0, pointHitRadius: 8, fill: true, stack: 'accounts', order: 1, tension: .1 };
    return { label: name, data: s.data, borderColor: color, backgroundColor: color, borderWidth: total ? 2.5 : 1.8, pointRadius: dots, pointHitRadius: 8, tension: .15 };
  });
  const money = (c) => num(c.parsed.y, (d.series[c.datasetIndex] || {}).currency || base);
  const chart = mkChart(cv, { type: 'line', data: { labels: d.labels, datasets }, options: {
    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    onClick: (e, els, ch) => { const hit = ch.getElementsAtEventForMode(e, 'index', { intersect: false }, true)[0]; if (hit) { const day = d.labels[hit.index]; goTransactions({ from: day, to: day }); } },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    plugins: { tooltip: { itemSort: (a, b) => b.parsed.y - a.parsed.y, callbacks: { label: (c) => ` ${c.dataset.label}：${money(c)}`,
      footer: (items) => { const n = d.counts[items[0].dataIndex]; return n ? `當天 ${n} 筆交易（點一下查看）` : '當天沒有交易'; } } } },
    scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { stacked: stack, beginAtZero: stack, ticks: { callback: (v) => (isHidden() ? '' : v) } } } } });
  // The numbers behind the lines.
  const sum = d.series.map((s) => ({ s, st: balStats(s) })).filter((x) => x.st);
  const rows = sum.map(({ s, st }) => {
    const diff = st.last - st.first, pct = st.first ? diff / Math.abs(st.first) * 100 : null;
    const sign = diff > 0 ? 'in' : diff < 0 ? 'out' : '';
    return h('tr', null,
      h('td', null, h('i', { class: 'lg-dot', style: `background:${balColor(s.key)};display:inline-block;margin-right:6px` }), `${s.label}${s.native ? `（${s.native}）` : ''}`),
      h('td', { class: 'r' }, num(st.first, s.currency)), h('td', { class: 'r' }, num(st.last, s.currency)),
      h('td', { class: `r ${sign}` }, num(diff, s.currency, true), pct == null || isHidden() ? '' : h('small', { class: 'muted' }, ` ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`)),
      h('td', { class: 'r' }, num(s.data[st.hi], s.currency), h('small', { class: 'muted' }, ` ${d.labels[st.hi].slice(5)}`)),
      h('td', { class: 'r' }, num(s.data[st.lo], s.currency), h('small', { class: 'muted' }, ` ${d.labels[st.lo].slice(5)}`)));
  });
  out.append(h('div', { class: 'chart-box tablewrap', style: 'margin-top:12px' }, h('table', { class: 'ledger keep bal-sum' },
    h('thead', null, h('tr', null, h('th', null, `${d.labels[0]} → ${d.labels[d.labels.length - 1]}`), h('th', { class: 'r' }, '期初'), h('th', { class: 'r' }, '期末'), h('th', { class: 'r' }, '變化'), h('th', { class: 'r' }, '最高'), h('th', { class: 'r' }, '最低'))),
    h('tbody', null, rows))));
  notice(d.missing_rates);
  return chart;
}
