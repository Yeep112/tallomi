// First start of a book that belongs to somebody else (the public version, computer or phone): a short guided setup.
// Main currency -> accounts and their balances -> optional import of old records -> optional PIN lock. Every step can be skipped.

function onboardingWizard() {
  const st = () => S.st;
  const steps = ['currency', 'accounts', 'import', 'lock'];
  let i = 0, finished = false;
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const errBox = h('div', { class: 'neg', role: 'alert', style: 'min-height:1.2em' });
  let base = st().base;
  const accountRows = [];          // existing accounts: { id, name, input }
  const newRows = [];              // accounts to create: { name, ccy, bal }

  const currencySelect = (value) => {
    const sel = h('select', { 'aria-label': '幣別' }, st().currencies.map((c) => h('option', { value: c }, c)));
    sel.value = value; return sel;
  };
  const finish = async () => {
    if (finished) return; finished = true;
    try { await api('PUT', '/api/settings', { onboarded: true }); } catch { /* shown again next time; harmless */ }
    await refresh().catch(() => {});
  };
  const nav = (primaryLabel, onNext, { back = true } = {}) => h('div', { class: 'row-inline', style: 'justify-content:space-between;margin-top:8px' },
    h('span', null, back && i > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { errBox.textContent = ''; i -= 1; draw(); } }, '上一步') : null),
    h('span', { class: 'row-inline' },
      i < steps.length - 1 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { errBox.textContent = ''; i += 1; draw(); } }, '略過') : null,
      h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
        e.target.disabled = true; errBox.textContent = '';
        try { await onNext(); } catch (er) { errBox.textContent = er.message || String(er); } finally { e.target.disabled = false; }
      } }, primaryLabel)));
  const head = (title, text) => [h('p', { class: 'hint', style: 'margin:0' }, `第 ${i + 1} ／ ${steps.length} 步`), h('h3', { style: 'margin:0' }, title), text ? h('p', { style: 'margin:0' }, text) : null];
  const next = () => { i += 1; draw(); };

  const stepCurrency = () => {
    const sel = currencySelect(base);
    body.replaceChildren(...head('歡迎使用 Tallomi', '先選主要幣別。總覽和報表會把所有帳戶換算成這個幣別；之後可以在「設定」改。'),
      h('label', { class: 'field' }, h('span', null, '主要幣別'), sel),
      nav('下一步', async () => {
        if (sel.value !== st().base) {
          await api('PUT', '/api/settings', { base_currency: sel.value });
          await refresh();
          // the starter "Cash" account follows the choice while it is still empty
          const cash = st().accounts.find((a) => a.name === 'Cash');
          if (cash && cash.currency !== sel.value) { try { await api('PUT', `/api/accounts/${cash.id}`, { currency: sel.value }); await refresh(); } catch { /* has records: leave it */ } }
        }
        base = sel.value; next();
      }, { back: false }));
  };

  const stepAccounts = () => {
    if (!accountRows.length) st().accounts.filter((a) => !a.archived).forEach((a) => accountRows.push({ id: a.id, name: a.name, ccy: a.currency, input: h('input', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': `${a.name} 目前的餘額` }) }));
    const addBox = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
    const drawNew = () => addBox.replaceChildren(...newRows.map((r, k) => h('div', { class: 'imp-acct' },
      h('label', { class: 'field' }, h('span', null, '帳戶名稱'), r.name),
      h('div', { class: 'row-inline' }, h('label', { class: 'field' }, h('span', null, '幣別'), r.ccy), h('label', { class: 'field' }, h('span', null, '目前的餘額'), r.bal),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { newRows.splice(k, 1); drawNew(); } }, '移除')))));
    const addRow = () => newRows.push({ name: h('input', { type: 'text', placeholder: '例如：郵局、玉山銀行', autocomplete: 'off', maxlength: 40 }), ccy: currencySelect(base), bal: h('input', { type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' }) });
    drawNew();
    body.replaceChildren(...head('你的帳戶', '現金、銀行、信用卡…每個帳戶有自己的餘額。先填目前各帳戶裡有多少錢（不確定可以留空，之後在「帳戶」頁調整）。'),
      h('div', { class: 'rows', style: 'padding:0;max-width:none' }, accountRows.map((r) => h('label', { class: 'field' }, h('span', null, `${r.name}（${r.ccy}）目前的餘額`), r.input))),
      addBox,
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => { addRow(); drawNew(); } }, '＋ 新增帳戶')),
      nav('下一步', async () => {
        for (const r of accountRows) {
          const v = r.input.value.trim();
          if (v) await api('PUT', `/api/accounts/${r.id}`, { opening: v });
        }
        for (const r of newRows.splice(0)) {
          const name = r.name.value.trim();
          if (!name) continue;
          try { await api('POST', '/api/accounts', { name, currency: r.ccy.value, opening: r.bal.value.trim() || 0 }); }
          catch (e) { newRows.push(r); throw e; }
        }
        await refresh(); accountRows.length = 0; next();
      }));
  };

  const stepImport = () => {
    const input = h('input', { type: 'file', multiple: true, accept: '.csv,.tsv,.txt,.json,text/csv', 'aria-label': '選擇要匯入的檔案', style: 'display:none' });
    input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) importWizard(files); });
    body.replaceChildren(...head('搬來舊的紀錄（選填）', '之前用別的記帳軟體嗎？到舊軟體把紀錄匯出成 CSV，在這裡選取檔案。會先給你預覽，匯入前也會自動備份，匯錯了可以還原。'),
      h('div', { class: 'row-inline' }, h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, '選擇檔案…'), input),
      h('p', { class: 'hint', style: 'margin:0' }, '沒有舊資料就直接按「略過」。以後隨時可以到「設定 → 匯入資料」再匯入。'),
      nav('下一步', async () => next()));
  };

  const stepLock = () => {
    const on = st().lock && st().lock.enabled;
    body.replaceChildren(...head('PIN 鎖（選填）', st().phone ? '設定後，每次打開 Tallomi 都要先輸入 PIN，別人拿到手機也看不到帳本。' : '設定後，每次打開 Tallomi 都要先輸入 PIN，別人用你的電腦也看不到帳本。'),
      on ? h('p', { style: 'margin:0' }, h('b', null, 'PIN 鎖已開啟。')) : h('div', { class: 'row-inline' }, h('button', { class: 'btn', type: 'button', onclick: () => pinDialog({ title: '設定 PIN', next: true, label: '開啟 PIN 鎖',
        run: async (v) => { S.st.lock = await api('PUT', '/api/lock', { pin: v.pin }); toast('PIN 鎖已開啟'); stepLock(); } }) }, '設定 PIN')),
      st().phone ? h('p', { class: 'hint', style: 'margin:0' }, '提醒：手機版的帳本只存在這支手機的瀏覽器裡。請到「設定 → 備份與匯出」定期下載備份檔；換手機或清除瀏覽資料前一定要先備份。') : null,
      nav('完成', async () => { dlg.close(); }));
  };

  const draw = () => { ({ currency: stepCurrency, accounts: stepAccounts, import: stepImport, lock: stepLock })[steps[i]](); };
  const dlg = openDialog({ title: 'Tallomi 新手設定', body: h('div', { class: 'rows', style: 'padding:0;max-width:none' }, body, errBox), cancelLabel: '先不要，之後再說' });
  dlg.addEventListener('close', () => { finish(); });
  draw();
}
