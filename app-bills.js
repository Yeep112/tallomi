/* Split bills: one person pays for a table of friends; every friend pays back on their own.
   My own share is an ordinary expense (category, items); each friend's share only needs a name, an amount and the day they will pay back.
   The 代墊 page shows each bill as one card (billCard); the record form opens the bill box (openBillDialog).
   Only functions here: nothing touches `S` until a page is drawn. */
'use strict';

function ymdPlusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const splitDigits = (ccy) => (ccy === 'TWD' ? 0 : digits(ccy));
const toAmount = (v) => { const x = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };

// Equal split of `total` between `n` people in the currency's smallest unit; whatever does not divide goes to the first person.
function splitEqually(total, n, ccy) {
  const d = splitDigits(ccy), unit = 10 ** d, cents = Math.round(total * unit), each = Math.floor(cents / n), extra = cents - each * n;
  return { each: each / unit, first: (each + extra) / unit };
}

function openBillDialog(seed = {}) {
  const accs = activeAccounts();
  const b = { type: 'expense', title: seed.title || '', account_id: seed.account_id || (accs[0] && accs[0].id), time: seed.time || nowLocal().slice(0, 16), category: seed.category || '',
    mineAmount: '', mineNote: seed.note || '', total: '', withMe: true, due: '', shares: [{ name: '', amount: '', due: '' }, { name: '', amount: '', due: '' }], photos: [], receipts: [], dropped: [] };
  const ccyOf = () => (acct(b.account_id) || {}).currency || S.st.base;
  const summary = h('p', { class: 'bill-sum', 'aria-live': 'polite' });
  const list = h('div', { class: 'bill-people' });
  const friends = (S.st.friend_names || {}).friends || [], lastBill = (S.st.friend_names || {}).last_bill || [];
  const chips = h('div', { class: 'bill-friends' });
  const ccyTags = [];

  const updateSum = () => {
    const mine = toAmount(b.mineAmount), others = b.shares.reduce((s, x) => s + toAmount(x.amount), 0), c = ccyOf();
    summary.replaceChildren(h('b', null, `總共付 ${num(Math.round((mine + others) * 100) / 100, c)} ${c}`),
      h('span', { class: 'hint' }, `　我 ${num(mine, c)}　＋　朋友 ${b.shares.length} 位 ${num(Math.round(others * 100) / 100, c)}`));
    ccyTags.forEach((t) => { t.textContent = c; });
  };
  const paintPeople = () => {
    list.replaceChildren(...b.shares.map((s, i) => h('div', { class: 'bill-person' },
      h('input', { class: 'bp-name', placeholder: `朋友 ${i + 1} 的名字`, maxlength: 40, autocomplete: 'off', value: s.name, 'aria-label': `第 ${i + 1} 位朋友的名字`, oninput: (e) => { s.name = e.target.value; }, onchange: () => paintChips() }),
      h('input', { class: 'bp-amt amt', inputmode: 'decimal', placeholder: '金額', autocomplete: 'off', value: s.amount, 'aria-label': `${s.name || '第 ' + (i + 1) + ' 位'}要還的金額`, oninput: (e) => { s.amount = e.target.value; updateSum(); } }),
      h('input', { class: 'bp-due', type: 'date', value: s.due, title: '預計還錢日（可不填）', 'aria-label': `${s.name || '第 ' + (i + 1) + ' 位'}預計還錢日`, onchange: (e) => { s.due = e.target.value; } }),
      h('button', { class: 'btn sm ghost', type: 'button', title: '移除這位', 'aria-label': `移除第 ${i + 1} 位`, disabled: b.shares.length <= 1, onclick: () => { b.shares.splice(i, 1); paintPeople(); paintChips(); updateSum(); } }, '×'))));
  };
  const totalIn = h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '帳單總額', 'aria-label': '帳單總額', oninput: (e) => { b.total = e.target.value; } });
  const dueAll = h('input', { type: 'date', 'aria-label': '全部人預計還錢日', onchange: (e) => { b.due = e.target.value; b.shares.forEach((s) => { s.due = b.due; }); paintPeople(); } });
  const mineAmt = h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '我的消費（沒有就留空）', 'aria-label': '我自己的消費金額', value: b.mineAmount, oninput: (e) => { b.mineAmount = e.target.value; updateSum(); } });

  // People paid for before: tap a name to add them (tap again to take them off); "上次的朋友" brings the whole group of the last bill.
  const has = (n) => b.shares.some((s) => s.name.trim() === n);
  const toggleFriend = (n) => {
    if (has(n)) { b.shares = b.shares.filter((s) => s.name.trim() !== n); if (!b.shares.length) b.shares.push({ name: '', amount: '', due: b.due }); }
    else { const empty = b.shares.find((s) => !s.name.trim() && !String(s.amount).trim()); if (empty) { empty.name = n; if (!empty.due) empty.due = b.due; } else b.shares.push({ name: n, amount: '', due: b.due }); }
    paintPeople(); paintChips(); updateSum();
  };
  const paintChips = () => {
    if (!friends.length) { chips.replaceChildren(h('span', { class: 'hint' }, '第一次分帳：直接在下面填朋友的名字。記過之後，常一起吃飯的人會列在這裡，下次點一下就帶入。')); return; }
    chips.replaceChildren(h('span', { class: 'hint' }, '常一起的朋友，點一下加入：'),
      ...(lastBill.length > 1 ? [h('button', { class: 'btn sm', type: 'button', title: lastBill.join('、'), onclick: () => { lastBill.forEach((n) => { if (!has(n)) toggleFriend(n); }); } }, `上次的 ${lastBill.length} 位`)] : []),
      ...friends.map((n) => h('button', { class: 'chip-pick' + (has(n) ? ' on' : ''), type: 'button', 'aria-pressed': String(has(n)), onclick: () => toggleFriend(n) }, n)));
  };
  // The friends' category starts the same as mine (empty = same as mine) and can be changed on its own.
  const fm = { type: 'expense', category: '' };
  const fCat = catField(fm);
  const fInput = fCat.querySelector('input[name=category]');
  const syncCat = () => { if (fInput) fInput.placeholder = b.category ? `同我的：${b.category}` : '未分類'; };
  const equalSplit = () => {
    const total = toAmount(b.total);
    if (!(total > 0)) { toast('先在「帳單總額」填總金額', true); return; }
    const n = b.shares.length + (b.withMe ? 1 : 0), { each, first } = splitEqually(total, n, ccyOf());
    if (b.withMe) { b.mineAmount = String(first); mineAmt.value = b.mineAmount; b.shares.forEach((s) => { s.amount = String(each); }); }
    else b.shares.forEach((s, i) => { s.amount = String(i === 0 ? first : each); });
    paintPeople(); updateSum();
  };

  const txt = (label, props) => h('label', { class: 'field' }, h('span', null, label), h('input', { autocomplete: 'off', ...props }));
  const body = h('div', { class: 'rows bill-box', style: 'padding:0;max-width:none' },
    h('div', { class: 'grid2' },
      txt('這一餐／這筆是什麼', { maxlength: 60, placeholder: '例如：週五聚餐、生日聚會', value: b.title, 'aria-label': '帳單名稱', oninput: (e) => { b.title = e.target.value; } }),
      h('label', { class: 'field' }, h('span', null, '從哪個帳戶付的'), h('select', { onchange: (e) => { b.account_id = +e.target.value; updateSum(); } },
        accs.map((a) => h('option', { value: a.id, selected: a.id === b.account_id }, `${a.name}（${a.currency}）`)))),
      h('label', { class: 'field' }, h('span', null, '時間'), h('input', { type: 'datetime-local', value: b.time, oninput: (e) => { b.time = e.target.value; } }))),
    h('fieldset', { class: 'bill-set' }, h('legend', null, '我自己的消費（算我的支出）'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, '金額', h('small', { class: 'ccy-tag hint' }, ` ${ccyOf()}`)), mineAmt),
        catField(b),
        txt('備註（可不填）', { maxlength: 500, placeholder: '例如：牛排、啤酒', value: b.mineNote, oninput: (e) => { b.mineNote = e.target.value; } })),
      null),
    h('fieldset', { class: 'bill-set' }, h('legend', null, '朋友（向他們收，不算我的支出）'),
      h('div', { class: 'bill-tools' },
        h('label', { class: 'field bill-total' }, h('span', null, '帳單總額（要平均分時填）'), totalIn),
        h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { b.withMe = e.target.checked; } }), h('span', null, '我也要分')),
        h('button', { class: 'btn sm', type: 'button', onclick: equalSplit }, '平均分'),
        h('span', { class: 'bill-due-all' }, h('span', { class: 'hint' }, '全部預計還錢日'), dueAll,
          h('span', { class: 'bill-quick' }, [[7, '一週'], [14, '兩週'], [30, '一個月']].map(([n, l]) => h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { dueAll.value = ymdPlusDays(n); dueAll.dispatchEvent(new Event('change')); } }, l))))),
      h('div', { class: 'bill-friendcat' }, fCat),
      chips, list,
      h('div', null, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { b.shares.push({ name: '', amount: '', due: b.due }); paintPeople(); const ins = list.querySelectorAll('.bp-name'); if (!onTouch()) ins[ins.length - 1].focus(); } }, '＋ 再加一位'))),
    summary,
    photoField(b),
    h('p', { class: 'hint', style: 'margin:0' }, '朋友只要填名字、金額和預計還錢日，不用知道他們吃了什麼。錢會一次從帳戶扣掉；每位朋友還錢時到「代墊」頁按「收款」，選轉進哪個帳戶，全部收齊這張帳單就結案。'));
  body.querySelectorAll('.ccy-tag').forEach((t) => ccyTags.push(t));
  body.addEventListener('input', syncCat); body.addEventListener('click', () => setTimeout(syncCat, 0)); body.addEventListener('focusout', () => setTimeout(syncCat, 0)); syncCat();
  paintPeople(); paintChips(); updateSum();
  let reopening = false;
  const clearAll = () => { reopening = true; dlg.close(); openBillDialog({ account_id: b.account_id, host: seed.host }); };
  const dlg = openDialog({ title: '分帳：我先付，大家各自還', wide: true, body,
    extraFoot: h('button', { class: 'btn ghost', type: 'button', style: 'margin-right:auto', onclick: clearAll }, '清除重填'),
    primary: { label: '記下這張帳單', run: async () => {
      const shares = b.shares.filter((s) => s.name.trim() || String(s.amount).trim());
      if (!shares.length) throw new Error('請至少填一位朋友的名字和金額');
      const bad = shares.findIndex((s) => !s.name.trim() || !(toAmount(s.amount) > 0));
      if (bad >= 0) throw new Error(`${shares[bad].name.trim() || '有一位朋友'}：請填名字和大於 0 的金額`);
      const res = await api('POST', '/api/bills', { title: b.title, time: b.time || undefined, account_id: b.account_id,
        mine: { amount: String(b.mineAmount || '').replace(/,/g, ''), category: b.category, note: b.mineNote },
        share_category: fm.category,
        shares: shares.map((s) => ({ name: s.name.trim(), amount: String(s.amount).replace(/,/g, ''), due: s.due || '' })) });
      const lost = await uploadPhotos(res.primary_id, b);
      S.advTab = 'open';
      await afterChange(lost ? `已記下，但有 ${lost} 張照片沒存成功` : `已記下這張帳單：向 ${shares.length} 位朋友收款`);
    } } });
  // Opened from the record box: recording, cancelling or tapping outside all go straight back to the page the record box was opened from.
  dlg.addEventListener('close', () => { if (!reopening && seed.host && seed.host.isConnected) seed.host.close(); });
  return dlg;
}

// ---- the card on the 代墊 page. `row(item)` draws one friend's line (the same one the single advances use).
function billCard(bill, row, pickIds) {
  const c = bill.currency, doneAll = bill.state === 'done';
  const pct = bill.count ? Math.round(bill.paid_count / bill.count * 100) : 0;
  const late = !doneAll && bill.shares.some((s) => s.due_in != null && s.due_in < 0 && (s.state === 'open' || s.state === 'partial'));
  const rename = () => {
    const input = h('input', { maxlength: 60, autocomplete: 'off', value: bill.title, 'aria-label': '帳單名稱' });
    openDialog({ title: '改帳單名稱', body: h('label', { class: 'field' }, h('span', null, '名稱'), input),
      primary: { label: '儲存', run: async () => { await api('PUT', `/api/bills/${bill.id}`, { title: input.value }); await afterChange('已改名'); } } });
  };
  const remove = async () => {
    const ok = await confirmBox({ title: `刪除整張帳單「${bill.title}」？`, confirmLabel: '刪除整張', danger: true,
      message: h('p', null, `會一起刪掉你自己的消費和 ${bill.count} 位朋友的待收款，帳戶餘額會跟著還原。刪除後 1 分鐘內可以復原。已經有人還錢的帳單，要先刪掉收款紀錄。`) });
    if (!ok) return;
    try { const r = await api('DELETE', `/api/bills/${bill.id}`); await afterChange('已刪除整張帳單', undoAction(r.undo)); } catch (e) { fail(e); }
  };
  return h('div', { class: `bill-card ${bill.state}${late ? ' late' : ''}` },
    h('div', { class: 'bill-head' },
      h('div', { class: 'bill-title' }, h('b', null, bill.title), h('span', { class: `adv-badge ${doneAll ? 'done' : 'open'}` }, doneAll ? '已收齊' : `已收 ${bill.paid_count}/${bill.count} 人`),
        bill.next_due && !doneAll ? h('span', { class: `due-mark ${late ? 'late' : ''}` }, late ? '有人逾期' : `最近 ${bill.next_due.slice(5).replace('-', '/')}`) : null,
        receiptMark({ receipts: bill.receipts })),
      h('div', { class: 'hint' }, `${shortTime(bill.time)}　${bill.account}　共付 ${num(bill.total, c)} ${c}`,
        bill.mine ? `　我 ${num(bill.mine.amount, c)}${bill.mine.category ? '（' + bill.mine.category + (bill.mine.note ? '：' + bill.mine.note : '') + '）' : bill.mine.note ? '（' + bill.mine.note + '）' : ''}` : '　我沒有消費'),
      h('div', { class: 'bill-progress' }, h('span', { class: 'bill-bar', role: 'img', 'aria-label': `已收 ${pct}%` }, h('i', { style: `width:${pct}%` })),
        h('span', { class: 'num' }, doneAll ? '全部收齊' : `還剩 ${num(bill.remaining, c)} ${c}`)),
      h('div', { class: 'bill-acts' },
        h('label', { class: 'bill-pickall', title: '勾選這張帳單的所有朋友' }, h('input', { type: 'checkbox', 'data-ids': bill.shares.map((x) => x.id).join(','), 'aria-label': `勾選「${bill.title}」的全部 ${bill.count} 位`,
          checked: bill.shares.every((x) => S.advSel && S.advSel.has(x.id)), onchange: (e) => pickIds(bill.shares.map((x) => x.id), e.target.checked) }), h('span', null, '全選')),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: rename }, '改名'),
        h('button', { class: 'btn sm ghost danger', type: 'button', onclick: remove }, '刪除整張'))),
    h('div', { class: 'bill-shares' }, bill.shares.map(row)));
}
