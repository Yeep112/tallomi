/* 1.67.0 — 投資頁: 股利 (dividends), 殖利率, 年化報酬 (XIRR) and 資產配置.
   A dividend is what really arrived in a bank account (after the broker's fees and the health-insurance levy), recorded against a stock. The server
   books it as income in the receiving account and works out the yield and the yearly return; this file draws them (dividendSection) and has the
   form (openDividendDialog). The allocation donut is plain SVG so it also works when the charting library has not loaded.
   Only functions here: nothing touches `S` until a page is drawn. */
'use strict';

const DV_NS = 'http://www.w3.org/2000/svg';
function dvEl(tag, attrs) { const n = document.createElementNS(DV_NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); return n; }
const dvPct = (v) => (v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`);
const dvYear = (v) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`);
const DV_CASH = '#8A9099';

// ------------------------------------------------------------------ allocation
function allocGroups(alloc, by) {
  const out = new Map();
  for (const s of alloc.slices) {
    const key = by === 'currency' ? s.currency : s.key;
    const label = by === 'currency' ? s.currency : s.label;
    const cur = out.get(key) || { key, label, value: 0, cash: s.kind === 'cash' && by !== 'currency' };
    cur.value += s.value; out.set(key, cur);
  }
  return [...out.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
}

function allocDonut(groups, base) {
  const total = groups.reduce((t, g) => t + g.value, 0) || 1;
  const size = 160, R = 62, W = 24, C = 2 * Math.PI * R;
  const svgEl = dvEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'alloc-svg', role: 'img', 'aria-label': `資產配置：${groups.map((g) => `${g.label} ${(g.value / total * 100).toFixed(1)}%`).join('、')}` });
  svgEl.append(dvEl('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: 'var(--line-2)', 'stroke-width': W }));
  let off = 0; const arcs = [];
  groups.forEach((g, i) => {
    const len = g.value / total * C;
    const a = dvEl('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: g.cash ? DV_CASH : PALETTE[i % PALETTE.length], 'stroke-width': W,
      'stroke-dasharray': `${Math.max(len - (groups.length > 1 ? 1.2 : 0), 0.01)} ${C}`, 'stroke-dashoffset': String(-off), transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'alloc-arc', 'data-i': String(i) });
    const t = dvEl('title'); t.textContent = `${g.label}　${(g.value / total * 100).toFixed(1)}%`; a.append(t);
    arcs.push(a); svgEl.append(a); off += len;
  });
  const big = dvEl('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', class: 'alloc-big' }), sub = dvEl('text', { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', class: 'alloc-sub' });
  svgEl.append(big, sub);
  const show = (i) => {
    const g = groups[i];
    big.textContent = g ? `${(g.value / total * 100).toFixed(1)}%` : num(total, base);
    sub.textContent = g ? g.label : base;
    arcs.forEach((a, j) => a.classList.toggle('dim', i != null && j !== i));
  };
  show(null);
  return { svgEl, show, total };
}

function allocSection(board, inv) {
  const a = board.allocation, base = a.base;
  if (!a.slices.some((s) => s.value > 0)) return null;
  const by = inv.allocBy === 'currency' ? 'currency' : 'item';
  const groups = allocGroups(a, by);
  const { svgEl, show, total } = allocDonut(groups, base);
  const rows = groups.map((g, i) => h('li', { class: 'alloc-row', tabindex: '0', onmouseenter: () => show(i), onmouseleave: () => show(null), onfocus: () => show(i), onblur: () => show(null) },
    h('span', { class: 'share-dot', style: `background:${g.cash ? DV_CASH : PALETTE[i % PALETTE.length]}` }), h('span', { class: 'alloc-name' }, g.label),
    h('span', { class: 'alloc-pct num' }, `${(g.value / total * 100).toFixed(1)}%`), h('span', { class: 'alloc-amt num muted' }, num(g.value, base))));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '配置的分法' },
    [['item', '依標的'], ['currency', '依幣別']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(by === k), onclick: () => { inv.allocBy = k; if (S.invRepaint) S.invRepaint(); } }, label)));
  return h('section', { class: 'section alloc-card' },
    h('div', { class: 'section-head' }, h('h2', null, '資產配置'), seg),
    h('div', { class: 'alloc-body' }, h('div', { class: 'alloc-chart' }, svgEl), h('ul', { class: 'alloc-list' }, rows)),
    h('p', { class: 'hint' }, `股票用預估市值、其他帳戶用目前餘額，都換算成 ${base}。${a.debt ? `另有負債 ${num(a.debt, base)} ${base}，沒有算進圖裡。` : ''}${board.totals.missing_prices ? '有幾檔還沒有股價，沒有算進去。' : ''}`));
}

// ------------------------------------------------------------------ dividends
function dividendSection(board, inv, repaint) {
  const t = board.totals, base = S.st.base, divs = board.dividends || [];
  const held = board.positions.filter((p) => p.shares > 0 || p.dividends);
  const shown = inv.divAll ? divs : divs.slice(0, 8);
  const stat = (label, value, tip) => h('div', { class: 'dv-stat', title: tip || null }, h('span', { class: 'label muted' }, label), h('b', { class: 'num' }, value));
  const head = h('div', { class: 'section-head' }, h('h2', null, '股利與年化報酬'),
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => openDividendDialog(null, board, repaint) }, '記錄股利'));
  if (!divs.length && !board.positions.some((p) => p.shares > 0)) return null;
  const kids = [head];
  kids.push(h('div', { class: 'dv-stats' },
    stat('累計股利', `${num(t.dividends, base)} ${base}`, '每一筆記錄下來的實收股利，換算成主要幣別後加總'),
    stat('近一年股利', `${num(t.dividends_ttm, base)} ${base}`),
    stat('殖利率（近一年）', dvPct(t.yield), '近一年收到的股利 ÷ 目前持股市值'),
    stat('含股利總報酬', t.total_ret_div == null ? '—' : dvYear(t.total_ret_div), '（損益試算 ＋ 已實現損益 ＋ 股利）÷（持股成本 ＋ 已賣出股數的成本）'),
    stat('年化報酬（XIRR）', dvYear(t.xirr), '把每筆買進、賣出、股利和目前市值當成現金流，算出一年約幾 %。持有不到 30 天算不出來')));
  if (held.length) {
    kids.push(h('div', { class: 'tablewrap' }, h('table', { class: 'ledger dv-table stack' },
      h('thead', null, h('tr', null, ['股票', '累計股利', '殖利率', '成本殖利率', '年化報酬'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
      h('tbody', null, held.map((p) => h('tr', null,
        h('td', { class: 'name' }, p.name || p.symbol, h('span', { class: 'hint' }, `　${p.symbol}`)),
        h('td', { class: 'r', 'data-label': '累計股利' }, p.dividends ? money(p.dividends, p.currency, { tag: false }) : '—', p.dividend_missing_rate ? h('div', { class: 'hint inv-bad' }, '缺匯率') : null),
        h('td', { class: 'r', 'data-label': '殖利率', title: '近一年股利 ÷ 目前市值' }, p.dividends ? dvPct(p.yield) : '—'),
        h('td', { class: 'r', 'data-label': '成本殖利率', title: '近一年股利 ÷ 付出成本' }, p.dividends ? dvPct(p.yield_cost) : '—'),
        h('td', { class: 'r', 'data-label': '年化報酬' }, p.xirr == null ? '—' : h('span', { class: 'tw' + twTone(p.xirr) }, dvYear(p.xirr)))))))));
  }
  if (divs.length) {
    kids.push(h('h3', { class: 'dv-sub' }, '股利紀錄'));
    kids.push(h('div', { class: 'tablewrap' }, h('table', { class: 'ledger dv-list stack' },
      h('thead', null, h('tr', null, ['日期', '股票', '每股', '入帳帳戶', '實收金額'].map((x, i) => h('th', { class: i === 4 ? 'r' : '' }, x)), h('th', { class: 'c-act' }, ''))),
      h('tbody', null, shown.map((d) => h('tr', { class: 'tx-row', tabindex: '0', title: '點一下編輯這筆股利', ...rowTap(() => openDividendDialog(d, board, repaint)) },
        h('td', { class: 'when', 'data-label': '日期' }, d.time.slice(0, 10)),
        h('td', { 'data-label': '股票' }, d.name || d.symbol, h('span', { class: 'hint' }, `　${d.symbol}`)),
        h('td', { 'data-label': '每股' }, d.per_share ? d.per_share : '—', d.shares ? h('span', { class: 'hint' }, `　持股 ${invCount(d.shares)}`) : null),
        h('td', { 'data-label': '入帳帳戶' }, d.pay_account),
        h('td', { class: 'r', 'data-label': '實收金額' }, money(d.amount, d.currency, { tone: true })),
        h('td', { class: 'act' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openDividendDialog(d, board, repaint) }, '編輯'))))))));
    if (divs.length > 8) kids.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { inv.divAll = !inv.divAll; repaint(); } }, inv.divAll ? '只顯示最近 8 筆' : `顯示全部 ${divs.length} 筆`));
  } else kids.push(h('p', { class: 'hint' }, '收到配息後按「記錄股利」，填實際入帳的金額；它會算進入帳帳戶的餘額與本月收入，並用來計算殖利率和年化報酬。'));
  return h('section', { class: 'section dv-card' }, ...kids);
}

function openDividendDialog(d, board, repaint) {
  const stocks = board.positions;
  const pays = (board.accounts || []).length ? board.accounts : activeAccounts().filter((a) => !a.stock);
  if (!stocks.length) { toast('先到「管理股票」新增持股', true); return; }
  const first = stocks.find((p) => p.shares > 0) || stocks[0];
  const m = { account_id: d ? d.account_id : first.account_id, day: d ? d.time.slice(0, 10) : nowLocal().slice(0, 10), amount: d ? String(d.amount) : '',
    pay_account_id: d ? d.pay_account_id : ((pays.find((a) => a.id === (acct(first.account_id) || {}).id) || pays[0] || {}).id || ''), per_share: d && d.per_share ? d.per_share : '', note: d ? d.note : '' };
  const ccyOf = () => { const a = pays.find((x) => x.id == m.pay_account_id); return a ? a.currency : base0; };
  const base0 = S.st.base, ccyTag = h('span', { class: 'ccy' }, ccyOf());
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, '哪一檔'), h('select', { onchange: (e) => { m.account_id = +e.target.value; } },
        stocks.map((p) => h('option', { value: p.account_id, selected: p.account_id == m.account_id }, `${p.name || p.symbol}（${p.symbol}）`)))),
      h('label', { class: 'field' }, h('span', null, '入帳日'), h('input', { type: 'date', value: m.day, onchange: (e) => { m.day = e.target.value; } }))),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, '實際入帳金額'), h('span', { class: 'row-inline' }, h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '銀行收到的金額', value: m.amount, oninput: (e) => { m.amount = e.target.value; } }), ccyTag)),
      h('label', { class: 'field' }, h('span', null, '入到哪個帳戶'), h('select', { onchange: (e) => { m.pay_account_id = +e.target.value; ccyTag.textContent = ccyOf(); } },
        pays.map((a) => h('option', { value: a.id, selected: a.id == m.pay_account_id }, `${a.name}（${a.currency}）`))))),
    h('label', { class: 'field' }, h('span', null, '每股股利（可不填）'), h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '例如 2.5', value: m.per_share, oninput: (e) => { m.per_share = e.target.value; } })),
    h('label', { class: 'field' }, h('span', null, '備註（可不填）'), h('input', { maxlength: 200, autocomplete: 'off', value: m.note, oninput: (e) => { m.note = e.target.value; } })),
    h('p', { class: 'hint' }, '金額填銀行實際收到的（已扣掉匯費與二代健保補充保費）。它會變成入帳帳戶的一筆收入，類別是「股利」。'));
  openDialog({
    title: d ? '編輯股利' : '記錄股利', body,
    extraFoot: d ? h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
      if (!window.confirm('刪除這筆股利？入帳帳戶裡對應的收入也會一起刪除。')) return;
      try { await api('DELETE', `/api/invest/dividends/${d.id}`); e.target.closest('dialog').close(); await afterChange('已刪除股利'); } catch (err) { fail(err); }
    } }, '刪除') : null,
    primary: { label: d ? '儲存' : '記錄', run: async () => {
      const p = { account_id: m.account_id, time: `${m.day}T10:00`, amount: m.amount, pay_account_id: m.pay_account_id, per_share: m.per_share, note: m.note };
      if (d) await api('PUT', `/api/invest/dividends/${d.id}`, p); else await api('POST', '/api/invest/dividends', p);
      await afterChange(d ? '已儲存股利' : '已記錄股利');
    } },
  });
}
