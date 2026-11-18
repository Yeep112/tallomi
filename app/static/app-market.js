'use strict';
/* Tallomi: 投資 → 「其他股票・ETF」 (every listed / OTC stock and ETF that has no account yet) and the price-curve window
   that opens from any stock, held or not. Loaded with the other pages; uses helpers from app.js and app-invest.js at run time.
   The list is public market data kept by the program (see market.py); prices here are the last close unless the chart says otherwise. */

const MK_RANGES = [['1d', '今日'], ['5d', '五日'], ['1mo', '近月'], ['3mo', '三月'], ['6mo', '六月'], ['1y', '一年'], ['5y', '五年']];
const MK_UP = '#B8322A', MK_DOWN = '#1B7A4B';          // Taiwan: red = up, green = down
const MK_SORTS = [['code', '代號'], ['pct_up', '漲幅大→小'], ['pct_down', '跌幅大→小'], ['volume', '成交量大→小'], ['price', '股價高→低']];
const MK_PAGE = 100;

// a row of /api/market: [code, name, market, kind, close, change, open, high, low, volume]
const mkRow = (a) => ({ code: a[0], name: a[1], market: a[2], kind: a[3], price: a[4], ch: a[5], open: a[6], high: a[7], low: a[8], vol: a[9],
  pct: a[4] != null && a[5] != null && a[4] - a[5] ? a[5] / (a[4] - a[5]) : null });
const mkSigned = (v, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`);
const mkLots = (v) => (v ? numFmt(0, 3).format(Math.round(v / 1000)) : '0');
const mkBadge = (r) => h('span', { class: 'mk-badge' + (r.kind === 'etf' ? ' etf' : '') }, r.kind === 'etf' ? 'ETF' : r.market === 'TPEx' ? '上櫃' : '上市');
const mkDate = (iso) => (iso ? iso.replace(/-/g, '/') : '—');
const mkTP = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function mkWhen(ts, mode) {                         // mode: 'hm' | 'mdhm' | 'md' | 'ym' | 'date' | 'full'
  const p = Object.fromEntries(mkTP.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
  const hm = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  return mode === 'hm' ? hm : mode === 'mdhm' ? `${p.month}/${p.day} ${hm}` : mode === 'md' ? `${p.month}/${p.day}` : mode === 'ym' ? `${p.year}/${p.month}` : mode === 'date' ? `${p.year}/${p.month}/${p.day}` : `${p.year}/${p.month}/${p.day} ${hm}`;
}

async function mkLoad(force) {
  const m = (S.mkt = S.mkt || { rows: [], info: null, at: 0, busy: false });
  if (m.busy) return m;
  m.busy = true;
  try {
    let r = force ? await api('POST', '/api/market/refresh') : await api('GET', '/api/market');
    if (!force && !r.rows.length) r = await api('POST', '/api/market/refresh');           // first use: download the lists
    m.rows = r.rows.map(mkRow); m.info = r.info; m.at = Date.now(); m.error = null;
  } catch (e) { m.error = e.message; } finally { m.busy = false; }
  return m;
}

// ----------------------------------------------------------------------------- the price-curve window
function openStockDetail({ code, name, market, kind }, ctx) {
  const list = ((S.mkt || {}).rows || []);
  const row = list.find((r) => r.code === code) || null;
  const heldPos = ctx && ctx.positions ? ctx.positions().find((p) => p.symbol === code) : null;
  let rng = S.mkRange || '3mo', token = 0, chart = null;
  const head = h('div', { class: 'mk-head' });
  const rangeBar = h('div', { class: 'seg mk-ranges', role: 'group', 'aria-label': '時間範圍' });
  const stats = h('div', { class: 'mk-stats' });
  const wrap = h('div', { class: 'mk-chart' });
  const canvasBox = h('div', { class: 'mk-canvas' });
  const note = h('div', { class: 'hint mk-note' });
  const kindRow = row || { code, name, market: market === 'TPEx' ? 'TPEx' : 'TWSE', kind: kind || (code.startsWith('00') ? 'etf' : 'stock') };

  const paintHead = (hist) => {
    const price = (hist && hist.price) || (row && row.price) || (heldPos && heldPos.price) || null;
    let ch = row ? row.ch : null, pct = row ? row.pct : null;
    if (rng === '1d' && hist && hist.price && hist.prev_close) { ch = hist.price - hist.prev_close; pct = ch / hist.prev_close; }
    const tone = twTone(ch);
    head.replaceChildren(...[
      h('div', { class: 'mk-title' }, h('b', null, name || (row && row.name) || code), h('span', { class: 'hint' }, ` ${code} `), mkBadge(kindRow)),
      h('div', { class: 'mk-price' }, h('span', { class: 'big tw' + tone }, price == null ? '—' : invPrice(price)),
        h('span', { class: 'tw' + tone }, ch == null ? '' : ` ${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${Math.abs(ch).toFixed(2)}（${invPct(pct)}）`)),
      row && row.price != null ? h('div', { class: 'hint' }, `${mkDate((S.mkt.info || {}).trade_date)} 收盤　開 ${invPrice(row.open)}　高 ${invPrice(row.high)}　低 ${invPrice(row.low)}　量 ${mkLots(row.vol)} 張`) : null].filter(Boolean));
  };
  const paintRanges = () => rangeBar.replaceChildren(...MK_RANGES.map(([k, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(k === rng), onclick: () => { rng = S.mkRange = k; paintRanges(); load(); } }, label)));

  async function load() {
    const my = ++token;
    if (chart) { chart.destroy(); chart = null; }
    canvasBox.replaceChildren(h('div', { class: 'empty' }, '正在讀取走勢…'));
    stats.replaceChildren(); note.textContent = '';
    let hist;
    try { hist = await api('GET', `/api/market/history?symbol=${encodeURIComponent(code)}&range=${rng}`); }
    catch (e) {
      if (my !== token) return;
      canvasBox.replaceChildren(h('div', { class: 'empty' }, h('b', null, '讀不到走勢資料'), e.message, h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: () => load() }, '重試'))));
      return;
    }
    if (my !== token || !canvasBox.isConnected) return;
    paintHead(hist);
    const pts = hist.points, up = hist.last >= hist.first, col = up ? MK_UP : MK_DOWN;
    const cv = h('canvas', { role: 'img', 'aria-label': `${name || code} 走勢圖` });
    canvasBox.replaceChildren(cv);
    const labels = pts.map((p) => mkWhen(p[0], rng === '1d' ? 'hm' : rng === '5d' ? 'mdhm' : rng === '5y' || rng === '1y' ? 'ym' : 'md'));
    const sets = [{ data: pts.map((p) => p[1]), borderColor: col, backgroundColor: col + '22', fill: true, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.6, tension: 0.08 }];
    if (rng === '1d' && hist.prev_close) sets.push({ data: pts.map(() => hist.prev_close), borderColor: '#8A8F98', borderDash: [5, 4], borderWidth: 1, pointRadius: 0, fill: false });
    chartDefaults();
    chart = new Chart(cv, { type: 'line', data: { labels, datasets: sets }, options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { filter: (it) => it.datasetIndex === 0, callbacks: { title: (it) => mkWhen(pts[it[0].dataIndex][0], rng === '1d' || rng === '5d' ? 'full' : 'date'), label: (c) => ` ${invPrice(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: window.innerWidth < 500 ? 4 : 6, maxRotation: 0, autoSkipPadding: 16 } }, y: { position: 'right', grace: '6%', ticks: { callback: (v) => invPrice(v) } } } } });
    stats.replaceChildren(
      h('span', null, '區間漲跌 ', h('b', { class: 'tw' + twTone(hist.change) }, `${mkSigned(hist.change)}（${invPct(hist.pct)}）`)),
      h('span', null, `最高 ${invPrice(hist.high)}`), h('span', null, `最低 ${invPrice(hist.low)}`),
      h('span', { class: 'hint' }, `資料：${hist.source === 'twse' ? '證交所（日收盤價）' : 'Yahoo 財經（約延遲 15–20 分鐘）'}`));
    if (hist.stale) note.replaceChildren(h('span', { class: 'ex-warn' }, `目前讀不到最新資料（${hist.stale_reason || '連不上網路'}），顯示的是 ${hist.fetched_at ? hist.fetched_at.slice(0, 16).replace('T', ' ').replace(/-/g, '/') : '上次'} 抓取的走勢。`));
    else note.textContent = rng === '1d' ? '今日走勢：虛線是昨天的收盤價。非交易時間顯示最近一個交易日。' : rng === '5y' ? '五年走勢以每週收盤價繪製。' : '';
  }

  const foot = [];
  if (heldPos) foot.push(h('span', { class: 'hint' }, `已建立帳戶「${heldPos.account}」`));
  else if (ctx && ctx.create) foot.push(h('button', { class: 'btn primary', type: 'button', onclick: () => { dlg.close(); mkCreateAccount(kindRow, ctx); } }, '建立帳戶'));
  const dlg = openDialog({ title: `${name || code}　走勢`, wide: true, extraFoot: foot.length ? h('div', { class: 'row-inline', style: 'margin-right:auto' }, ...foot) : null,
    body: h('div', { class: 'mk-detail' }, head, rangeBar, wrap) });
  wrap.append(canvasBox, stats, note);
  dlg.addEventListener('close', () => { token++; if (chart) { chart.destroy(); chart = null; } });
  paintHead(null); paintRanges(); load();
}

// ----------------------------------------------------------------------------- create an account for a stock
function mkCreateAccount(r, ctx) {
  const nm = h('input', { value: r.code, maxlength: 60, autocomplete: 'off', 'aria-label': '帳戶名稱' });
  openDialog({ title: `建立投資帳戶：${r.name || r.code}`, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('p', { class: 'hint' }, `${r.code} ${r.name || ''}（${r.kind === 'etf' ? 'ETF' : r.market === 'TPEx' ? '上櫃股票' : '上市股票'}）會有自己的帳戶，幣別 TWD，起始金額 0。建好後到「我的持股」買進，就會用你選的帳戶付款。`),
    h('label', { class: 'field' }, h('span', null, '帳戶名稱'), nm)),
  primary: { label: '建立帳戶', run: async () => {
    await api('POST', '/api/invest/securities', { symbol: r.code, name: r.name, market: 'TW', account_name: nm.value.trim() || r.code });
    S.invTab = 'mine'; toast(`已建立「${nm.value.trim() || r.code}」帳戶，可以到「我的持股」買進`);
    watchSync(); await refresh();
  } } });
}

// ----------------------------------------------------------------------------- the tab
function buildMarketTab(box, ctx) {
  const st = (S.mkF = S.mkF || { q: '', kind: 'all', mkt: 'all', sort: 'code', held: false, shown: MK_PAGE });
  const statusBox = h('div', { class: 'mk-status' });
  const body = h('div');
  const search = h('input', { type: 'search', value: st.q, placeholder: '搜尋代號或名稱，例如 2330、台積、高股息', autocomplete: 'off', 'aria-label': '搜尋股票或 ETF',
    oninput: (e) => { st.q = e.target.value; st.shown = MK_PAGE; paintBody(); } });
  const seg = (key, items) => h('div', { class: 'seg', role: 'group' }, items.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(st[key] === v),
    onclick: () => { st[key] = v; st.shown = MK_PAGE; paintBar(); paintBody(); } }, label)));
  const bar = h('div', { class: 'mk-bar' });
  const paintBar = () => bar.replaceChildren(
    h('label', { class: 'mk-search' }, search),
    h('div', { class: 'mk-filters' }, seg('kind', [['all', '全部'], ['stock', '股票'], ['etf', 'ETF']]), seg('mkt', [['all', '上市＋上櫃'], ['TWSE', '上市'], ['TPEx', '上櫃']]),
      h('label', { class: 'mk-sort' }, h('span', { class: 'hint' }, '排序'), h('select', { 'aria-label': '排序', onchange: (e) => { st.sort = e.target.value; paintBody(); } },
        MK_SORTS.map(([v, label]) => h('option', { value: v, selected: v === st.sort }, label)))),
      h('label', { class: 'row-inline hint' }, h('input', { type: 'checkbox', checked: st.held, onchange: (e) => { st.held = e.target.checked; st.shown = MK_PAGE; paintBody(); } }, null), '也列出已建立帳戶的')));

  const paintStatus = () => {
    const m = S.mkt || {}, i = m.info || {};
    const kids = [];
    if (m.busy) kids.push(h('span', { class: 'hint' }, '正在下載全部上市櫃股票與 ETF…（第一次約需數秒）'));
    else if (m.error) kids.push(h('span', { class: 'ex-warn' }, `清單讀取失敗：${m.error}`));
    else {
      kids.push(h('span', { class: 'hint' }, `資料日期 ${mkDate(i.trade_date)}（最近一個交易日的收盤）　股票 ${i.stocks || 0} 檔・ETF ${i.etfs || 0} 檔　`
        + (i.updated_at ? `上次更新 ${i.updated_at.slice(5, 16).replace('T', ' ')}` : '')));
      if (i.state === 'offline') kids.push(h('span', { class: 'hint inv-bad' }, `目前連不上網路（${i.error || ''}），先顯示上次的清單；連線後會自動更新。`));
      else if (i.error) kids.push(h('span', { class: 'hint inv-bad' }, `更新失敗：${i.error}`));
      else if (i.warn) kids.push(h('span', { class: 'hint inv-bad' }, `部分更新失敗（${i.warn}），先保留舊資料。`));
    }
    kids.push(h('button', { class: 'btn sm', type: 'button', disabled: !!m.busy, onclick: async () => { await refreshList(true); } }, m.busy ? '更新中…' : '立即更新清單'));
    kids.push(h('span', { class: 'hint' }, '清單每個交易日收盤後（約 14:30）自動更新；要看盤中最新價請點進個股看走勢。'));
    statusBox.replaceChildren(...kids);
  };

  const filtered = () => {
    const m = S.mkt || { rows: [] }, held = new Set(ctx.positions().map((p) => p.symbol));
    const q = st.q.trim().toLowerCase();
    let rows = m.rows.filter((r) => (st.held || !held.has(r.code)) && (st.kind === 'all' || r.kind === st.kind) && (st.mkt === 'all' || r.market === st.mkt)
      && (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
    const by = { code: (a, b) => (a.code < b.code ? -1 : 1), pct_up: (a, b) => (b.pct ?? -9) - (a.pct ?? -9), pct_down: (a, b) => (a.pct ?? 9) - (b.pct ?? 9),
      volume: (a, b) => b.vol - a.vol, price: (a, b) => (b.price ?? -1) - (a.price ?? -1) }[st.sort];
    rows = rows.slice().sort(by);
    return { rows, held, hiddenHeld: m.rows.filter((r) => held.has(r.code)).length };
  };

  function paintBody() {
    const m = S.mkt || { rows: [] };
    if (!m.rows.length) { body.replaceChildren(h('div', { class: 'empty' }, m.busy ? '正在下載清單…' : h('b', null, '還沒有股票清單'), m.busy ? '' : '請確認電腦有連上網路，再按上面的「立即更新清單」。')); paintStatus(); return; }
    const { rows, hiddenHeld } = filtered(), shown = rows.slice(0, st.shown);
    const tr = (r) => {
      const tone = twTone(r.ch);
      return h('tr', { class: 'click', onclick: (e) => { if (!e.target.closest('button')) openStockDetail(r, ctx); } },
        h('td', { class: 'name' }, h('div', null, r.name || r.code, ' ', mkBadge(r)), h('div', { class: 'hint' }, r.code)),
        h('td', { class: 'r', 'data-label': '收盤價' }, h('span', { class: 'num tw' + tone }, r.price == null ? '—' : invPrice(r.price))),
        h('td', { class: 'r', 'data-label': '漲跌' }, h('span', { class: 'num tw' + tone }, r.ch == null ? '—' : `${r.ch > 0 ? '▲' : r.ch < 0 ? '▼' : ''} ${Math.abs(r.ch).toFixed(2)}`)),
        h('td', { class: 'r', 'data-label': '漲跌幅' }, h('span', { class: 'num tw' + tone }, invPct(r.pct))),
        h('td', { class: 'r', 'data-label': '成交量（張）' }, mkLots(r.vol)),
        h('td', { class: 'act' }, h('button', { class: 'btn sm', type: 'button', onclick: () => openStockDetail(r, ctx) }, '走勢'),
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => mkCreateAccount(r, ctx) }, '建立帳戶')));
    };
    body.replaceChildren(
      h('div', { class: 'hint mk-count' }, `共 ${rows.length} 檔${hiddenHeld && !st.held ? `（另有 ${hiddenHeld} 檔已建立帳戶，在「我的持股」）` : ''}`),
      rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'ledger stack mk-table' },
        h('thead', null, h('tr', null, h('th', null, '股票 / ETF'), h('th', { class: 'r' }, '收盤價'), h('th', { class: 'r' }, '漲跌'), h('th', { class: 'r' }, '漲跌幅'), h('th', { class: 'r' }, '成交量（張）'), h('th', null, ''))),
        h('tbody', null, shown.map(tr))))
        : h('div', { class: 'empty' }, h('b', null, '沒有符合的股票'), '換個關鍵字，或把上面的篩選改成「全部」。'),
      rows.length > shown.length ? h('div', { class: 'mk-more' }, h('button', { class: 'btn', type: 'button', onclick: () => { st.shown += MK_PAGE; paintBody(); } }, `顯示更多（還有 ${rows.length - shown.length} 檔）`)) : null);
    paintStatus();
  }

  async function refreshList(force) {
    const p = mkLoad(force);          // starts at once; an update that is already running is simply shown
    paintStatus(); paintBody();
    await p; paintStatus(); paintBody();
  }

  box.replaceChildren(h('p', { class: 'sub mk-sub' }, '還沒有建立帳戶的上市、上櫃股票與 ETF。找到想追蹤的，先看走勢圖；決定要買再「建立帳戶」，它就會出現在「我的持股」。'), bar, statusBox, body);
  paintBar(); paintStatus(); paintBody();
  const m = S.mkt;
  if (!m || !m.rows.length || Date.now() - m.at > 5 * 60 * 1000) refreshList(false);
}
