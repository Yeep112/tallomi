/* Tags page: one tag as a project (a trip, a renovation ...) with its total, a daily trend, a category breakdown and a CSV for
   reimbursement. Also the "current tag" mode of the entry bar: pin a tag and every new entry carries it until you end it. */
'use strict';

// ------------------------------------------------------------------- current tag mode
const PIN_KEY = 'pw_pin_tags';
const pinnedTags = () => lsGet(PIN_KEY) || '';
function setPinnedTags(text) {
  lsSet(PIN_KEY, text || '');
  S.entry.tags = text || '';
  const old = document.querySelector('form.entry');
  if (old) old.replaceWith(entryBar());
}
// The strip at the top of the entry bar while the mode is on.
function pinBar() {
  const text = pinnedTags();
  if (!text) return null;
  return h('div', { class: 'pin-bar', role: 'status' },
    h('span', null, '目前標籤：'), ...splitTags(text).map((t) => h('b', { class: 'tag-chip on' }, '#' + t)),
    h('span', { class: 'hint' }, '每一筆都會自動帶上'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => { setPinnedTags(''); toast('已結束，之後的新交易不會自動帶標籤'); } }, '結束'));
}

// ------------------------------------------------------------------- the page
const money0 = (v, base) => `${num(v, base)} ${base}`;

async function viewTags(view) {
  const tags = S.st.tag_list || [];
  const intro = pageIntro('標籤可以跨類別，例如「日本旅行」。選一個標籤，看這一趟（或這個專案）總共花多少、哪天花最多、錢花在哪些類別。');
  view.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, '標籤', eyeButton('tags'), intro.btn), intro.p)));
  if (!tags.length) {
    view.append(h('div', { class: 'empty' }, h('b', null, '還沒有標籤'), '記帳或編輯交易時，在「標籤」欄輸入，例如 日本旅行。也可以在「交易」頁按「選取多筆」，一次替很多筆加上標籤。'));
    return;
  }
  if (!tags.some((t) => t.tag === S.tagSel)) S.tagSel = tags[0].tag;
  const body = h('div');
  const chips = h('div', { class: 'tag-tabs', role: 'group', 'aria-label': '選擇標籤' }, tags.map((t) => h('button', {
    class: 'tag-chip big', type: 'button', 'aria-pressed': String(t.tag === S.tagSel), onclick: () => { S.tagSel = t.tag; chips.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(tags[i].tag === t.tag))); draw(); },
  }, `#${t.tag}`, h('em', null, ` ${t.count}`))));
  view.append(chips, body);
  let seq = 0;
  async function draw() {
    const mine = ++seq;
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    let d;
    try { d = await api('GET', '/api/reports/tag?tag=' + encodeURIComponent(S.tagSel)); } catch (e) { if (mine === seq) body.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    if (mine !== seq) return;
    body.replaceChildren(paintTag(d));
    drawTagCharts(body, d);
  }
  await draw();
}

function paintTag(d) {
  const base = d.base;
  const cell = (label, value, cls = '', sub = null) => h('div', { class: 'tally-cell' }, h('span', { class: 'tally-label' }, label),
    h('b', { class: `tally-val ${cls}` }, value), sub ? h('span', { class: 'hint' }, sub) : null);
  const span = d.first ? (d.first === d.last ? d.first : `${d.first} ～ ${d.last}`) : '';
  const pinned = splitTags(pinnedTags()).some((t) => t.toLowerCase() === d.tag.toLowerCase());
  const notes = [];
  if (d.kinds.transfer || d.kinds.adjust) notes.push(S.st.prefs.count_transfers ? `含 ${d.kinds.transfer} 筆轉帳（轉出算支出、轉入算收入）` : `另有 ${d.kinds.transfer} 筆轉帳、${d.kinds.adjust} 筆調整沒有算進去`);
  if (d.missing_rates.length) notes.push(`缺少 ${d.missing_rates.join('、')} 的匯率，這些金額沒有算進去`);
  return h('div', { class: 'tag-page' },
    h('div', { class: 'tally', role: 'status', 'aria-label': `標籤 ${d.tag} 的統計` },
      cell('總支出', money0(d.expense, base), 'neg'),
      d.income ? cell('總收入', money0(d.income, base), 'pos') : null,
      d.income ? cell('淨額', money0(d.net, base), d.net >= 0 ? 'pos' : 'neg') : null,
      cell('期間', d.days ? `${d.days} 天` : '—', '', span),
      d.avg_per_day != null && d.expense ? cell('平均每天', money0(d.avg_per_day, base), '', `有花錢的有 ${d.spent_days} 天`) : null,
      cell('筆數', `${d.entries} 筆`)),
    notes.length ? h('p', { class: 'hint', style: 'margin:0 0 10px' }, notes.join('；') + '。每筆交易的金額都依目前匯率換算。') : null,
    h('div', { class: 'head-btns tag-acts' },
      h('button', { class: 'btn', type: 'button', onclick: () => showTag(d.tag) }, '看這個標籤的全部交易'),
      pinned ? h('button', { class: 'btn', type: 'button', onclick: () => { setPinnedTags(''); toast('已結束自動帶標籤'); renderRoute(); } }, '結束「目前標籤」')
        : h('button', { class: 'btn', type: 'button', onclick: () => { setPinnedTags(d.tag); toast(`之後每一筆都會自動帶上 #${d.tag}（到「交易」頁記帳）`); renderRoute(); } }, '用這個標籤開始記帳'),
      S.st.remote ? null : h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await exported(await api('POST', '/api/export/tag', { tag: d.tag })); } catch (e) { fail(e); }
      } }, '匯出 CSV（給報帳）')),
    h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, d.bucket === 'month' ? '每月支出與累計' : '每日支出與累計',
      h('span', { class: 'seg sm', role: 'group', 'aria-label': '圖的內容', id: 'tag-mode' }, TAG_TREND_MODES.map(([k, l]) => h('button', { type: 'button', 'data-mode': k, 'aria-pressed': String(tagTrendMode() === k),
        onclick: () => { lsSet('pw_tag_trend', k); document.querySelectorAll('#tag-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === k))); const box = document.querySelector('#tag-trend').closest('.chart-box'); drawTagTrend(box, d); } }, l)))),
      h('div', { class: 'chart-wrap tall' }, h('canvas', { id: 'tag-trend', role: 'img', 'aria-label': `標籤 ${d.tag} 的支出趨勢` }))),
    h('div', { class: 'charts', id: 'tag-cats' }));
}

// One scale for the whole chart (the old two-sided version drew the same money on two different axes). Default: the running total only; the bars for each day are one tap away.
const TAG_TREND_MODES = [['cum', '累計'], ['day', '每天'], ['both', '兩者']];
const tagTrendMode = () => { const m = lsGet('pw_tag_trend'); return TAG_TREND_MODES.some(([k]) => k === m) ? m : 'cum'; };
function drawTagTrend(box, d) {
  const base = d.base, mode = tagTrendMode(), cv = $('#tag-trend', box);
  if (box._trend) { box._trend.destroy(); S.charts = S.charts.filter((c) => c !== box._trend); box._trend = null; }
  if (!d.labels.length || typeof Chart === 'undefined') return;
  const short = (l) => (d.bucket === 'month' ? l : l.slice(5));
  const sets = [];
  if (mode !== 'cum') sets.push({ type: 'bar', label: d.bucket === 'month' ? '當月支出' : '當天支出', data: d.daily_expense, backgroundColor: css('--expense'), borderRadius: 3, order: 2 });
  if (mode !== 'day') sets.push({ type: 'line', label: '累計支出', data: d.cumulative_expense, borderColor: css('--brass'), backgroundColor: mode === 'cum' ? css('--brass') + '33' : css('--brass'), fill: mode === 'cum', tension: .2, pointRadius: d.labels.length > 40 ? 0 : 2.5, order: 1 });
  box._trend = mkChart(cv, { data: { labels: d.labels.map(short), datasets: sets },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 14 } }, y: yAxis() },
      plugins: { legend: { display: sets.length > 1 }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}：${num(c.parsed.y, base)} ${base}` } } } } });
}
function drawTagCharts(box, d) {
  const base = d.base;
  drawTagTrend($('#tag-trend', box).closest('.chart-box'), d);
  const roll = (arr) => {                                    // at most 8 slices: the rest becomes 其他
    const head = arr.slice(0, 7), tail = arr.slice(7);
    const items = tail.length > 1 ? [...head, { label: '其他', total: tail.reduce((s, g) => s + g.total, 0), count: tail.reduce((s, g) => s + g.count, 0) }] : arr;
    return { total: arr.reduce((s, g) => s + g.total, 0), groups: items.map((g) => ({ ...g, accounts: [], notes: [] })) };
  };
  drawBreakdown($('#tag-cats', box), { base, income: roll(d.income_by_category), expense: roll(d.expense_by_category) }, 'pie', true);
}
