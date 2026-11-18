'use strict';
/* Tallomi: 投資 page. Loaded before app.js; uses its helpers (h, api, S, num, money, ...) when it runs.
   Profit and loss shown here are ESTIMATES: the books only count the cost until the shares are sold back to a bank account. */

const invCount = (v) => (isHidden() ? HIDDEN : numFmt(0, 6).format(v));
const invPct = (v) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`);
const invPrice = (v) => (v == null ? '—' : numFmt(2, 4).format(v));
// Taiwan's habit: red = up / gain, green = down / loss (the same colours as the broker's app).
const twTone = (v) => (v > 0 ? ' tw-up' : v < 0 ? ' tw-down' : '');
const SRC_NAME = { broker: '券商畫面', twse: '證交所', yahoo: 'Yahoo', stooq: 'Stooq', sinotrade: '永豐', manual: '手動輸入', web: '網路' };
const invFloor = (x) => Math.floor(x + 1e-9);
// An amount with its percentage under it, both in the gain / loss colour. Used for 今日漲跌 and 累計報酬 on every holding.
function invMove(amount, pct, ccy, tip) {
  if (amount == null) return '—';
  const tone = twTone(amount);
  return h('div', { class: 'inv-pair', title: tip || null }, h('span', { class: 'num tw' + tone }, num(amount, ccy, true)), h('span', { class: 'hint tw' + tone }, invPct(pct)));
}

// Is a market open now (local time)? Used only to decide how often to refresh the prices while the page is open.
function invMarketOpen(market) {
  const d = new Date(), day = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
  if (market === 'TW') return day >= 1 && day <= 5 && m >= 8 * 60 + 55 && m <= 13 * 60 + 35;
  return (m >= 21 * 60 + 25 && day >= 1 && day <= 5) || (m <= 5 * 60 + 5 && day >= 2 && day <= 6);      // US regular session, Taipei time (roughly)
}

async function invFetch(force) {
  if (S.invFetching) return;
  S.invFetching = true; S.invPaintStatus && S.invPaintStatus();
  try {
    const r = await api('POST', '/api/invest/fetch', { force: !!force });
    if (!r.throttled) S.invResult = { at: Date.now(), ...r, error: null };
  } catch (e) { S.invResult = { at: Date.now(), applied: [], pending: [], failed: [], error: e.message }; }
  finally { S.invFetching = false; S.invLastFetch = Date.now(); }
  if (currentRoute() === 'invest' && S.invRepaint) await S.invRepaint();
}

async function invWatch() {
  if (S.invWatching) return;
  S.invWatching = true;
  try {
    while (currentRoute() === 'invest') {
      const b = S.invBoard, open = b && b.positions.some((p) => invMarketOpen(p.market));
      const every = open ? 60000 : 600000;
      if (!S.invFetching && (!S.invLastFetch || Date.now() - S.invLastFetch >= every) && document.visibilityState === 'visible') await invFetch(false);
      // a background (twice a day) update may have finished: it is already in the table, the form only changes after the person says yes
      if (!S.invAutoAt || Date.now() - S.invAutoAt >= 20000) {
        const prev = S.invAuto || {};
        S.invAuto = await api('GET', '/api/invest/auto'); S.invAutoAt = Date.now();
        if (S.invAuto.last_ok !== prev.last_ok && S.invRepaint && currentRoute() === 'invest') await S.invRepaint();
        else if (S.invPaintStatus && prev.state !== S.invAuto.state) S.invPaintStatus();
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch { /* server closed */ } finally { S.invWatching = false; }
}

async function viewInvest(view) {
  const base = S.st.base;
  const inv = (S.inv = S.inv || { f: { side: 'buy', acct: null, unit: 'lot', qty: '', price: '', priceTouched: false, fee: '', feeTouched: false, tax: '', taxTouched: false,
    pay: null, acctAmt: '', acctTouched: false, payAmt: '', payTouched: false, time: '', note: '' }, open: {} });
  inv.gap = inv.gap || {};
  const f = inv.f;
  let board = (S.invBoard = await api('GET', '/api/invest'));
  S.invAuto = await api('GET', '/api/invest/auto'); S.invAutoAt = Date.now();
  const rates = rateTable();
  const posOf = (id) => board.positions.find((p) => p.account_id == id);
  if (!posOf(f.acct)) { f.acct = (board.positions.find((p) => p.shares > 0) || board.positions[0] || {}).account_id || null; }
  const payList = () => board.accounts;
  if (f.pay !== '' && !payList().some((a) => a.id == f.pay)) {
    const d = payList().find((a) => /^sinopac/i.test(a.name)) || payList()[0];
    f.pay = d ? d.id : '';
  }

  // ---------------------------------------------------------------- summary + positions
  const top = h('div');
  const statusBox = h('div', { class: 'inv-status' });
  const money0 = (v) => num(v, base);
  const paintStatus = () => {
    if (!statusBox.isConnected) return;
    const r = S.invResult, kids = [];
    if (S.invFetching) kids.push(h('span', { class: 'hint' }, '正在更新股價…'));
    else if (r && r.error) kids.push(h('span', { class: 'ex-warn' }, `更新股價失敗：${r.error}`));
    else if (r) {
      const t = new Date(r.at).toLocaleTimeString('zh-TW', { hour12: false });
      kids.push(h('span', { class: 'hint' }, `${t} 已更新股價`));
      (r.failed || []).forEach((x) => kids.push(h('span', { class: 'hint inv-bad' }, `${(board.positions.find((p) => p.symbol === x.symbol) || {}).account || x.symbol}：${x.error}，請在下面直接輸入股價`)));
    } else kids.push(h('span', { class: 'hint' }, '尚未更新股價'));
    kids.push(h('button', { class: 'btn sm', type: 'button', disabled: !!S.invFetching, onclick: () => invFetch(true) }, S.invFetching ? '更新中…' : '立即更新股價'));
    const a = S.invAuto || {};
    const note = !a.enabled ? '每日自動更新已關閉。'
      : a.done_today ? `今天已自動更新 ${a.done_count}/${a.per_day || 2} 次，這個時段已完成。`
      : a.state === 'offline' ? '目前連不上網路，連線後會自動再試。'
      : a.state === 'error' ? '自動更新沒有成功，會稍後再試。'
      : (a.symbols || []).length ? '這個時段還沒自動更新（每天上午、台股收盤後各一次）。' : '';
    kids.push(h('span', { class: 'hint' }, [a.last_ok ? `上次自動更新 ${a.last_ok.slice(5, 16).replace('T', ' ')}` : '', note].filter(Boolean).join('　')));
    kids.push(h('label', { class: 'row-inline hint' }, h('input', { type: 'checkbox', checked: !!a.enabled, onchange: async (e) => {
      try { S.invAuto = await api('PUT', '/api/invest/auto', { enabled: e.target.checked }); } catch (err) { fail(err); e.target.checked = !e.target.checked; }
      paintStatus();
    } }), '每天自動更新股價 2 次（有網路、程式開著時）'));
    statusBox.replaceChildren(...kids);
  };
  S.invPaintStatus = paintStatus;

  const priceCell = (p) => {
    const input = h('input', { class: 'inv-price', inputmode: 'decimal', autocomplete: 'off', value: p.price == null ? '' : String(p.price), placeholder: '輸入股價',
      'aria-label': `${p.name || p.symbol} 現價`,
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onchange: async (e) => {
        const v = e.target.value.trim();
        if (!v || parseNum(v) === p.price) return;
        try { await api('PUT', '/api/invest/price', { symbol: p.symbol, price: v, source: 'manual' }); S.invLastFetch = Date.now(); await repaint(); toast(`已把 ${p.name || p.symbol} 的現價改成 ${v}`); }
        catch (err) { fail(err); e.target.value = p.price == null ? '' : String(p.price); }
      } });
    const pend = ((S.invResult || {}).pending || []).find((x) => x.symbol === p.symbol && x.price !== p.price);
    const age = p.price_at ? shortTime(p.price_at).slice(5) : '';
    return h('div', { class: 'inv-pricebox' }, input,
      h('div', { class: 'hint' }, p.price == null ? '' : `${SRC_NAME[p.price_source] || p.price_source}${age ? ' ' + age : ''}`),
      pend ? h('div', { class: 'hint' }, `${SRC_NAME[pend.source] || '網路'}價 ${invPrice(pend.price)} `,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await api('PUT', '/api/invest/price', { symbol: p.symbol, price: String(pend.price), source: 'web' }); S.invResult.pending = S.invResult.pending.filter((x) => x !== pend); await repaint(); } catch (err) { fail(err); } } }, '改用')) : null);
  };

  // On a phone these four buttons are small icons (the rows can also be tapped and swiped); on a computer they keep their words.
  const actBtn = (cls, icon, label, fn, off, expanded) => h('button', { class: `btn sm ${cls}`.trim(), type: 'button', disabled: !!off, 'aria-label': label, title: label, 'aria-expanded': expanded == null ? null : expanded, onclick: fn },
    h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'tx' }, label));
  const paintTop = () => {
    const t = board.totals, held = board.positions.filter((p) => p.shares > 0 || p.realized !== 0);
    const gain = t.pnl;
    const kids = [];
    kids.push(h('div', { class: 'worth' },
      h('div', null, h('div', { class: 'label' }, `庫存市值（${base}，預估）`), h('div', { class: 'big' }, money0(t.value), h('small', null, base))),
      h('div', { class: 'month' },
        h('div', null, h('span', { class: 'label muted' }, '付出成本'), h('b', null, money0(t.cost))),
        h('div', null, h('span', { class: 'label muted' }, '損益試算'), h('b', { class: 'tw' + twTone(gain) }, num(gain, base, true))),
        h('div', null, h('span', { class: 'label muted' }, '報酬率'), h('b', { class: 'tw' + twTone(gain) }, invPct(t.ret))),
        h('div', null, h('span', { class: 'label muted' }, '已實現損益'), h('b', { class: 'tw' + twTone(t.realized) }, num(t.realized, base, true)))),
      h('div', { class: 'month inv-moves' },
        h('div', { title: t.day_count ? '用現價和前一個交易日的收盤價相比，只算現在還持有的股數' : '還沒有可以比較的前日收盤價（更新股價後就會出現）' },
          h('span', { class: 'label muted' }, '今日漲跌'), t.day_count ? invMove(t.day_pnl, t.day_ret, base) : h('b', { class: 'muted' }, '—')),
        h('div', { title: '累計損益 ＝ 持股的損益試算 ＋ 已實現損益；累計報酬率 ＝ 累計損益 ÷（持股成本 ＋ 已賣出股數的成本）' },
          h('span', { class: 'label muted' }, '累計報酬（含已實現）'), t.total_ret == null && !t.total_pnl ? h('b', { class: 'muted' }, '—') : invMove(t.total_pnl, t.total_ret, base)))));
    kids.push(h('p', { class: 'hint inv-note' }, `損益試算是用現價推算的預估值，帳戶餘額與總資產只算「付出成本」。賣出、把錢轉回銀行帳戶之後，實際賺賠才會列入實際資產（已實現損益）。紅色代表賺、綠色代表賠。`,
      '　庫存市值與損益已扣掉預估的賣出手續費和證交稅，數字和券商 App 一致。'));
    if (t.missing_prices) kids.push(h('div', { class: 'banner' }, h('span', null, `有 ${t.missing_prices} 檔還沒有股價（或缺少換算匯率），沒有算進市值。請在下表輸入現價，或到設定頁填匯率。`)));
    const posRows = (p) => {
      const open = !!inv.open[p.account_id];
      const gap = Math.abs(p.balance_gap) >= 0.005;
      const tr = h('tr', { class: (p.shares > 0 ? '' : 'archived') + ' tap2', title: '點一下買進或賣出；點兩下看走勢；手機向右滑買進、向左滑賣出', ...rowTapDouble(() => pick('buy', p), () => trend(p)) },
        h('td', { class: 'name' }, h('div', null, p.name || p.symbol), h('div', { class: 'hint' }, `${p.symbol}　帳戶 ${p.account}${p.currency !== p.quote_currency ? `（${p.currency}，股價 ${p.quote_currency}）` : ''}`)),
        h('td', { class: 'r' }, invCount(p.shares), p.shares >= 1000 && p.market === 'TW' ? h('div', { class: 'hint' }, isHidden() ? '' : `${+(p.shares / 1000).toFixed(3)} 張`) : null),
        h('td', { class: 'r' }, p.shares > 0 ? money(p.cost, p.currency, { tag: false }) : '—', p.avg_cost ? h('div', { class: 'hint' }, isHidden() ? '' : `均價 ${invPrice(p.avg_cost)}`) : null),
        h('td', { class: 'r' }, priceCell(p)),
        h('td', { class: 'r c-day' }, p.shares > 0 ? invMove(p.day_change, p.day_pct, p.currency, '用現價和前一個交易日的收盤價相比') : '—'),
        h('td', { class: 'r' }, p.shares > 0 ? (p.value == null ? '—' : money(p.value, p.currency, { tag: false })) : '—'),
        h('td', { class: 'r' }, p.shares > 0 && p.pnl != null ? h('span', { class: 'num tw' + twTone(p.pnl) }, num(p.pnl, p.currency, true)) : '—'),
        h('td', { class: 'r' }, p.shares > 0 && p.ret != null ? h('span', { class: 'num tw' + twTone(p.pnl) }, invPct(p.ret)) : '—'),
        h('td', { class: 'r c-total' }, invMove(p.total_pnl, p.total_ret, p.currency, '累計損益 ＝ 損益試算 ＋ 已實現損益；報酬率 ＝ 累計損益 ÷（持股成本 ＋ 已賣出股數的成本）')),
        h('td', { class: 'act inv-act' },
          p.market === 'TW' ? actBtn('ghost', '📈', '走勢', () => openStockDetail({ code: p.symbol, name: p.name, market: 'TWSE' }, mineCtx)) : null,
          actBtn('', '＋', '買進', () => pick('buy', p)),
          actBtn('', '－', '賣出', () => pick('sell', p), p.shares <= 0),
          p.lots.length ? actBtn('ghost', open ? '▴' : '▾', open ? '收合' : '明細', () => { inv.open[p.account_id] = !open; paintTop(); }, false, String(open)) : null));
      swipeTrade(tr, p);
      const extra = [];
      if (open) extra.push(h('tr', { class: 'inv-lots' }, h('td', { colspan: 10 },
        h('table', { class: 'ledger stack inv-lot-table' },
          h('thead', null, h('tr', null, ['買進時間', '股數', '買進價', '成本', '市值', '損益試算', '報酬率'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
          h('tbody', null, p.lots.map((l) => h('tr', { class: 'tx-row', tabindex: '0', title: '點一下編輯這筆買進', ...rowTap(() => { const tr0 = board.trades.find((x) => x.id === l.trade_id); if (tr0) editTrade(tr0); }) }, h('td', { class: 'when' }, shortTime(l.time)), h('td', { class: 'r', 'data-label': '股數' }, invCount(l.shares)), h('td', { class: 'r', 'data-label': '買進價' }, invPrice(l.price)),
            h('td', { class: 'r', 'data-label': '成本' }, money(l.cost, p.currency, { tag: false })), h('td', { class: 'r', 'data-label': '市值' }, l.value == null ? '—' : money(l.value, p.currency, { tag: false })),
            h('td', { class: 'r', 'data-label': '損益試算' }, l.pnl == null ? '—' : h('span', { class: 'num tw' + twTone(l.pnl) }, num(l.pnl, p.currency, true))),
            h('td', { class: 'r', 'data-label': '報酬率' }, l.ret == null ? '—' : h('span', { class: 'tw' + twTone(l.pnl) }, invPct(l.ret))))))),
        h('p', { class: 'hint' }, p.gross_value != null && p.shares > 0 ? `未扣費用的市價總值 ${num(p.gross_value, p.currency)} ${p.currency}。` : '', `已實現損益 ${num(p.realized, p.currency, true)} ${p.currency}。`, p.total_pnl != null ? `累計損益（含已實現）${num(p.total_pnl, p.currency, true)} ${p.currency}。` : ''))));
      const hasGap = gap && (p.shares > 0 || p.balance !== 0);
      if (hasGap) tr.querySelector('td.name > div').append(h('button', { class: 'gap-dot' + (inv.gap[p.account_id] ? ' on' : ''), type: 'button', 'aria-label': '帳戶餘額與持股成本不一致，點一下看說明', title: '帳戶餘額與持股成本不一致',
        onclick: () => { inv.gap[p.account_id] = !inv.gap[p.account_id]; paintTop(); } }, '⚠'));
      if (hasGap && inv.gap[p.account_id]) extra.push(h('tr', null, h('td', { colspan: 10, class: 'hint inv-gap' },
        `「${p.account}」帳戶餘額 ${num(p.balance, p.currency)} 與持股成本 ${num(p.cost, p.currency)} 差 ${num(p.balance_gap, p.currency, true)} ${p.currency}：` +
        (p.balance_gap < 0 ? '帳戶裡的錢比持股成本少，可能是原本的持股沒有透過買進紀錄登錄金額。' : '帳戶餘額比持股成本多，可能有尚未登錄的買進紀錄。') + '實際資產以帳戶餘額為準。')));
      return [tr, ...extra];
    };
    // Stocks with no shares left (nothing but dashes) sit in one folded line; a stock that was just added to buy is one tap away.
    const live = board.positions.filter((p) => p.shares > 0), cleared = board.positions.filter((p) => !(p.shares > 0));
    const rows = live.flatMap(posRows);
    if (cleared.length) {
      const openE = !!inv.showCleared || !live.length;
      rows.push(h('tr', { class: 'inv-cleared-head' }, h('td', { colspan: 10 }, h('button', { class: 'btn sm ghost', type: 'button', 'aria-expanded': String(openE),
        onclick: () => { inv.showCleared = !openE; paintTop(); } }, `${openE ? '▾' : '▸'} 已清空的標的（${cleared.length}）：${cleared.map((p) => p.name || p.symbol).join('、')}`))));
      if (openE) rows.push(...cleared.flatMap(posRows));
    }
    kids.push(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, '庫存'), h('div', { class: 'row-inline' }, statusBox,
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => openTrade() }, '買進／賣出'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => manageDialog() }, '管理股票'))),
      board.positions.length
        ? h('div', { class: 'tablewrap' }, h('table', { class: 'ledger inv-table' },
          h('thead', null, h('tr', null, h('th', null, '股票'), h('th', { class: 'r' }, '庫存股數'), h('th', { class: 'r' }, '付出成本'), h('th', { class: 'r' }, '現價'), h('th', { class: 'r' }, '今日漲跌'),
            h('th', { class: 'r' }, '庫存市值'), h('th', { class: 'r' }, '損益試算'), h('th', { class: 'r' }, '報酬率'), h('th', { class: 'r' }, '累計報酬'), h('th', null, ''))),
          h('tbody', null, rows)))
        : h('div', { class: 'empty' }, h('b', null, '還沒有投資標的'), '按「管理股票」新增，或把帳戶命名成 TSMC、0050、0056、UMC、NVDA 會自動辨識。'),
      held.length ? null : h('p', { class: 'hint' }, '還沒有持股：在下面「買進」登錄，或選「不扣款」登錄原本就持有的股票。')));
    top.replaceChildren(...kids);
    paintStatus();
  };

  // ---------------------------------------------------------------- the buy / sell form
  const formBox = h('div', { class: 'inv-card', role: 'group', 'aria-label': '買賣股票', id: 'inv-form' });
  let tradeDlg = null;
  const info = h('div', { class: 'ex-info', 'aria-live': 'polite' });
  const ask = h('div', { class: 'ex-ask', role: 'status', 'aria-live': 'polite' });
  // The table always gets the newest official price; the form only changes after the person says yes.
  const OFFICIAL = ['twse', 'yahoo', 'stooq', 'sinotrade', 'web'];
  const paintAsk = () => {
    const p = posOf(f.acct), key = p ? `${p.symbol}:${p.price}` : '';
    const cur = parseNum(f.price);
    if (inv.editId || !p || p.price == null || !OFFICIAL.includes(p.price_source) || f.askDismissed === key || cur === p.price) return ask.replaceChildren();
    ask.replaceChildren(h('div', null, `${SRC_NAME[p.price_source] || '官網'}有新的股價 `, h('b', null, invPrice(p.price)),
      `（${p.price_at ? shortTime(p.price_at).slice(5) : ''} 讀取），表單的成交價目前是 ${f.price.trim() ? invPrice(cur) : '空白'}。要套用到表單嗎？`),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => { f.price = String(p.price); f.priceTouched = false; f.acctTouched = f.payTouched = false; f.askDismissed = null; paintForm(); } }, '套用'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { f.askDismissed = key; paintAsk(); } }, '先不要')));
  };
  const calc = () => {
    const p = posOf(f.acct);
    if (!p) return null;
    const sell = f.side === 'sell';
    const qty = parseNum(f.qty);
    const shares = p.market === 'TW' && f.unit === 'lot' ? qty * 1000 : qty;
    const price = parseNum(f.price);
    const gross = shares * price;
    const r = p.rules;
    const odd = shares < 1000;
    const ok = gross > 0;
    const autoFee = !ok ? '' : r.fee_rate ? Math.max(invFloor(gross * r.fee_rate), odd ? r.min_fee_odd : r.min_fee_lot) : 0;
    const autoTax = !ok || !sell ? '' : invFloor(gross * r.tax_rate);
    const fee = f.feeTouched ? (parseNum(f.fee) || 0) : (autoFee || 0);
    const tax = sell ? (f.taxTouched ? (parseNum(f.tax) || 0) : (autoTax || 0)) : 0;
    const totalQ = sell ? gross - fee - tax : gross + fee;
    const fxA = p.quote_currency === p.currency ? 1 : (rates[p.quote_currency] && rates[p.currency] ? rates[p.quote_currency] / rates[p.currency] : null);
    const acctAuto = fxA == null || !(totalQ > 0) ? '' : String(roundTo(totalQ * fxA, digits(p.currency)));
    const acctAmt = f.acctTouched ? parseNum(f.acctAmt) : parseNum(acctAuto);
    const pa = payList().find((a) => a.id == f.pay) || null;
    const fxP = !pa ? 1 : pa.currency === p.currency ? 1 : (rates[p.currency] && rates[pa.currency] ? rates[p.currency] / rates[pa.currency] : null);
    const payAuto = !pa || fxP == null || !(acctAmt > 0) ? '' : String(roundTo(acctAmt * fxP, digits(pa.currency)));
    const payAmt = f.payTouched ? parseNum(f.payAmt) : parseNum(payAuto);
    return { p, sell, shares, price, gross, fee, tax, autoFee, autoTax, totalQ, acctAuto, acctAmt, pa, payAuto, payAmt, qccy: p.quote_currency };
  };
  const costOf = (p, n) => { let need = n, c = 0; for (const l of p.lots) { if (need <= 0) break; const t = Math.min(l.shares, need); c += l.cost * t / l.shares; need -= t; } return { cost: c, short: need > 0.0000001 }; };

  function sync() {
    paintAsk();
    const c = calc();
    if (!c) return;
    const set = (key, el, auto, touchedKey) => { if (el && !f[touchedKey]) { f[key] = auto === '' ? '' : String(auto); if (document.activeElement !== el) el.value = f[key]; } };
    set('fee', formBox.querySelector('[name=fee]'), c.autoFee, 'feeTouched');
    set('tax', formBox.querySelector('[name=tax]'), c.autoTax, 'taxTouched');
    set('acctAmt', formBox.querySelector('[name=acct_amount]'), c.acctAuto, 'acctTouched');
    const c2 = calc();
    set('payAmt', formBox.querySelector('[name=pay_amount]'), c2.payAuto, 'payTouched');
    const msgs = [];
    if (c.p.market === 'TW' && f.unit === 'odd' && c.shares >= 1000) msgs.push('零股一次最多 999 股；1000 股以上請改選「整張」。');
    if (c.shares > 0 && c.price > 0) {
      const s = c.sell ? '實收' : '總付出';
      msgs.push(h('div', { class: 'inv-sum' }, `成交金額 ${num(c.gross, c.qccy)} ＋ 手續費 ${num(c.fee, c.qccy)}${c.sell ? ` ＋ 證交稅 ${num(c.tax, c.qccy)}` : ''} → ${s} ${num(c.totalQ, c.qccy)} ${c.qccy}`));
    }
    if (c.sell && c.shares > 0) {
      if (!inv.editId && c.shares > c.p.shares + 1e-9) msgs.push(h('div', { class: 'ex-warn' }, `「${c.p.name || c.p.symbol}」目前只有 ${invCount(c.p.shares)} 股，賣不了 ${invCount(c.shares)} 股。`));
      else if (c.acctAmt > 0 && !inv.editId) {
        const r = costOf(c.p, c.shares);
        const pl = c.acctAmt - r.cost;
        msgs.push(h('div', { class: 'inv-sum' }, `賣出這 ${invCount(c.shares)} 股的成本約 ${num(r.cost, c.p.currency)}，實收 ${num(c.acctAmt, c.p.currency)}，實現損益約 `, h('b', { class: 'tw' + twTone(pl) }, `${num(pl, c.p.currency, true)} ${c.p.currency}`), '（先買進的先賣）。'));
      }
    }
    if (!c.sell && c.pa && c.payAmt > 0 && c.pa.balance < c.payAmt) msgs.push(h('div', { class: 'ex-warn' }, `「${c.pa.name}」目前餘額 ${num(c.pa.balance, c.pa.currency)}，不足以支付 ${num(c.payAmt, c.pa.currency)} ${c.pa.currency}。仍然可以記錄，餘額會變成負的。`));
    if (c.p.price != null && c.price > 0 && Math.abs(c.price / c.p.price - 1) > 0.1) msgs.push(h('div', { class: 'ex-warn' }, `成交價和現價 ${invPrice(c.p.price)} 差了 ${((c.price / c.p.price - 1) * 100).toFixed(1)}%，請確認有沒有輸錯。`));
    info.replaceChildren(...msgs.map((m) => (typeof m === 'string' ? h('div', { class: 'hint' }, m) : m)));
  }

  function paintForm() {
    const sell = f.side === 'sell';
    const p = posOf(f.acct);
    if (!p) { formBox.replaceChildren(h('div', { class: 'empty' }, h('b', null, '還沒有投資標的'), '先按「管理股票」新增。')); return; }
    if (f.price === '' && p.price != null && !f.priceTouched) f.price = String(p.price);
    const field = (label, ...kids) => h('label', { class: 'field' }, h('span', null, label), ...kids);
    const inp = (name, key, touched, extra = {}) => h('input', { name, inputmode: 'decimal', autocomplete: 'off', value: f[key], 'aria-label': extra.label || name,
      oninput: (e) => { f[key] = e.target.value; if (touched) f[touched] = e.target.value.trim() !== ''; if (extra.after) extra.after(); sync(); }, ...(extra.attrs || {}) });
    const c0 = calc();
    const payOpts = payList();
    const pa = payOpts.find((a) => a.id == f.pay) || null;
    const needAcct = p.quote_currency !== p.currency;
    const needPay = pa && pa.currency !== p.currency;
    const parts = [
      h('div', { class: 'seg', role: 'group', 'aria-label': '買或賣' },
        h('button', { type: 'button', 'aria-pressed': String(!sell), onclick: () => { f.side = 'buy'; f.acctTouched = f.payTouched = f.taxTouched = false; paintForm(); } }, '買進'),
        h('button', { type: 'button', 'aria-pressed': String(sell), onclick: () => { f.side = 'sell'; f.acctTouched = f.payTouched = f.taxTouched = false; paintForm(); } }, '賣出')),
      field('股票', h('select', { 'aria-label': '股票', onchange: (e) => { f.acct = +e.target.value; f.price = ''; f.priceTouched = false; f.feeTouched = f.taxTouched = f.acctTouched = f.payTouched = false; f.qty = ''; f.unit = posOf(f.acct).market === 'TW' ? f.unit : 'odd'; paintForm(); } },
        board.positions.map((x) => h('option', { value: x.account_id, selected: x.account_id == f.acct }, `${x.name || x.symbol}　${x.symbol}　持有 ${isHidden() ? HIDDEN : +x.shares.toFixed(4)} 股`)))),
      h('div', { class: 'grid2' },
        field(p.market === 'TW' ? `數量（${f.unit === 'lot' ? '張，1 張 = 1000 股' : '股'}）` : '數量（股）',
          h('div', { class: 'row-inline inv-qty' }, inp('qty', 'qty', null, { label: '數量', attrs: { placeholder: '0' } }),
            p.market === 'TW' ? h('div', { class: 'seg', role: 'group', 'aria-label': '單位' },
              h('button', { type: 'button', 'aria-pressed': String(f.unit === 'lot'), onclick: () => { f.unit = 'lot'; paintForm(); } }, '整張'),
              h('button', { type: 'button', 'aria-pressed': String(f.unit === 'odd'), onclick: () => { f.unit = 'odd'; paintForm(); } }, '零股')) : null)),
        field(`成交價（${p.quote_currency}）`, inp('price', 'price', 'priceTouched', { label: '成交價', after: () => { f.priceTouched = f.price.trim() !== ''; } }),
          p.price != null ? h('span', { class: 'hint' }, `現價 ${invPrice(p.price)}`, ' ', h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.price = String(p.price); f.priceTouched = false; paintForm(); } }, '帶入')) : null)),
      ask,
      sell && p.shares > 0 ? h('div', { class: 'row-inline' }, h('button', { class: 'btn sm', type: 'button', onclick: () => {
        if (p.market === 'TW' && p.shares % 1000 === 0) { f.unit = 'lot'; f.qty = String(p.shares / 1000); } else { f.unit = 'odd'; f.qty = String(p.shares); }
        paintForm();
      } }, `全部 ${invCount(p.shares)} 股`)) : null,
      h('div', { class: 'grid2' },
        field(`手續費（${p.quote_currency}）`, inp('fee', 'fee', 'feeTouched', { label: '手續費' }), p.rules.fee_rate ? h('span', { class: 'hint' }, `預設 ${(p.rules.fee_rate * 100).toFixed(4)}%${board.fee_discount < 1 ? `（${+(board.fee_discount * 10).toFixed(2)} 折）` : ''}，依實際成交單修改`) : h('span', { class: 'hint' }, '依實際成交單填寫')),
        sell ? field(`證交稅（${p.quote_currency}）`, inp('tax', 'tax', 'taxTouched', { label: '證交稅' }), p.rules.tax_rate ? h('span', { class: 'hint' }, `預設 ${(p.rules.tax_rate * 100).toFixed(1)}%`) : null) : h('span')),
      field(sell ? '賣出款項轉入哪個帳戶' : '用哪個帳戶買（轉帳到這檔股票的帳戶）', h('select', { 'aria-label': '對方帳戶', onchange: (e) => { f.pay = e.target.value === '' ? '' : +e.target.value; f.payTouched = false; paintForm(); } },
        sell ? null : h('option', { value: '', selected: f.pay === '' }, '不扣款（登錄原本就持有的股票）'),
        payOpts.map((a) => h('option', { value: a.id, selected: a.id == f.pay }, `${a.name}（${a.currency}）　餘額 ${isHidden() ? HIDDEN : num(a.balance, a.currency)}`)))),
      needAcct ? field(`${sell ? '實收' : '實際付出'}換算成 ${p.currency}（「${p.account}」帳戶的幣別）`, inp('acct_amount', 'acctAmt', 'acctTouched', { label: '換算金額' }),
        h('span', { class: 'hint' }, rates[p.quote_currency] && rates[p.currency] ? '依目前匯率換算，請改成實際成交的金額' : `還沒有 ${p.quote_currency} → ${p.currency} 的匯率，請直接輸入實際金額`)) : null,
      needPay ? field(`${sell ? '實際入帳' : '實際扣款'}（${pa.currency}）`, inp('pay_amount', 'payAmt', 'payTouched', { label: '實際金額' }),
        h('span', { class: 'hint' }, rates[p.currency] && rates[pa.currency] ? '依目前匯率換算，請改成實際金額' : `還沒有 ${p.currency} → ${pa.currency} 的匯率，請直接輸入實際金額`)) : null,
      info,
      h('div', { class: 'grid2' },
        field('成交時間（留白 = 現在）', h('input', { type: 'datetime-local', value: f.time, 'aria-label': '時間', oninput: (e) => { f.time = e.target.value; } })),
        field('備註（選填）', h('input', { value: f.note, maxlength: 200, autocomplete: 'off', oninput: (e) => { f.note = e.target.value; } }))),
      h('div', { class: 'row-inline' }, h('button', { class: 'btn primary', type: 'button', onclick: () => submitTrade() }, inv.editId ? '儲存修改' : sell ? '確認賣出' : '確認買進'),
        h('span', { class: 'hint' }, sell ? '賣出會把這批股票的成本轉出，並把實收金額轉進你選的帳戶。' : '買進會從所選帳戶轉出「付出成本」到股票帳戶。'))];
    formBox.replaceChildren(...parts.filter(Boolean));
    sync();
  }
  formBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitTrade(); } });
  async function submitTrade() {
    const c = calc();
    try {
      if (!c) throw new Error('請先選擇股票');
      if (!(c.shares > 0)) throw new Error('請輸入數量');
      if (!(c.price > 0)) throw new Error('請輸入成交價');
      const needAcct = c.p.quote_currency !== c.p.currency, needPay = c.pa && c.pa.currency !== c.p.currency;
      const body = { account_id: c.p.account_id, side: f.side, shares: String(c.shares), price: f.price, fee: String(c.fee), tax: String(c.tax),
        pay_account_id: f.pay === '' ? undefined : f.pay, time: f.time || undefined, note: f.note,
        acct_amount: needAcct || f.acctTouched ? (f.acctAmt || c.acctAuto || undefined) : undefined,
        pay_amount: needPay || f.payTouched ? (f.payAmt || c.payAuto || undefined) : undefined };
      const editing = inv.editId;
      const r = editing ? await api('PUT', `/api/invest/trades/${editing}`, body) : await api('POST', '/api/invest/trades', body);
      if (editing) { toast('已儲存這筆買賣紀錄'); if (tradeDlg) tradeDlg.close(); watchSync(); await refresh(); return; }
      toast(c.sell ? `已賣出 ${c.p.name || c.p.symbol} ${invCount(c.shares)} 股，實現損益 ${num(r.realized, c.p.currency, true)} ${c.p.currency}` : `已買進 ${c.p.name || c.p.symbol} ${invCount(c.shares)} 股`);
      Object.assign(f, { qty: '', price: '', priceTouched: false, fee: '', tax: '', feeTouched: false, taxTouched: false, acctAmt: '', acctTouched: false, payAmt: '', payTouched: false, note: '', time: '' });
      if (tradeDlg) tradeDlg.close();
      watchSync(); await refresh();
    } catch (err) { fail(err); }
  }
  function openTrade() {
    if (tradeDlg && tradeDlg.isConnected) return;
    paintForm();
    tradeDlg = openDialog({ title: '買進／賣出股票', body: formBox, wide: true });
    const q = formBox.querySelector('[name=qty]'); if (q) q.focus();
  }
  // Two quick taps: the price chart (only the Taiwan market has one). Phone: swipe a row right to buy, left to sell.
  function trend(p) {
    if (p.market === 'TW') openStockDetail({ code: p.symbol, name: p.name, market: 'TWSE' }, mineCtx);
    else toast('這檔股票沒有走勢圖');
  }
  function swipeTrade(tr, p) {
    if (isPhone() && onTouch() && typeof enableSwipe === 'function')
      enableSwipe(tr, { onRight: () => pick('buy', p), onLeft: p.shares > 0 ? () => pick('sell', p) : null, leftLabel: '賣出', rightLabel: '買進', leftCls: 'sell', rightCls: 'buy' });
  }
  function pick(side, p) {
    f.side = side; f.acct = p.account_id; f.price = ''; f.priceTouched = false; f.qty = '';
    f.feeTouched = f.taxTouched = f.acctTouched = f.payTouched = false; f.unit = p.market === 'TW' ? f.unit : 'odd';
    if (tradeDlg && tradeDlg.isConnected) paintForm(); else openTrade();
  }

  // ---------------------------------------------------------------- trade history
  const histBox = h('section', { class: 'section' });
  inv.sel = inv.sel || new Set();
  const histBar = h('div');
  const paintHistBar = () => {
    const n = inv.sel.size, all = board.trades.map((t) => t.id), allOn = all.length > 0 && all.every((id) => inv.sel.has(id));
    histBar.replaceChildren(...(n ? [h('div', { class: 'sel-bar', role: 'toolbar', 'aria-label': '多筆操作' },
      h('b', { class: 'sel-n' }, `已勾選 ${n} 筆`),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { if (allOn) inv.sel.clear(); else all.forEach((id) => inv.sel.add(id)); paintHist(); } }, allOn ? '取消全選' : `全選（${all.length}）`),
      h('button', { class: 'btn sm danger', type: 'button', onclick: deleteTrades }, '刪除'),
      h('button', { class: 'btn sm ghost sel-end', type: 'button', onclick: () => { inv.sel.clear(); paintHist(); } }, '取消勾選'))] : []));
  };
  async function deleteTrades() {
    const ids = [...inv.sel];
    if (!await confirmBox({ title: `刪除 ${ids.length} 筆買賣紀錄？`, confirmLabel: '刪除', danger: true,
      message: h('p', null, '這些買賣當時轉出、轉入的錢會一起還原，持股與成本會重新計算。如果刪掉買進後，後面的賣出就沒有股票可賣，會整批取消並說明原因。刪除後 1 分鐘內可以按「復原」。') })) return;
    try { const r = await api('POST', '/api/invest/trades/delete', { ids }); inv.sel.clear(); await afterChange(`已刪除 ${r.deleted} 筆買賣紀錄`, undoAction(r.undo)); } catch (err) { fail(err); }
  }
  const paintHist = () => {
    const have = new Set(board.trades.map((t) => t.id));
    inv.sel = new Set([...inv.sel].filter((id) => have.has(id)));
    const rows = board.trades.map((t) => { const p = board.positions.find((x) => x.symbol === t.symbol);
      const again = () => (p ? pick(t.side === 'sell' && p.shares <= 0 ? 'buy' : t.side, p) : editTrade(t));
      const tr = h('tr', { class: 'tx-row tap2' + (inv.sel.has(t.id) ? ' picked' : ''), tabindex: '0', title: '點一下照這筆的方向買進／賣出這檔；點兩下看走勢；要修改請按「編輯」', ...rowTapDouble(again, () => (p ? trend(p) : editTrade(t))) },
      h('td', { class: 'c-sel' }, h('input', { type: 'checkbox', checked: inv.sel.has(t.id), 'aria-label': `選取 ${shortTime(t.time)} ${t.name || t.symbol}`,
        onchange: (e) => { if (e.target.checked) inv.sel.add(t.id); else inv.sel.delete(t.id); e.target.closest('tr').classList.toggle('picked', e.target.checked); paintHistBar(); } })),
      h('td', { class: 'when' }, shortTime(t.time)),
      h('td', { class: 't-side' }, h('span', { class: 'tag ' + (t.side === 'buy' ? 'tw-up' : 'tw-down') }, t.side === 'buy' ? '買進' : '賣出')),
      h('td', { class: 'name t-name' }, h('span', { class: 'tag t-side-inline ' + (t.side === 'buy' ? 'tw-up' : 'tw-down') }, t.side === 'buy' ? '買進' : '賣出'), t.name || t.symbol, h('div', { class: 'hint' }, t.symbol)),
      h('td', { class: 'r t-sh', 'data-label': '股數' }, invCount(t.shares)), h('td', { class: 'r t-px', 'data-label': '成交價' }, invPrice(t.price)),
      h('td', { class: 'r t-amt', 'data-label': '金額' }, money(t.amount, t.currency, { tag: false }), h('div', { class: 'hint' }, t.fee || t.tax ? `費 ${t.fee}${t.tax ? ` 稅 ${t.tax}` : ''}` : '')),
      h('td', { class: 't-acct', 'data-label': t.side === 'buy' ? '付款帳戶' : '入帳帳戶' }, t.moved_money ? `${t.side === 'buy' ? '←' : '→'} ${t.pay_account || ''}` : h('span', { class: 'hint' }, '未動帳戶')),
      h('td', { class: 'r t-real', 'data-label': '實現損益' }, t.realized == null ? null : h('span', { class: 'num tw' + twTone(t.realized) }, num(t.realized, t.currency, true))),
      h('td', { class: 'act' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => editTrade(t) }, '編輯'), h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        if (!await confirmBox({ title: '刪除這筆買賣紀錄？', message: `${t.side === 'buy' ? '買進' : '賣出'} ${t.name || t.symbol} ${t.shares} 股 @${t.price}。${t.moved_money ? '當時轉出／轉入的錢也會一起還原。' : ''}`, confirmLabel: '刪除', danger: true })) return;
        try { const r = await api('DELETE', `/api/invest/trades/${t.id}`); await afterChange('已刪除買賣紀錄', undoAction(r.undo)); } catch (err) { fail(err); }
      } }, '刪除')));
      if (p) swipeTrade(tr, p);
      return tr; });
    histBox.replaceChildren(h('div', { class: 'section-head' }, h('h2', null, '買賣紀錄')), histBar,
      rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'ledger stack inv-hist' },
        h('thead', null, h('tr', null, h('th', { class: 'c-sel' }, ''), ['時間', '', '股票'].map((x) => h('th', null, x)), h('th', { class: 'r' }, '股數'), h('th', { class: 'r' }, '成交價'), h('th', { class: 'r' }, '金額（計入股票帳戶）'), h('th', null, '對方帳戶'), h('th', { class: 'r' }, '實現損益'), h('th', null, ''))),
        h('tbody', null, rows)))
        : h('div', { class: 'empty' }, h('b', null, '還沒有買賣紀錄'), '買進或賣出後會記在這裡；買賣產生的轉帳也會出現在「交易」頁。'));
    paintHistBar();
  };

  // Edit a buy / sell: the same form, filled in from the record. Fee, tax and the converted amounts keep what was recorded when they were typed by
  // hand, and are worked out again when they were the usual figures (so changing the shares changes them too).
  function editTrade(t) {
    if (tradeDlg && tradeDlg.isConnected) return;
    const p = posOf(t.account_id);
    if (!p) return toast('這檔股票已經不在投資清單裡，沒辦法編輯這筆');
    inv.draft = { ...f };
    const lot = p.market === 'TW' && t.shares >= 1000 && t.shares % 1000 === 0;
    Object.assign(f, { side: t.side, acct: t.account_id, unit: p.market === 'TW' ? (lot ? 'lot' : 'odd') : 'odd', qty: String(lot ? t.shares / 1000 : t.shares),
      price: String(t.price), priceTouched: true, fee: '', feeTouched: false, tax: '', taxTouched: false, pay: t.pay_account_id == null ? '' : t.pay_account_id,
      acctAmt: '', acctTouched: false, payAmt: '', payTouched: false, time: String(t.time).slice(0, 16), note: t.note || '', askDismissed: null });
    inv.editId = t.id;
    let c = calc();
    const far = (a, b) => Math.abs((+a || 0) - (+b || 0)) > 0.011;
    if (c) {
      if (far(t.fee, c.autoFee)) { f.fee = String(t.fee); f.feeTouched = true; }
      if (t.side === 'sell' && far(t.tax, c.autoTax)) { f.tax = String(t.tax); f.taxTouched = true; }
      if (far(t.amount, c.acctAuto)) { f.acctAmt = String(t.amount); f.acctTouched = true; }
      c = calc();
      if (t.pay_amount != null && far(t.pay_amount, c.payAuto)) { f.payAmt = String(t.pay_amount); f.payTouched = true; }
    }
    paintForm();
    tradeDlg = openDialog({ title: '編輯買賣紀錄', body: formBox, wide: true });
    tradeDlg.addEventListener('close', () => { inv.editId = null; if (inv.draft) Object.assign(f, inv.draft); inv.draft = null; paintForm(); });
  }

  // ---------------------------------------------------------------- manage stocks
  function manageDialog() {
    const tw = (x) => x.market === 'TW';
    const rowsEl = board.positions.map((p) => {
      const sym = h('input', { value: p.symbol, 'aria-label': '代號', size: 8 }), nm = h('input', { value: p.name, 'aria-label': '名稱', size: 14 });
      return h('div', { class: 'inv-manage-row' }, h('span', { class: 'hint' }, `${p.account}　${p.market === 'TW' ? '台股' : '美股'}`), sym, nm,
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await api('PUT', `/api/invest/securities/${p.account_id}`, { symbol: sym.value, name: nm.value }); toast('已儲存'); await repaint(); } catch (e) { fail(e); } } }, '儲存'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { try { await api('DELETE', `/api/invest/securities/${p.account_id}`); toast(`已把「${p.account}」移出投資`); await refresh(); } catch (e) { fail(e); } } }, '移除'));
    });
    const nsym = h('input', { placeholder: '代號，例如 0056', 'aria-label': '代號', size: 10 }), nname = h('input', { placeholder: '名稱', 'aria-label': '名稱', size: 14 });
    const nmarket = h('select', { 'aria-label': '市場' }, h('option', { value: 'TW' }, '台股'), h('option', { value: 'US' }, '美股'));
    const existing = h('select', { 'aria-label': '帳戶' }, h('option', { value: '' }, '建立同名新帳戶'), board.accounts.map((a) => h('option', { value: a.id }, `使用現有帳戶「${a.name}」（${a.currency}）`)));
    const disc = h('input', { value: String(board.fee_discount), inputmode: 'decimal', size: 5, 'aria-label': '手續費折扣' });
    const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('p', { class: 'hint' }, '每檔股票有自己的帳戶；帳戶名稱是 TSMC、0050、0056、UMC、NVDA 的會自動辨識。股價的代號要正確，才讀得到報價。'),
      ...rowsEl,
      h('h4', null, '新增股票'),
      h('div', { class: 'inv-manage-row' }, nmarket, nsym, nname), existing,
      h('h4', null, '台股手續費折扣'),
      h('div', { class: 'row-inline' }, disc, h('span', { class: 'hint' }, '1 = 不打折（0.1425%），6 折請輸入 0.6。只用來預填手續費，每筆都可以改。')));
    openDialog({ title: '管理投資股票', body, wide: true, primary: { label: '儲存', run: async () => {
      if (disc.value.trim() && Number(disc.value) !== board.fee_discount) await api('PUT', '/api/invest/settings', { fee_discount: disc.value });
      if (nsym.value.trim()) {
        await api('POST', '/api/invest/securities', { symbol: nsym.value, name: nname.value, market: nmarket.value, account_id: existing.value || undefined, account_name: nsym.value.trim().toUpperCase() });
        toast(`已新增 ${nsym.value.trim().toUpperCase()}`);
      }
      await refresh();
    } } });
  }

  async function repaint() {
    board = S.invBoard = await api('GET', '/api/invest');
    const ae = document.activeElement;
    if (!(ae && ae.tagName === 'INPUT' && top.contains(ae))) paintTop();     // never take a half-typed price away
    paintHist();
    if (!exTyping()) paintForm(); else sync();
  }
  S.invRepaint = repaint;

  // two pages: the stocks that already have an account, and every other listed / OTC stock and ETF
  const mineCtx = { positions: () => board.positions, create: false };
  const marketCtx = { positions: () => board.positions, create: true };
  const mineBox = h('div', null, top, histBox), marketBox = h('div');
  const tabBar = h('div', { class: 'seg inv-tabs', role: 'group', 'aria-label': '投資分頁' });
  let marketBuilt = false;
  const setTab = (t) => {
    S.invTab = t;
    mineBox.hidden = t !== 'mine'; marketBox.hidden = t !== 'market';
    tabBar.replaceChildren(h('button', { type: 'button', 'aria-pressed': String(t === 'mine'), onclick: () => setTab('mine') }, `我的持股（${board.positions.length} 檔）`),
      h('button', { type: 'button', 'aria-pressed': String(t === 'market'), onclick: () => setTab('market') }, '其他股票・ETF（尚未建立帳戶）'));
    if (t === 'market' && !marketBuilt) { marketBuilt = true; buildMarketTab(marketBox, marketCtx); }
  };
  const intro = pageIntro('「我的持股」是已經建立帳戶的股票：買進是從你選的帳戶把錢轉進股票帳戶（付出成本），賣出是把成本轉出、實收轉進你選的帳戶，損益只是預估。「其他股票・ETF」列出全部上市櫃股票，可以先看走勢，再決定要不要建立帳戶。');
  view.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '投資', eyeButton('invest'), intro.btn), intro.p)),
    h('div', { class: 'inv-tabbar' }, tabBar),
    mineBox, marketBox);
  paintTop(); paintForm(); paintHist();
  setTab(S.invTab === 'market' ? 'market' : 'mine');
  invWatch();
}


// ---- 報表 → 投資占比 --------------------------------------------------------------------------------
// Shares of the portfolio by stock: a doughnut (the biggest slice named in the middle, follows the pointer) or bars,
// then the profit or loss of each stock and a table. Everything is converted to the main currency.
async function drawInvestShare(out, r) {
  const base = S.st.base, rates = rateTable();
  const board = await api('GET', '/api/invest');
  const by = r.shareBy === 'cost' ? 'cost' : 'value';
  const rows = [], missing = [];
  board.positions.filter((p) => p.shares > 0).forEach((p, i) => {
    const k = rates[p.currency];
    if (!k) { missing.push(p.currency); return; }
    const amt = by === 'cost' ? p.cost : p.value;
    if (amt == null) { missing.push(`${p.name || p.symbol} 的股價`); return; }
    rows.push({ p, amt: amt * k, val: p.value == null ? null : p.value * k, cost: p.cost * k, pnl: p.pnl == null ? null : p.pnl * k, label: p.name || p.symbol });
  });
  rows.sort((a, b) => b.amt - a.amt);
  rows.forEach((x, i) => { x.color = PALETTE[i % PALETTE.length]; });
  const total = rows.reduce((t, x) => t + x.amt, 0);
  const pct = (v) => (total ? v / total * 100 : 0);
  if (missing.length) out.append(h('div', { class: 'banner' }, h('span', null, `缺少 ${[...new Set(missing)].join('、')}，這些持股沒有算進圖表。`), h('a', { class: 'btn sm', href: '#/invest' }, '到投資頁')));
  if (!rows.length) { out.append(h('div', { class: 'empty' }, h('b', null, '還沒有可以畫的持股'), '到「投資」頁登錄買進，或輸入現價後這裡就會顯示占比。')); return; }
  const what = by === 'cost' ? '付出成本' : '庫存市值（預估）';
  const cv = h('canvas', { role: 'img', 'aria-label': `投資占比${r.shareKind === 'pie' ? '圓餅圖' : '長條圖'}` });
  out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' },
    h('h2', null, `投資占比　依${what}`, h('span', { class: 'total' }, num(total, base), h('span', { class: 'ccy' }, base))),
    h('div', { class: 'chart-wrap' }, cv)));
  const tip = { callbacks: { label: (c) => { const x = rows[c.dataIndex]; return ` ${num(x.amt, base)} ${base}（${pct(x.amt).toFixed(2)}%）`; },
    afterLabel: (c) => { const x = rows[c.dataIndex]; return [`${x.p.symbol}　${isHidden() ? HIDDEN : +x.p.shares.toFixed(4)} 股`]; } } };
  if (r.shareKind === 'pie') {
    const center = { i: 0 };
    const centerText = { id: 'centerText', afterDraw(chart) {
      const a = chart.chartArea, ctx = chart.ctx, x = rows[center.i] || rows[0], cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
      ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = css('--ink');
      ctx.font = `600 26px ${css('--sans') || 'sans-serif'}`; ctx.fillText(`${pct(x.amt).toFixed(2)}%`, cx, cy + 2);
      ctx.font = `14px ${css('--sans') || 'sans-serif'}`; ctx.fillStyle = css('--ink-3'); ctx.fillText(x.p.symbol, cx, cy + 24);
      ctx.restore(); } };
    mkChart(cv, { type: 'doughnut', plugins: [centerText], data: { labels: rows.map((x) => `${x.label}　${pct(x.amt).toFixed(1)}%`), datasets: [{ data: rows.map((x) => x.amt), backgroundColor: rows.map((x) => x.color), borderColor: css('--surface'), borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: tip },
        onHover: (e, els, chart) => { const i = els.length ? els[0].index : center.i; if (i !== center.i) { center.i = i; chart.draw(); } } } });
  } else {
    mkChart(cv, { type: 'bar', data: { labels: rows.map((x) => x.label), datasets: [{ data: rows.map((x) => x.amt), backgroundColor: rows.map((x) => x.color), borderRadius: 3 }] },
      options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: tip },
        scales: { x: { ticks: { callback: (v) => (isHidden() ? '' : v) } } } } });
  }
  // profit or loss of each stock (an estimate until sold)
  const known = rows.filter((x) => x.pnl != null);
  if (known.length) {
    const cv2 = h('canvas', { role: 'img', 'aria-label': '各股損益試算長條圖' });
    out.append(h('div', { class: 'chart-box', style: 'margin-top:14px' }, h('h2', null, '各股損益試算（預估，賣出後才算實際）'), h('div', { class: 'chart-wrap' }, cv2)));
    const colorOf = (v) => (isHidden() ? css('--ink-3') : v >= 0 ? '#B8322A' : '#1B7A4B');
    mkChart(cv2, { type: 'bar', data: { labels: known.map((x) => x.label), datasets: [{ data: known.map((x) => x.pnl), backgroundColor: known.map((x) => colorOf(x.pnl)), borderRadius: 3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const x = known[c.dataIndex]; return ` ${num(x.pnl, base, true)} ${base}（${invPct(x.cost ? x.pnl / x.cost : null)}）`; } } } },
        scales: { y: { ticks: { callback: (v) => (isHidden() ? '' : v) } } } } });
  }
  out.append(h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '明細')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'ledger' },
      h('thead', null, h('tr', null, h('th', null, '股票'), h('th', { class: 'r' }, `占比（依${by === 'cost' ? '成本' : '市值'}）`), h('th', { class: 'r' }, '庫存市值（預估）'), h('th', { class: 'r' }, '付出成本'), h('th', { class: 'r' }, '損益試算'), h('th', { class: 'r' }, '報酬率'))),
      h('tbody', null, rows.map((x) => h('tr', null,
        h('td', { class: 'name' }, h('span', { class: 'share-dot', style: `background:${x.color}` }), x.label, h('span', { class: 'hint' }, `　${x.p.symbol}`)),
        h('td', { class: 'r' }, `${pct(x.amt).toFixed(2)}%`), h('td', { class: 'r' }, x.val == null ? '—' : num(x.val, base)), h('td', { class: 'r' }, num(x.cost, base)),
        h('td', { class: 'r' }, x.pnl == null ? '—' : h('span', { class: 'num tw' + twTone(x.pnl) }, num(x.pnl, base, true))),
        h('td', { class: 'r' }, x.pnl == null || !x.cost ? '—' : h('span', { class: 'tw' + twTone(x.pnl) }, invPct(x.pnl / x.cost)))))),
      h('tfoot', null, h('tr', null, h('td', { class: 'name' }, '合計'), h('td', { class: 'r' }, '100%'), h('td', { class: 'r' }, rows.some((x) => x.val == null) ? '' : num(rows.reduce((t, x) => t + x.val, 0), base)),
        h('td', { class: 'r' }, num(rows.reduce((t, x) => t + x.cost, 0), base)), h('td', { class: 'r' }, ''), h('td', { class: 'r' }, '')))))));
}
