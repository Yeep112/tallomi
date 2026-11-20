'use strict';
/* 1.60.0 — 淨資產走勢: the net worth day by day, drawn as a small inline-SVG line (no chart library, so the page it sits on stays light and can still be
   kept for the next visit). A finger or the mouse moved over it reads out any day; the amounts follow the eye button like everything else.
   The numbers come from /api/networth (rebuilt from the ledger with the same rules as the 淨資產 card). Uses helpers from app.js at run time. */
const NW_RANGES = [['1 個月', 30], ['3 個月', 90], ['6 個月', 180], ['1 年', 365], ['全部', 0]];
const NW = { days: null, parts: false, cache: new Map() };
const NW_NS = 'http://www.w3.org/2000/svg';

function nwDays() {
  if (NW.days == null) { const raw = lsGet('pw_nw_days'), v = Number(raw); NW.days = raw != null && NW_RANGES.some((r) => r[1] === v) ? v : 90; }
  return NW.days;
}
const nwKey = (days) => `${S.rev}|${days}|${new Date().toDateString()}`;              // new data (any change bumps the revision) or a new day: ask again
const nwCached = (days) => { const hit = NW.cache.get(days); return hit && hit.key === nwKey(days) ? hit.data : null; };
async function nwLoad(days) {
  const hit = nwCached(days);
  if (hit) return hit;
  const data = await api('GET', `/api/networth?days=${days}`);
  NW.cache.set(days, { key: nwKey(days), data });
  return data;
}
function nwEl(tag, attrs) { const n = document.createElementNS(NW_NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); return n; }
const nwShort = (iso, withYear) => (withYear ? `${iso.slice(0, 4)}/` : '') + `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const nwSpan = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const nwPct = (from, to) => (from ? (to - from) / Math.abs(from) * 100 : null);

// The chart itself for one answer from the server. Returns the nodes to show under the range buttons.
function nwDraw(d, { compact, parts }) {
  const n = d.labels.length, base = d.base;
  if (n < 2) return [h('p', { class: 'hint nw-empty' }, '再多記幾天帳，這裡就會畫出淨資產的走勢。')];
  const lines = [['net', d.net]].concat(parts ? [['gross', d.gross], ['debts', d.debts]] : []);
  let lo = Infinity, hi = -Infinity;
  for (const [, ys] of lines) for (const v of ys) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi === lo) { hi += 1; lo -= 1; }
  const T = 6, B = 94, X = (i) => (i / (n - 1) * 100), Y = (v) => B - (v - lo) / (hi - lo) * (B - T);
  const path = (ys) => ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join('');
  const sv = nwEl('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (lo < 0 && hi > 0) sv.append(nwEl('line', { class: 'nw-zero', x1: '0', x2: '100', y1: String(Y(0).toFixed(2)), y2: String(Y(0).toFixed(2)) }));
  sv.append(nwEl('path', { class: 'nw-area', d: `${path(d.net)}L100 100L0 100Z` }));
  if (parts) { sv.append(nwEl('path', { class: 'nw-gross', d: path(d.gross) })); sv.append(nwEl('path', { class: 'nw-debts', d: path(d.debts) })); }
  sv.append(nwEl('path', { class: 'nw-line', d: path(d.net) }));

  const first = d.labels[0], last = d.labels[n - 1], yearApart = first.slice(0, 4) !== last.slice(0, 4);
  const rangeText = () => {
    if (!d.days) return '全部期間';
    if (nwSpan(first, last) < d.days - 1) return `自 ${nwShort(first, yearApart)} 起`;
    return `近 ${(NW_RANGES.find((r) => r[1] === d.days) || ['', d.days])[0]}`;
  };
  const big = h('b', { class: 'nw-big num' }), delta = h('span', { class: 'nw-delta' }), when = h('span', { class: 'nw-when muted' }), sub = h('div', { class: 'nw-sub muted num' });
  const cur = h('i', { class: 'nw-cur', 'aria-hidden': 'true' }), dot = h('i', { class: 'nw-dot', 'aria-hidden': 'true' });
  const hiddenNow = isHidden();
  const chart = h('div', { class: 'nw-chart no-page-swipe' + (compact ? ' compact' : ''), tabindex: '0', role: 'img',
    'aria-label': hiddenNow ? '淨資產走勢圖（金額已隱藏）' : `淨資產走勢圖：${first} 到 ${last}，從 ${num(d.net[0], base)} 到 ${num(d.net[n - 1], base)} ${base}。可用左右方向鍵逐日查看。` }, sv, cur, dot);
  // what the line above the chart says: the latest day, or the day under the finger, and how far it moved since the start of the range
  const show = (i, scrub) => {
    const v = d.net[i], diff = Math.round((v - d.net[0]) * 100) / 100, pct = nwPct(d.net[0], v);
    big.replaceChildren(num(v, base), h('small', { class: 'ccy' }, ' ' + base));
    const tone = diff > 0 ? 'pos' : diff < 0 ? 'neg' : '';
    delta.className = 'nw-delta ' + tone;
    delta.textContent = i === 0 ? '' : diff === 0 ? '沒有變化' : `${diff > 0 ? '▲' : '▼'} ${num(diff, base, true)}${pct == null ? '' : `（${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%）`}`;
    when.textContent = scrub ? d.labels[i] : rangeText();
    sub.textContent = `資產 ${num(d.gross[i], base)}　負債 ${num(d.debts[i], base)}`;
  };
  show(n - 1, false);
  let at = n - 1, raf = 0, rect = null;
  const place = () => {
    raf = 0;
    const x = X(at), y = Y(d.net[at]);
    cur.style.left = `${x}%`; dot.style.left = `${x}%`; dot.style.top = `${y}%`;
    show(at, true);
  };
  const go = (i) => { at = Math.max(0, Math.min(n - 1, i)); chart.classList.add('on'); if (!raf) raf = requestAnimationFrame(place); };
  const off = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } chart.classList.remove('on'); rect = null; show(n - 1, false); };
  const idxAt = (x) => { const r = rect || (rect = chart.getBoundingClientRect()); return Math.round(Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width))) * (n - 1)); };
  chart.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    rect = chart.getBoundingClientRect();
    try { chart.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    go(idxAt(e.clientX));
  });
  chart.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || chart.hasPointerCapture(e.pointerId)) go(idxAt(e.clientX)); });
  for (const t of ['pointerup', 'pointercancel']) chart.addEventListener(t, off);
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') off(); });
  chart.addEventListener('keydown', (e) => {
    const k = e.key, step = e.shiftKey ? 7 : 1;
    if (k === 'ArrowLeft') go((chart.classList.contains('on') ? at : n - 1) - step);
    else if (k === 'ArrowRight') go((chart.classList.contains('on') ? at : n - 1) + step);
    else if (k === 'Home') go(0); else if (k === 'End') go(n - 1);
    else if (k === 'Escape') off(); else return;
    e.preventDefault();
  });
  chart.addEventListener('blur', off);

  const notes = [];
  if (d.approx) notes.push(`有 ${d.foreign.join('、')} 的帳戶：匯率用的是現在的，過去的數字只是近似值。`);
  if (d.stocks.some((v) => v > 0)) notes.push('股票帳戶以付出成本計算，不含股價漲跌。');
  if (d.missing_rates.length) notes.push(`缺少 ${d.missing_rates.join('、')} 的匯率，這些帳戶沒有算進去。`);
  return [
    h('div', { class: 'nw-read' }, big, delta, when),
    sub, chart,
    h('div', { class: 'nw-axis muted', 'aria-hidden': 'true' }, h('span', null, nwShort(first, yearApart)), h('span', null, nwShort(last, yearApart))),
    notes.length ? h('p', { class: 'hint nw-note' }, notes.join('')) : null,
  ];
}

// The block for the accounts page and the (optional) overview block. It is built at once with a grey place-holder and filled when the numbers arrive,
// or at once when the same answer is already kept (same revision, same day), so a page that is built again does not blink.
function netWorthTrend({ compact = false } = {}) {
  if (!S.st.accounts.some((a) => !a.archived)) return null;
  const body = h('div', { class: 'nw-body', 'aria-live': 'polite' }, h('div', { class: 'nw-ph' + (compact ? ' compact' : ''), 'aria-hidden': 'true' }));
  const ranges = h('div', { class: 'seg', role: 'group', 'aria-label': '走勢的範圍' });
  const partsBtn = h('button', { class: 'chip nw-parts', type: 'button', 'aria-pressed': String(NW.parts), title: '另外畫出總資產與總負債兩條線',
    onclick: () => { NW.parts = !NW.parts; partsBtn.setAttribute('aria-pressed', String(NW.parts)); paint(); } }, '畫出資產與負債');
  const sec = h('section', { class: 'section nw-trend' + (compact ? ' compact' : '') },
    h('div', { class: 'section-head' }, h('h2', null, '淨資產走勢'), ranges),
    body, h('div', { class: 'nw-tools' }, partsBtn));
  let seq = 0;
  const mark = () => ranges.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(NW_RANGES[i][1] === nwDays())));
  NW_RANGES.forEach(([label, days]) => ranges.append(h('button', { type: 'button', 'aria-pressed': String(days === nwDays()),
    onclick: () => { NW.days = days; lsSet('pw_nw_days', String(days)); mark(); paint(); } }, label)));
  async function paint() {
    const days = nwDays(), my = ++seq, opts = { compact, parts: NW.parts };
    const hit = nwCached(days);
    if (hit) { body.classList.remove('busy'); body.replaceChildren(...nwDraw(hit, opts).filter(Boolean)); return; }
    body.classList.add('busy');
    try {
      const d = await nwLoad(days);
      if (my !== seq) return;                                                       // another choice was made meanwhile (the section may not be on the page yet: the home page adds all its blocks together, after the slowest one has answered)
      body.replaceChildren(...nwDraw(d, opts).filter(Boolean));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('p', { class: 'hint nw-empty' }, `讀不到走勢資料：${e.message}`));
    } finally { if (my === seq) body.classList.remove('busy'); }
  }
  paint();
  return sec;
}
