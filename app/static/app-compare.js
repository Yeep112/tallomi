/* Reports > 月比月: this month against last month and the same month a year ago, category by category.
   With "整年" chosen it compares the year with the year before. */
'use strict';

function cmpDelta(cur, ref, kind) {
  const d = Math.round((cur - ref) * 100) / 100;
  if (!d) return { d: 0, pct: ref ? 0 : null, cls: '', text: ref || cur ? '持平' : '—' };
  const worse = kind === 'expense' ? d > 0 : d < 0;                       // spending more is red, earning more is green
  const pct = ref ? d / ref * 100 : null;
  return { d, pct, cls: worse ? 'neg' : 'pos', text: pct == null ? '新增' : `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%` };
}

async function drawCompare(out, r) {
  if (r.cmpMode === 'custom' || r.cmpMode === 'years') return drawCompareCustom(out, r);
  const d = await api('GET', `/api/reports/compare?year=${r.year}${r.month ? '&month=' + r.month : ''}&kind=${r.cmpKind}`);
  const base = d.base, kind = d.kind, kindWord = kind === 'expense' ? '支出' : '收入';
  const per = Object.fromEntries(d.periods.map((p) => [p.key, p.label]));
  const hasYoy = !!per.yoy;
  const prevName = d.month ? '上個月' : '去年', yoyName = '去年同月';
  const now = new Date();
  const running = d.month ? (d.year === now.getFullYear() && d.month === now.getMonth() + 1) : d.year === now.getFullYear();
  if (d.missing_rates.length) out.append(h('div', { class: 'banner' }, `缺少 ${d.missing_rates.join('、')} 的匯率，這些帳戶沒有算進去。`, h('a', { class: 'btn sm', href: '#/settings' }, '去填匯率')));

  const tile = (label, value, ref, refName) => {
    const dl = ref == null ? null : cmpDelta(value, ref, kind);
    return h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, label), h('b', { class: 'tally-val' }, num(value, base), h('span', { class: 'ccy' }, base)),
      dl ? h('span', { class: `hint cmp-d ${dl.cls}` }, dl.d ? `比${refName}${dl.d > 0 ? '多' : '少'} ${num(Math.abs(dl.d), base)}（${dl.text}）` : `和${refName}持平`) : null);
  };
  out.append(h('div', { class: 'tally', style: 'margin-top:14px', role: 'status' },
    tile(`${per.cur} ${kindWord}`, d.totals.cur, d.totals.prev, prevName),
    h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, `${per.prev}`), h('b', { class: 'tally-val' }, num(d.totals.prev, base), h('span', { class: 'ccy' }, base))),
    hasYoy ? h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, `${per.yoy}（${yoyName}）`), h('b', { class: 'tally-val' }, num(d.totals.yoy, base), h('span', { class: 'ccy' }, base)),
      (() => { const dl = cmpDelta(d.totals.cur, d.totals.yoy, kind); return h('span', { class: `hint cmp-d ${dl.cls}` }, `${d.month ? '本月' : '今年'}${dl.d ? (dl.d > 0 ? '多' : '少') + ' ' + num(Math.abs(dl.d), base) + `（${dl.text}）` : '持平'}`); })()) : null,
    running ? h('div', { class: 'tally-note hint' }, `${per.cur} 還沒結束，只算到今天，和整個${d.month ? '月' : '年'}比會偏低。`) : null));

  if (!d.rows.length) { out.append(h('div', { class: 'empty' }, h('b', null, `這幾個期間都沒有${kindWord}`), '換一個月份，或先記幾筆交易。')); return; }

  const top = d.rows.slice(0, 8);
  const cv = h('canvas', { role: 'img', 'aria-label': `各類別${kindWord}比較` });
  out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, `各類別${kindWord}（金額最高的 ${top.length} 個）`), h('div', { class: 'chart-wrap tall' }, cv)));
  const sets = [['cur', per.cur, css('--brass')], ['prev', per.prev, css('--ink-3')], ...(hasYoy ? [['yoy', per.yoy, OTHER_COLOR]] : [])];
  mkChart(cv, { type: 'bar', data: { labels: top.map((x) => x.category), datasets: sets.map(([k, label, color]) => ({ label, data: top.map((x) => x[k]), backgroundColor: color, borderRadius: 3 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: yAxis() },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${num(c.parsed.y, base)} ${base}` } } } } });

  const catCell = (c) => h('td', { class: 'name' }, c === '轉帳' ? typeChip('transfer') : c === '未分類' ? null : catChip(c, 'sm'), c);
  const dcells = (cur, ref) => { const dl = cmpDelta(cur, ref, kind); return [
    h('td', { class: `r ${dl.cls}` }, dl.d ? num(dl.d, base, true) : '—'), h('td', { class: `r muted ${dl.cls}` }, dl.d ? dl.text : '')]; };
  const total = { category: '合計', cur: d.totals.cur, prev: d.totals.prev, yoy: d.totals.yoy };
  const line = (x, cls = '') => h('tr', { class: cls }, x === total ? h('td', { class: 'name' }, h('b', null, '合計')) : catCell(x.category),
    h('td', { class: 'r' }, num(x.cur, base)), h('td', { class: 'r muted' }, num(x.prev, base)), ...dcells(x.cur, x.prev),
    ...(hasYoy ? [h('td', { class: 'r muted' }, num(x.yoy, base)), ...dcells(x.cur, x.yoy)] : []));
  out.append(h('div', { class: 'tablewrap', style: 'margin-top:14px' }, h('table', { class: 'ledger cmp' },
    h('thead', null, h('tr', null, h('th', null, '類別'), h('th', { class: 'r' }, per.cur), h('th', { class: 'r' }, per.prev), h('th', { class: 'r' }, `比${prevName}`), h('th', { class: 'r' }, ''),
      ...(hasYoy ? [h('th', { class: 'r' }, per.yoy), h('th', { class: 'r' }, `比${yoyName}`), h('th', { class: 'r' }, '')] : []))),
    h('tbody', null, d.rows.map((x) => line(x)), line(total, 'cmp-total')))));
}

// ---- hand-picked months: any 2 to 8 months side by side, every other month measured against one base month
const lastYears = (n) => { const ys = [...new Set([...(S.st.years || []), new Date().getFullYear()])].sort((a, b) => a - b).slice(-n); while (ys.length < 2) ys.unshift(ys[0] - 1); return ys.map(String); };
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
function lastMonths(n) {
  const out = [], d = new Date();
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(ym(x.getFullYear(), x.getMonth() + 1)); }
  return out;
}

async function drawCompareCustom(out, r) {
  const yearly = r.cmpMode === 'years';                                    // 自選年份: whole years side by side instead of months
  const unit = yearly ? '年' : '月', listKey = yearly ? 'years' : 'months';
  const now = new Date();
  if (yearly && (!r.years || !r.years.length)) r.years = lastYears(3);
  if (!yearly && (!r.months || !r.months.length)) r.months = lastMonths(2);
  const chosen = r[listKey];
  r.addY = r.addY || now.getFullYear(); r.addM = r.addM || now.getMonth() + 1;
  const years = [...new Set([...(S.st.years || []), now.getFullYear(), r.addY, ...chosen.map((x) => +String(x).slice(0, 4))])].sort((a, b) => a - b);
  const set = (list) => { r[listKey] = [...new Set(list)].sort().slice(-8); renderRoute(); };
  const panel = h('div', { class: 'cmp-pick' },
    h('div', { class: 'cmp-pick-row' }, h('span', { class: 'muted' }, yearly ? '要比較的年份：' : '要比較的月份：'),
      chosen.length ? h('span', { class: 'cmp-chips' }, chosen.map((m) => h('button', { type: 'button', class: 'tag-chip on', title: `移除這個${unit === '年' ? '年' : '月'}`, 'aria-label': `移除 ${m}`, onclick: () => set(chosen.filter((x) => x !== m)) }, `${m} ×`))) : h('span', { class: 'hint' }, '還沒選')),
    h('div', { class: 'cmp-pick-row' },
      h('select', { 'aria-label': '年', onchange: (e) => { r.addY = +e.target.value; } }, years.map((y) => h('option', { value: y, selected: y === r.addY }, `${y} 年`))),
      yearly ? null : h('select', { 'aria-label': '月', onchange: (e) => { r.addM = +e.target.value; } }, Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === r.addM }, `${i + 1} 月`))),
      h('button', { class: 'btn sm', type: 'button', disabled: chosen.length >= 8, onclick: () => { const v = yearly ? String(r.addY) : ym(r.addY, r.addM); if (chosen.includes(v)) toast(`${v} 已經選了`, true); else set([...chosen, v]); } }, '加入'),
      h('span', { class: 'cmp-presets' }, ...(yearly ? [
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => set(lastYears(2)) }, '近 2 年'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => set(lastYears(3)) }, '近 3 年'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => set((S.st.years || []).slice(-8).map(String)) }, '全部有紀錄的年份')] : [
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => set(lastMonths(3)) }, '近 3 個月'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => set(lastMonths(6)) }, '近 6 個月')]),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { r[listKey] = []; renderRoute(); } }, '清除'))),
    h('p', { class: 'hint', style: 'margin:0' }, yearly ? '最少 2 個、最多 8 個年份，年份可以不連續（例如 2022、2024、2026）。' : '最少 2 個、最多 8 個月，月份可以不連續（例如 3 月、7 月、11 月）。'));
  out.append(panel);
  if (chosen.length < 2) { out.append(h('div', { class: 'empty' }, h('b', null, `再選至少一個${yearly ? '年份' : '月份'}`), yearly ? '用上面的年份選單加入，或按「近 3 年」。' : '用上面的年月選單加入，或按「近 3 個月」。')); return; }

  const d = await api('GET', `/api/reports/compare?${listKey}=${chosen.join(',')}&kind=${r.cmpKind}`);
  const base = d.base, kind = d.kind, kindWord = kind === 'expense' ? '支出' : '收入';
  const keys = d.periods.map((p) => p.key), label = Object.fromEntries(d.periods.map((p) => [p.key, p.label]));
  let baseKey = (d.periods.find((p) => p.label === r.baseMonth) || d.periods[d.periods.length - 1]).key;
  r.baseMonth = label[baseKey];
  const now0 = new Date(), thisMonth = yearly ? String(now0.getFullYear()) : ym(now0.getFullYear(), now0.getMonth() + 1);
  if (d.missing_rates.length) out.append(h('div', { class: 'banner' }, `缺少 ${d.missing_rates.join('、')} 的匯率，這些帳戶沒有算進去。`, h('a', { class: 'btn sm', href: '#/settings' }, '去填匯率')));

  out.append(h('div', { class: 'cmp-pick-row', style: 'margin-top:12px' }, h('label', { class: 'field' }, h('span', null, yearly ? '拿哪一年當基準（其他年份和它比）' : '拿哪個月當基準（其他月份和它比）'),
    h('select', { onchange: (e) => { r.baseMonth = e.target.value; renderRoute(); } }, d.periods.map((p) => h('option', { value: p.label, selected: p.key === baseKey }, p.label))))));

  out.append(h('div', { class: 'tally', style: 'margin-top:10px', role: 'status' },
    ...keys.map((k) => {
      const dl = k === baseKey ? null : cmpDelta(d.totals[k], d.totals[baseKey], kind);
      return h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, k === baseKey ? `${label[k]}（基準）` : label[k]),
        h('b', { class: 'tally-val' }, num(d.totals[k], base), h('span', { class: 'ccy' }, base)),
        dl ? h('span', { class: `hint cmp-d ${dl.cls}` }, dl.d ? `比基準${dl.d > 0 ? '多' : '少'} ${num(Math.abs(dl.d), base)}（${dl.text}）` : '和基準持平') : null);
    }),
    d.periods.some((p) => p.label === thisMonth) ? h('div', { class: 'tally-note hint' }, `${thisMonth} 還沒結束，只算到今天，和整個${yearly ? '年' : '月'}比會偏低。`) : null));

  if (!d.rows.length) { out.append(h('div', { class: 'empty' }, h('b', null, `這幾個${yearly ? '年' : '月'}都沒有${kindWord}`), yearly ? '換幾個年份試試。' : '換幾個月份試試。')); return; }
  const top = d.rows.slice(0, 8);
  const cv = h('canvas', { role: 'img', 'aria-label': `各類別${kindWord}比較` });
  out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, `各類別${kindWord}（合計最高的 ${top.length} 個）`), h('div', { class: 'chart-wrap tall' }, cv)));
  mkChart(cv, { type: 'bar', data: { labels: top.map((x) => x.category), datasets: keys.map((k, i) => ({ label: label[k], data: top.map((x) => x[k]), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 3 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: yAxis() },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${num(c.parsed.y, base)} ${base}` } } } } });

  const catCell = (c) => h('td', { class: 'name' }, c === '轉帳' ? typeChip('transfer') : c === '未分類' ? null : catChip(c, 'sm'), c);
  const cell = (x, k) => {
    if (k === baseKey) return h('td', { class: 'r cmp-base' }, num(x[k], base));
    const dl = cmpDelta(x[k], x[baseKey], kind);
    return h('td', { class: 'r' }, num(x[k], base), dl.d ? h('em', { class: `cmp-sub ${dl.cls}` }, dl.text) : null);
  };
  const total = { category: '合計', ...d.totals };
  out.append(h('div', { class: 'tablewrap', style: 'margin-top:14px' }, h('table', { class: 'ledger cmp' },
    h('thead', null, h('tr', null, h('th', null, '類別'), ...keys.map((k) => h('th', { class: 'r' }, k === baseKey ? `${label[k]}（基準）` : label[k])))),
    h('tbody', null, d.rows.map((x) => h('tr', null, catCell(x.category), ...keys.map((k) => cell(x, k)))),
      h('tr', { class: 'cmp-total' }, h('td', { class: 'name' }, h('b', null, '合計')), ...keys.map((k) => cell(total, k)))))),
    h('p', { class: 'hint' }, `每個格子下方的小字是和基準${yearly ? '年份' : '月份'}相比的變化；支出變多標紅、收入變多標綠。`));
}
