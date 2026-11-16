// Import entries from another bookkeeping app (a CSV from anywhere) or from the old notebook.
// One screen for the computer and the phone: pick a file -> preview (nothing is written yet) -> fix names if needed -> import.
// Shared by Settings on both versions (importSection()).

function importSection() {
  const input = h('input', { type: 'file', multiple: true, accept: '.csv,.tsv,.txt,.json,text/csv', 'aria-label': '選擇要匯入的檔案', style: 'display:none' });
  const pick = h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, '選擇檔案…');
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) importWizard(files);
  });
  const undoBox = h('div', { class: 'row-inline' });
  api('GET', '/api/import/last').then((r) => {
    if (!r.backup) return;
    undoBox.replaceChildren(
      h('button', { class: 'btn', type: 'button', onclick: () => undoImport(r.backup, () => undoBox.replaceChildren()) }, '還原到上次匯入前'),
      h('span', { class: 'hint' }, `${shortTime(r.backup.time)} 的備份。匯入之後新增的紀錄也會一起退回。`));
  }).catch(() => {});
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '匯入資料')),
    h('div', { class: 'rows' },
      h('p', { style: 'margin:0' }, '從其他記帳軟體搬過來：到舊軟體把紀錄匯出成 CSV，再在這裡選取那個檔案。'),
      h('p', { class: 'hint', style: 'margin:0' }, '欄位會自動辨識（日期、金額、帳戶、分類、備註、收入／支出），匯入前會先給你預覽，不會直接寫入。重複匯入同一份檔案不會產生重複紀錄。每次匯入前都會自動備份，匯錯了可以一鍵還原。也接受舊版的 transactions.csv 與 accounts.json。'),
      h('div', { class: 'row-inline' }, pick, input),
      undoBox,
      h('p', { class: 'hint', style: 'margin:0' }, 'Excel 檔（.xlsx）請先在 Excel 裡「另存新檔 → CSV UTF-8」。')));
}

const IMPORT_TYPE_NAME = { income: '收入', expense: '支出', transfer: '轉帳', adjust: '餘額調整' };

function importWizard(files) {
  const opts = { columns: {}, category_map: {}, account_map: {}, balances: {}, diff_adjust: true };
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' }, h('p', { class: 'muted', style: 'margin:0' }, '讀取中…'));
  let plan = null, timer = null, seq = 0;
  const importBtnLabel = () => (plan && plan.will_import ? `匯入 ${plan.will_import} 筆` : '匯入');

  const ask = async (path) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    fd.append('options', JSON.stringify(opts));
    return api('POST', path, fd, true);
  };
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      try { const p = await ask('/api/import/preview'); if (mine === seq) { plan = p; draw(); } }
      catch (e) { if (mine === seq) { plan = null; body.replaceChildren(h('p', { class: 'neg', style: 'margin:0' }, e.message || String(e))); } }
    }, 180);
  };
  const list = (arr, max = 6) => h('ul', { class: 'report-list' }, arr.slice(0, max).map((x) => h('li', null, x)), arr.length > max ? h('li', null, `…還有 ${arr.length - max} 項`) : null);

  function mappingSelect(options, current, onpick, firstLabel) {
    const sel = h('select', { onchange: () => onpick(sel.value) },
      h('option', { value: '' }, firstLabel),
      options.map((o) => h('option', { value: o.value }, o.label)));
    sel.value = current || '';
    return sel;
  }

  function draw() {
    if (!plan) return;
    const kids = [];
    const generic = plan.kind === 'generic';
    // ---- what was read
    if (plan.missing) {
      kids.push(h('p', { class: 'neg', style: 'margin:0' }, `看不出「${plan.missing.join('、')}」是哪一欄。請在下面的「欄位對應」自己指定。`));
    } else {
      const range = plan.date_from ? `，日期 ${plan.date_from} ～ ${plan.date_to}` : '';
      kids.push(h('p', { style: 'margin:0' }, h('b', null, `讀到 ${plan.total} 筆${range}`), '。',
        plan.duplicates ? ` 其中 ${plan.duplicates} 筆已經在帳本裡，會略過。` : '',
        plan.will_import ? ` 會新增 ${plan.will_import} 筆。` : ' 沒有可新增的紀錄。'));
    }
    // ---- accounts
    if (plan.accounts && plan.accounts.length) {
      const rows = plan.accounts.map((a) => {
        const target = opts.account_map[a.source] || '';
        const pickAcct = mappingSelect(plan.existing_accounts.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase()).map((x) => ({ value: x.name, label: `改用現有的「${x.name}」（${x.currency}）` })),
          target, (v) => { if (v) opts.account_map[a.source] = v; else delete opts.account_map[a.source]; reload(); },
          a.exists && !target ? `沿用現有帳戶「${a.name}」` : `新增帳戶「${a.source}」`);
        const bal = a.settable ? h('label', { class: 'field' }, h('span', null, '目前實際餘額（選填）'),
          h('input', { type: 'text', inputmode: 'decimal', placeholder: '例如 12000', value: opts.balances[a.name] || '',
            oninput: (e) => { opts.balances[a.name] = e.target.value; } })) : null;
        return h('div', { class: 'imp-acct' },
          h('div', null, h('b', null, a.source), `　${a.count} 筆，${a.currency || ''} 淨額 `, h('span', { class: a.net < 0 ? 'neg' : '' }, num(a.net, a.currency || 'TWD', true, true))),
          pickAcct, bal);
      });
      kids.push(h('div', null, h('b', null, '帳戶'),
        h('p', { class: 'hint', style: 'margin:2px 0 8px' }, generic
          ? '舊的記帳軟體沒有把帳戶餘額放進檔案。請填各帳戶「現在實際有多少錢」，Tallomi 會自動推算期初餘額；不填的話，餘額會等於這批紀錄的淨額（可能是負的），之後也能到帳戶頁修改。'
          : '帳戶餘額以 accounts.json 為準；沒有的話以 CSV 最後一筆的餘額為準。'),
        h('div', { class: 'imp-list' }, rows)));
    }
    // ---- categories
    if (plan.categories && plan.categories.length) {
      const opt = plan.existing_categories.map((c) => ({ value: c, label: `改成「${c}」` }));
      kids.push(h('details', null, h('summary', { style: 'cursor:pointer;font-weight:500' }, `分類（${plan.categories.length} 種）— 想改名或合併再展開`),
        h('p', { class: 'hint', style: 'margin:6px 0' }, '預設沿用原本的分類名稱。也可以把它改成你帳本裡已有的分類；要改成全新的名稱，匯入後到「分類」頁改名即可。'),
        h('div', { class: 'imp-list' }, plan.categories.map((c) => {
          const cur = opts.category_map[c.source] || '';
          return h('div', { class: 'imp-acct' }, h('div', null, h('b', null, c.source), `　${c.count} 筆`),
            mappingSelect(opt.filter((o) => o.value !== c.source), cur, (v) => { if (v) opts.category_map[c.source] = v; else delete opts.category_map[c.source]; reload(); }, `保留「${c.name}」`));
        }))));
    }
    // ---- special rows
    if (generic && (plan.adjust || opts.diff_adjust === false)) {
      const cb = h('input', { type: 'checkbox', checked: opts.diff_adjust, onchange: () => { opts.diff_adjust = cb.checked; reload(); } });
      kids.push(h('label', { class: 'row-inline' }, cb, h('span', null, h('b', null, '把「Difference／差額」當作餘額調整'), '（不算進收入或支出，只讓帳戶餘額對得上）')));
    }
    // ---- columns
    if (generic) {
      const cols = plan.columns || {};
      const headers = plan.headers.map((x) => ({ value: x, label: x }));
      kids.push(h('details', { open: plan.missing ? true : null }, h('summary', { style: 'cursor:pointer;font-weight:500' }, '欄位對應'),
        h('div', { class: 'imp-list', style: 'margin-top:8px' }, plan.fields.map((f) => h('label', { class: 'field' }, h('span', null, f.label + (f.required ? '（必填）' : '')),
          mappingSelect(headers, cols[f.key], (v) => { if (v) opts.columns[f.key] = v; else opts.columns[f.key] = ''; reload(); }, '（沒有這一欄）'))))));
    }
    // ---- sample
    if (plan.sample && plan.sample.length) {
      kids.push(h('details', null, h('summary', { style: 'cursor:pointer;font-weight:500' }, '預覽前幾筆'),
        h('div', { class: 'imp-list', style: 'margin-top:8px' }, plan.sample.map((r) => h('div', { class: 'imp-acct' },
          h('div', null, `${(r.time || '').replace('T', ' ').slice(0, 16)}　${IMPORT_TYPE_NAME[r.type] || r.type}　${r.category || ''}`),
          h('div', { class: 'muted' }, `${r.account}　${r.amount}${r.note ? '　' + r.note : ''}`))))));
    }
    if (plan.invalid && plan.invalid.length) kids.push(h('div', null, h('b', null, `${plan.invalid.length} 列會被略過`), list(plan.invalid)));
    if (plan.warnings && plan.warnings.length) kids.push(h('div', null, h('b', null, '提醒'), list(plan.warnings)));
    body.replaceChildren(...kids);
    if (btn) { btn.textContent = importBtnLabel(); btn.disabled = !plan.will_import && !Object.keys(opts.balances).length; }
  }

  let btn = null;
  const dlg = openDialog({
    title: '匯入資料', wide: true, body,
    primary: {
      label: '匯入',
      run: async (d) => {
        if (!plan || plan.missing) throw new Error('還有必要的欄位沒有對應');
        const rep = await ask('/api/import/commit');
        d.close(); await refresh(); importReportDialog(rep);
        const typed = Object.values(opts.balances).some((v) => String(v).trim());
        if (!typed && plan.kind === 'generic') toast('匯入完成。檔案裡沒有帳戶餘額，請到「帳戶」頁確認各帳戶的餘額', false);
        return false;
      },
    },
  });
  btn = dlg.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  reload();
}
