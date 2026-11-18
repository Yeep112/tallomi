'use strict';
/* Tallomi: 換匯 page. Loaded before app.js; uses its helpers (h, api, S, num, ...) when it runs. */

const EX_RANGES = [[7, '7 天'], [30, '1 個月'], [90, '3 個月'], [365, '1 年']];
const fmtRate = (x) => (x == null || x === '' || !isFinite(x) ? '—' : String(+Number(x).toFixed(6)));
const parseNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return isFinite(n) ? n : NaN; };
const roundTo = (v, d) => { const f = 10 ** d; return Math.round((v + Number.EPSILON) * f) / f; };
const exBankOf = (name) => { const low = String(name || '').toLowerCase(); return Object.keys(S.st.banks || {}).find((k) => low.startsWith(k.toLowerCase())) || null; };
const exDigits = (ccy) => (ccy === S.st.base ? 0 : digits(ccy));          // the bank credits whole units of the base currency

// ---- reading the banks' own pages -------------------------------------------------------------
function exPaint() {
  const box = S.exStatusEl;
  if (!box || !box.isConnected) return;
  const banks = S.st.banks || {}, ccy = S.ex.ccy, auto = S.exAuto || {}, manual = (S.exFetch || {})[ccy], kids = [];
  const autoRes = (auto.results || {})[ccy];
  const results = manual && manual.results.length ? manual.results : (autoRes || []);
  const running = S.exFetching || auto.state === 'running';
  if (running) kids.push(h('div', { class: 'hint' }, '正在讀取四家銀行官網的目前匯率…最多約 1 分鐘，期間可以先操作；讀到的匯率都還可以修改。'));
  if (manual && manual.error) kids.push(h('div', { class: 'ex-warn' }, `讀取官網失敗：${manual.error}`));
  kids.push(...results.map((r) => h('div', { class: 'ex-fetch-item' + (r.ok ? '' : ' bad') }, h('b', null, banks[r.bank]),
    r.ok ? ` 買進 ${fmtRate(r.buy)}　賣出 ${fmtRate(r.sell)}${r.quoted_at ? `　（官網時間 ${r.quoted_at.slice(5, 16).replace('T', ' ')}）` : ''}` : ` 沒抓到：${r.error}，請手動輸入`)));
  if (!running) {
    const when = manual ? `手動讀取 ${new Date(manual.at).toLocaleTimeString('zh-TW', { hour12: false })}` : (auto.last_ok ? `上次自動更新 ${auto.last_ok.slice(5, 16).replace('T', ' ')}` : '');
    const todayNote = !auto.enabled ? '每日自動更新已關閉。'
      : auto.done_today ? `今天已自動更新 ${auto.done_count}/${auto.per_day || 2} 次，這個時段已完成。`
      : auto.state === 'offline' ? '目前連不上網路，連線後會自動再試。'
      : auto.state === 'error' ? '今天自動更新沒有成功，會稍後再試；也可以按下面的按鈕手動更新。'
      : (auto.currencies || []).length ? '這個時段還沒自動更新（每天上午、下午各一次），開著程式有網路時就會執行。' : '有外幣帳戶後才會自動更新。';
    kids.push(h('div', { class: 'hint' }, [when, todayNote, '官網牌價可能和銀行 App 的數位優惠價不同，以實際成交的匯率為準，請直接修改。'].filter(Boolean).join('　')));
  }
  kids.push(h('div', { class: 'row-inline' },
    h('button', { class: 'btn sm', type: 'button', disabled: !!running, onclick: () => exAutoFetch(ccy, true) }, running ? '讀取中…' : '立即從官網更新'),
    h('label', { class: 'row-inline hint' }, h('input', { type: 'checkbox', checked: !!auto.enabled, onchange: async (e) => {
      try { S.exAuto = await api('PUT', '/api/fx/auto', { enabled: e.target.checked }); } catch (err) { fail(err); e.target.checked = !e.target.checked; }
      exPaint();
    } }), '每天自動更新 2 次（上午、下午各一次，有網路、程式開著時）')));
  box.replaceChildren(...kids);
}
// While the exchange page is open, notice when a background update (twice a day) or a manual one has finished.
// A finished update is already in the rate table; the form is only changed after the person says yes (see the ask box).
const exTyping = () => { const el = document.activeElement; return !!(el && el.closest && el.closest('#view, dialog[open]') && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)); };      // a buy / sell dialog is outside #view: a price update must not rebuild it under the person's thumb (the keyboard would drop)
async function exWatch() {
  if (S.exWatching) return;
  S.exWatching = true;
  try {
    while (currentRoute() === 'exchange') {
      await new Promise((r) => setTimeout(r, S.exAuto && S.exAuto.state === 'running' ? 4000 : 20000));
      if (currentRoute() !== 'exchange') break;
      const prev = S.exAuto || {};
      const a = await api('GET', '/api/fx/auto');
      S.exAuto = a;
      if (a.last_ok !== prev.last_ok || (prev.state === 'running' && a.state !== 'running')) {
        if (exTyping() && S.exRefresh) await S.exRefresh(); else await renderRoute();
      } else if (prev.state !== a.state) exPaint();
    }
  } catch { /* server closed */ } finally { S.exWatching = false; }
}
async function exAutoFetch(ccy, force) {
  S.exFetch = S.exFetch || {};
  const f = S.exFetch[ccy];
  if (S.exFetching) return;
  S.exFetching = true; exPaint();
  try {
    const r = await api('POST', '/api/fx/fetch', { currency: ccy, save: true });
    S.exFetch[ccy] = { at: Date.now(), results: r.results };
  } catch (e) { S.exFetch[ccy] = { at: Date.now(), results: [], error: e.message }; }
  finally { S.exFetching = false; }
  if (currentRoute() !== 'exchange' || !S.ex || S.ex.ccy !== ccy) return;
  if (exTyping() && S.exRefresh) await S.exRefresh(); else renderRoute();     // never pull the page out from under a half-typed amount
}

async function viewExchange(view) {
  const base = S.st.base, banks = S.st.banks || {}, bankKeys = S.st.bank_order || Object.keys(banks);
  const ex = (S.ex = S.ex || { dir: 'buy', amount: '', toAmount: '', toEdited: false, rate: '', rateTouched: false, time: '', note: '', range: 7,
    bank: bankKeys[0], ccy: null, baseAcct: null, forAcct: null });
  const foreign = S.st.currencies.filter((c) => c !== base);
  if (!ex.ccy || ex.ccy === base) ex.ccy = (activeAccounts().find((a) => a.currency !== base) || {}).currency || foreign[0] || 'USD';
  const buying = ex.dir === 'buy';                       // buying foreign currency = the bank SELLS it to you
  const side = buying ? 'sell' : 'buy';
  let [board, auto] = await Promise.all([api('GET', '/api/fx/board?currency=' + encodeURIComponent(ex.ccy)), api('GET', '/api/fx/auto')]);
  S.exAuto = auto;
  const quote = (bank, sd) => (board.banks.find((b) => b.bank === bank) || {})[sd] || null;
  const q = quote(ex.bank, side);
  // The rate in the form only follows the table when the bank / currency / direction changes. A newer rate that arrives
  // later (background update, manual update) is offered in the ask box instead of silently replacing what is in the form.
  const rateKey = `${ex.bank}|${ex.ccy}|${side}`;
  if (ex.rateKey !== rateKey) { ex.rateKey = rateKey; ex.rateTouched = false; ex.dismissed = null; ex.rate = q ? q.text : ''; }
  else if (!ex.rate && q) ex.rate = q.text;

  const baseList = activeAccounts().filter((a) => a.currency === base);
  const forList = activeAccounts().filter((a) => a.currency === ex.ccy);
  const dflt = (list) => list.find((a) => exBankOf(a.name) === ex.bank) || list[0] || null;
  if (!baseList.some((a) => a.id == ex.baseAcct)) ex.baseAcct = dflt(baseList) ? dflt(baseList).id : null;
  if (!forList.some((a) => a.id == ex.forAcct)) ex.forAcct = dflt(forList) ? dflt(forList).id : null;
  const fromCcy = buying ? base : ex.ccy, toCcy = buying ? ex.ccy : base;
  const fromId = () => (buying ? ex.baseAcct : ex.forAcct), toId = () => (buying ? ex.forAcct : ex.baseAcct);

  const reset = (bankChanged) => { ex.rateTouched = false; ex.toEdited = false; ex.toAmount = ''; if (bankChanged) { ex.baseAcct = null; ex.forAcct = null; } renderRoute(); };

  // ---- calculation -------------------------------------------------------------------------
  const calc = () => {
    const r = parseNum(ex.rate), a = parseNum(ex.amount);
    if (!(r > 0) || !(a > 0)) return '';
    return String(roundTo(buying ? a / r : a * r, exDigits(toCcy)));
  };
  const amountIn = h('input', { class: 'ex-amt', name: 'amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: ex.amount, 'aria-label': `賣出 ${fromCcy} 金額`,
    oninput: (e) => { ex.amount = e.target.value; sync(); } });
  const toIn = h('input', { class: 'ex-amt', name: 'to_amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: ex.toAmount, 'aria-label': `買入 ${toCcy} 金額`,
    oninput: (e) => { ex.toAmount = e.target.value; ex.toEdited = e.target.value.trim() !== ''; sync(true); } });
  const rateIn = h('input', { class: 'ex-rate', name: 'rate', inputmode: 'decimal', autocomplete: 'off', placeholder: '輸入銀行 App 上的匯率', value: ex.rate, 'aria-label': '匯率',
    oninput: (e) => { ex.rate = e.target.value; ex.rateTouched = true; sync(); } });
  const info = h('div', { class: 'ex-info', 'aria-live': 'polite' });
  const ask = h('div', { class: 'ex-ask', role: 'status', 'aria-live': 'polite' });
  const paintAsk = () => {
    const nq = quote(ex.bank, side);
    const newer = nq && nq.source === 'web' && nq.text !== ex.dismissed && !(parseNum(ex.rate) === Number(nq.text));
    if (!newer) return ask.replaceChildren();
    ask.replaceChildren(h('div', null, `${banks[ex.bank]}官網有新的${buying ? '賣出' : '買進'}匯率 `, h('b', null, fmtRate(nq.rate)), `（${shortTime(nq.at)} 讀取），表單目前是 ${ex.rate ? fmtRate(parseNum(ex.rate)) : '空白'}。要套用到表單嗎？`),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => { ex.rate = nq.text; ex.rateTouched = false; ex.toEdited = false; ex.toAmount = ''; ex.dismissed = null; renderRoute(); } }, '套用'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { ex.dismissed = nq.text; paintAsk(); } }, '先不要')));
  };
  S.exRefresh = async () => { board = await api('GET', '/api/fx/board?currency=' + encodeURIComponent(ex.ccy)); paintAsk(); exPaint(); };
  const effLine = h('div', { class: 'hint' });
  const fromAcct = () => acct(fromId());

  function sync(fromToBox) {
    if (!ex.toEdited && !fromToBox) { ex.toAmount = calc(); toIn.value = ex.toAmount; }
    const a = parseNum(ex.amount), t = parseNum(ex.toAmount), r = parseNum(ex.rate);
    // The rate the bank really applied, when the amount typed in the lower box differs from the calculation.
    if (ex.toEdited && a > 0 && t > 0) {
      const eff = buying ? a / t : t / a;
      effLine.replaceChildren(`依你輸入的金額，實際匯率約 ${fmtRate(eff)}`, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ex.toEdited = false; ex.toAmount = ''; sync(); } }, '依匯率重算'));
    } else effLine.replaceChildren(r > 0 ? `1 ${ex.ccy} = ${fmtRate(r)} ${base}` : '');
    const msgs = [];
    const sideName = buying ? '賣出' : '買進';
    if (!(r > 0)) msgs.push(`還沒有 ${banks[ex.bank]} 的 ${ex.ccy} 銀行${sideName}匯率：請對照銀行 App，把匯率輸入上面的欄位。`);
    else {
      const today = nowLocal().slice(0, 10);
      if (q && !ex.rateTouched && q.at.slice(0, 10) !== today) msgs.push(`這個匯率是 ${shortTime(q.at)} 記錄的，不是今天的。銀行匯率隨時在變，請對照銀行 App，不一樣就直接改。`);
      if (q && ex.rateTouched && Math.abs(r / q.rate - 1) > 0.03) msgs.push(`和上次記錄的 ${fmtRate(q.rate)} 差了 ${((r / q.rate - 1) * 100).toFixed(1)}%，請確認有沒有輸錯。`);
      const m = board.market;
      if (m && m.rate > 0 && Math.abs(r / m.rate - 1) > 0.03) msgs.push(`和市場參考價 ${fmtRate(m.rate)} 差了 ${((r / m.rate - 1) * 100).toFixed(1)}%，請確認有沒有輸錯。`);
      const other = quote(ex.bank, buying ? 'buy' : 'sell');
      if (other && ((buying && r < other.rate) || (!buying && r > other.rate))) msgs.push('銀行賣出匯率通常高於買進匯率，請確認方向和數字有沒有填反。');
    }
    const fa = fromAcct();
    if (fa && a > 0 && fa.balance != null && a > fa.balance) msgs.push(`「${fa.name}」目前餘額不足以支付這筆金額（餘額 ${num(fa.balance, fa.currency)} ${fa.currency}）。仍然可以記錄，餘額會變成負的。`);
    info.replaceChildren(...msgs.map((m) => h('div', { class: 'ex-warn' }, m)));
  }

  // ---- the two boxes -----------------------------------------------------------------------
  const acctPicker = (list, key, ccy) => {
    if (!list.length) {
      return h('div', { class: 'row-inline' }, h('span', { class: 'hint' }, `還沒有 ${ccy} 帳戶`),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          try { await api('POST', '/api/accounts', { name: `${ex.bank} ${ccy}`, currency: ccy }); await afterChange(`已建立帳戶「${ex.bank} ${ccy}」`); } catch (e) { fail(e); }
        } }, `建立「${ex.bank} ${ccy}」`));
    }
    return h('select', { 'aria-label': '帳戶', onchange: (e) => { ex[key] = +e.target.value; renderRoute(); } },
      list.map((a) => h('option', { value: a.id, selected: a.id == ex[key] }, a.name)));
  };
  const balanceNote = (id, ccy) => { const a = acct(id); return h('div', { class: 'hint' }, a ? `可用餘額 ${ccy} ${num(a.balance, ccy)}` : ''); };
  const ccySelect = h('select', { class: 'ex-ccy-pick', 'aria-label': '外幣幣別', onchange: (e) => { ex.ccy = e.target.value; ex.forAcct = null; reset(false); } },
    foreign.map((c) => h('option', { value: c, selected: c === ex.ccy }, c)));
  const fixedCcy = h('span', { class: 'ex-ccy' }, base);
  const boxFrom = h('div', { class: 'ex-box' },
    h('div', { class: 'ex-label' }, `賣出 ${fromCcy}`),
    h('div', { class: 'ex-line' }, buying ? fixedCcy : ccySelect, amountIn),
    h('label', { class: 'field' }, h('span', null, '轉出帳號'), buying ? acctPicker(baseList, 'baseAcct', base) : acctPicker(forList, 'forAcct', ex.ccy)),
    balanceNote(fromId(), fromCcy));
  const statusBox = h('div', { class: 'ex-fetch' });
  S.exStatusEl = statusBox;
  const boxTo = h('div', { class: 'ex-box' },
    h('div', { class: 'ex-label' }, `買入 ${toCcy}`),
    h('div', { class: 'ex-line' }, buying ? ccyCloneFor() : h('span', { class: 'ex-ccy' }, base), toIn),
    h('label', { class: 'field' }, h('span', null, '轉入帳號'), buying ? acctPicker(forList, 'forAcct', ex.ccy) : acctPicker(baseList, 'baseAcct', base)),
    balanceNote(toId(), toCcy));
  function ccyCloneFor() {   // the lower box shows the same currency choice (kept in step with the upper one)
    return h('select', { class: 'ex-ccy-pick', 'aria-label': '外幣幣別', onchange: (e) => { ex.ccy = e.target.value; ex.forAcct = null; reset(false); } },
      foreign.map((c) => h('option', { value: c, selected: c === ex.ccy }, c)));
  }
  const swap = h('button', { class: 'ex-swap', type: 'button', 'aria-label': '對調買賣方向', title: '對調買賣方向',
    onclick: () => { ex.dir = buying ? 'sell' : 'buy'; ex.amount = ''; reset(false); } },
    svg(['path', { d: 'M7 4v14' }], ['path', { d: 'M3.5 14.5L7 18l3.5-3.5' }], ['path', { d: 'M17 20V6' }], ['path', { d: 'M13.5 9.5L17 6l3.5 3.5' }]));

  // ---- form --------------------------------------------------------------------------------
  const bankSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '銀行' }, bankKeys.map((k) =>
    h('button', { type: 'button', 'aria-pressed': String(k === ex.bank), title: k, onclick: () => { ex.bank = k; reset(true); } }, banks[k])));
  const dirSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '買賣方向' },
    h('button', { type: 'button', 'aria-pressed': String(buying), onclick: () => { if (!buying) { ex.dir = 'buy'; ex.amount = ''; reset(false); } } }, '我要買外幣'),
    h('button', { type: 'button', 'aria-pressed': String(!buying), onclick: () => { if (buying) { ex.dir = 'sell'; ex.amount = ''; reset(false); } } }, '我要賣外幣'));
  const quoteNote = q
    ? `${banks[ex.bank]}銀行${buying ? '賣出' : '買進'}匯率，${q.source === 'web' ? '官網牌價，讀取於' : '上次記錄於'} ${shortTime(q.at)}${q.source === 'exchange' ? '（上次換匯時用的）' : ''}`
    : `還沒有記錄過 ${banks[ex.bank]} 的 ${ex.ccy} 匯率`;
  const form = h('form', { class: 'ex-card', 'aria-label': '換匯' },
    h('div', { class: 'row-inline' }, bankSeg),
    dirSeg,
    h('div', { class: 'ex-pair' }, boxFrom, swap, boxTo),
    ask,
    h('label', { class: 'field' }, h('span', null, `匯率（1 ${ex.ccy} = ? ${base}）`), rateIn),
    h('div', { class: 'hint' }, quoteNote, ex.rateTouched && q ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ex.rate = q.text; ex.rateTouched = false; ex.toEdited = false; ex.toAmount = ''; renderRoute(); } }, '還原成記錄的匯率') : null),
    effLine, info,
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, '時間（留白 = 現在）'), h('input', { type: 'datetime-local', value: ex.time, 'aria-label': '時間', oninput: (e) => { ex.time = e.target.value; } })),
      h('label', { class: 'field' }, h('span', null, '備註（選填）'), h('input', { value: ex.note, maxlength: 200, autocomplete: 'off', oninput: (e) => { ex.note = e.target.value; } }))),
    h('div', { class: 'row-inline' }, h('button', { class: 'btn primary', type: 'submit' }, '確認換匯'),
      h('span', { class: 'hint' }, '匯率與金額都可以改成銀行實際成交的數字；按下確認前不會記帳。')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (fromId() == null || toId() == null) throw new Error(`請先選好轉出與轉入帳戶（沒有 ${ex.ccy} 帳戶的話，先按「建立」）`);
      if (!(parseNum(ex.rate) > 0)) throw new Error('請輸入匯率');
      if (!(parseNum(ex.amount) > 0)) throw new Error('請輸入要賣出的金額');
      const r = await api('POST', '/api/exchange', { bank: ex.bank, account_id: fromId(), to_account_id: toId(), amount: ex.amount, to_amount: ex.toAmount || undefined, rate: ex.rate, time: ex.time || undefined, note: ex.note });
      const a = parseNum(ex.amount), t = parseNum(ex.toAmount);
      toast(`已換匯：賣出 ${num(a, fromCcy)} ${fromCcy}，買入 ${num(t, toCcy)} ${toCcy}（${fmtRate(r.rate)}）`);
      Object.assign(ex, { amount: '', toAmount: '', toEdited: false, rateTouched: false, note: '', time: '' });
      watchSync(); await refresh();
    } catch (err) { fail(err); }
  });

  // ---- bank rate board ---------------------------------------------------------------------
  const rows = board.banks.map((b) => {
    const buyIn = h('input', { inputmode: 'decimal', autocomplete: 'off', placeholder: '—', value: b.buy ? b.buy.text : '', 'aria-label': `${banks[b.bank]} 銀行買進` });
    const sellIn = h('input', { inputmode: 'decimal', autocomplete: 'off', placeholder: '—', value: b.sell ? b.sell.text : '', 'aria-label': `${banks[b.bank]} 銀行賣出` });
    const at = [b.buy && b.buy.at, b.sell && b.sell.at].filter(Boolean).sort().pop();
    return h('tr', { class: b.bank === ex.bank ? 'on' : '' },
      h('td', { class: 'name' }, banks[b.bank], h('div', { class: 'hint' }, b.bank)),
      h('td', { class: 'r' }, buyIn), h('td', { class: 'r' }, sellIn),
      h('td', { class: 'when' }, at ? shortTime(at).slice(5) : '尚未記錄'),
      h('td', { class: 'act' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try {
          const r = await api('PUT', '/api/fx/rates', { bank: b.bank, currency: ex.ccy, buy: buyIn.value, sell: sellIn.value });
          toast(r.saved.length ? `已記錄 ${banks[b.bank]} ${ex.ccy} 匯率` : '匯率沒有變動');
          renderRoute();
        } catch (err) { fail(err); }
      } }, '儲存')));
  });
  const market = board.market;
  const boardBox = h('section', { class: 'section ex-board' },
    h('div', { class: 'section-head' }, h('h2', null, `牌告匯率　${ex.ccy}`),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await api('POST', '/api/rates/refresh'); toast('已更新市場參考價'); renderRoute(); } catch (e) { fail(e); } } }, '更新市場參考價')),
    statusBox,
    h('table', { class: 'ledger' },
      h('thead', null, h('tr', null, h('th', null, '銀行'), h('th', { class: 'r' }, '銀行買進（你賣外幣）'), h('th', { class: 'r' }, '銀行賣出（你買外幣）'), h('th', null, '更新時間'), h('th', null, ''))),
      h('tbody', null, rows)),
    h('p', { class: 'hint' }, `填銀行 App 顯示的「1 ${ex.ccy} 換多少 ${base}」。每次儲存或換匯都會記進走勢，換匯時就會自動帶入最近一次的匯率。`,
      market ? ` 市場參考中間價：${fmtRate(market.rate)}（${shortTime(market.at)}，只用來提醒你有沒有輸錯，不是銀行牌價）。` : ' 還沒有市場參考價，可按右上角取得。'));

  // ---- trend -------------------------------------------------------------------------------
  const trendBox = h('section', { class: 'section' });
  const drawTrend = async () => {
    const hist = await api('GET', `/api/fx/history?bank=${encodeURIComponent(ex.bank)}&currency=${ex.ccy}&side=${side}&days=${ex.range}`);
    const title = `${banks[ex.bank]}　${ex.ccy}　銀行${buying ? '賣出' : '買進'}匯率走勢`;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '走勢期間' }, EX_RANGES.map(([d, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(ex.range === d), onclick: () => { ex.range = d; trendBox.replaceChildren(); drawTrend().catch(fail); } }, l)));
    trendBox.replaceChildren(h('div', { class: 'section-head' }, h('h2', null, title), seg));
    if (!hist.points.length) { trendBox.append(h('div', { class: 'empty' }, h('b', null, '這段期間還沒有記錄'), '儲存牌告匯率或完成換匯後，這裡就會長出走勢。')); return; }
    const cv = h('canvas', { role: 'img', 'aria-label': title });
    trendBox.append(h('div', { class: 'chart-wrap' }, cv),
      h('p', { class: 'hint' }, `最高 ${fmtRate(hist.high)}　最低 ${fmtRate(hist.low)}　（共 ${hist.points.length} 天有記錄；走勢來自你自己記下的匯率）`));
    mkChart(cv, { type: 'line', data: { labels: hist.points.map((p) => p.date.slice(5)), datasets: [{ data: hist.points.map((p) => p.rate), borderColor: PALETTE[buying ? 0 : 4], backgroundColor: PALETTE[buying ? 0 : 4], tension: .2, pointRadius: hist.points.length > 40 ? 0 : 3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmtRate(c.parsed.y)}` } } },
        scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: (v) => fmtRate(v) } } } } });
  };

  // ---- recent exchanges --------------------------------------------------------------------
  const recent = await api('GET', '/api/transactions?type=transfer&q=' + encodeURIComponent('換匯 ') + '&limit=8');
  const recentBox = h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '最近的換匯')),
    recent.items.length
      ? h('table', { class: 'ledger' }, h('thead', null, h('tr', null, h('th', null, '時間'), h('th', null, '帳戶'), h('th', { class: 'r' }, '賣出'), h('th', { class: 'r' }, '買入'), h('th', null, '備註'))),
        h('tbody', null, recent.items.map((t) => h('tr', { class: 'click', title: '到「交易」頁修改', onclick: () => { S.txf.q = t.note.slice(0, 30); location.hash = '#/transactions'; } },
          h('td', { class: 'when' }, shortTime(t.time)), h('td', null, `${t.account} → ${t.to_account}`),
          h('td', { class: 'r' }, money(t.amount, t.currency)), h('td', { class: 'r' }, money(t.to_amount, t.to_currency)), h('td', { class: 'note' }, t.note)))))
      : h('div', { class: 'empty' }, h('b', null, '還沒有換匯記錄'), '完成第一筆換匯後會顯示在這裡。'));

  view.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '換匯', eyeButton('exchange')),
      h('p', { class: 'sub' }, `選銀行、方向和金額，匯率會帶入你最近記錄的牌告匯率；跟銀行 App 不一樣就直接改。換匯會記成「${base} 帳戶 ⇄ 外幣帳戶」的一筆轉帳。`))),
    h('div', { class: 'ex-grid' }, h('div', null, form), h('div', null, boardBox, trendBox)),
    recentBox);
  exPaint();
  paintAsk();
  sync();
  drawTrend().catch(fail);
  exWatch();
}
