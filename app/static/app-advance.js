/* Paying for a friend / paying first and being reimbursed ("代墊" and "銷帳"), and quick templates.
   Only functions here: nothing touches `S` until a page is drawn (app.js loads after this file). */
'use strict';

const ADV_LABEL = { friend: '幫朋友付', claim: '先付待報帳' };
const ADV_STATE = { open: '待收', partial: '收了一部分', done: '已收齊', off: '不收了' };

// ---- the part of the entry form that makes an expense an advance
function knownParties() {
  const set = new Set();
  ((S.st.friend_names || {}).friends || []).forEach((n) => set.add(n));
  (S.st.owed || []).forEach((g) => set.add(g.counterparty));
  (S.st.templates || []).forEach((t) => t.counterparty && set.add(t.counterparty));
  return [...set];
}
function advanceField(m, redraw) {
  if (m.type !== 'expense') return null;
  const kind = m.advance || '';
  const pick = h('select', { 'aria-label': '這筆是不是代墊', onchange: (e) => {
    if (e.target.value === 'split') {                                       // several friends, each pays back on their own: the bill box
      e.target.value = m.advance || '';
      openBillDialog({ account_id: m.account_id, time: m.time, category: m.category, note: m.note, host: e.target.closest('dialog') });
      return;
    }
    m.advance = e.target.value;
    if (m.advance) { const claim = m.advance === 'claim'; m.no_budget = claim; m.no_stats = claim; } else { m.counterparty = ''; m.no_budget = false; m.no_stats = false; }     // sensible defaults, still changeable
    redraw();
  } }, [['', '自己的支出'], ['friend', '幫朋友付（之後向他收）'], ['split', '幫大家付，每人各自還（分帳）…'], ['claim', '先付款，之後報帳']].map(([v, l]) => h('option', { value: v, selected: v === kind }, l)));
  const out = [h('label', { class: 'field half' }, h('span', null, '這筆是'), pick)];
  if (kind) {
    const names = h('datalist', { id: 'adv-names' }, knownParties().map((n) => h('option', { value: n })));
    out.push(h('label', { class: 'field half' }, h('span', null, kind === 'friend' ? '幫誰付的' : '向誰報帳（公司、客戶…）'),
      h('input', { name: 'counterparty', autocomplete: 'off', maxlength: 40, list: 'adv-names', value: m.counterparty || '', placeholder: kind === 'friend' ? '朋友的名字' : '例如：公司', 'aria-label': '對象', oninput: (e) => { m.counterparty = e.target.value; } }), names));
    const ymdPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const due = h('input', { type: 'date', name: 'due', value: m.due || '', 'aria-label': '預計收回日', oninput: (e) => { m.due = e.target.value; }, onchange: () => { if (!m.due) m.auto_settle = ''; redraw(); } });
    out.push(h('div', { class: 'field half adv-due' }, h('span', null, '預計收回日（選填）'), due,
      h('span', { class: 'adv-quick' }, [[7, '一週後'], [14, '兩週後'], [30, '一個月後']].map(([n, l]) => h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { m.due = ymdPlus(n); due.value = m.due; redraw(); } }, l)),
        m.due ? h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { m.due = ''; due.value = ''; m.auto_settle = ''; redraw(); } }, '不設') : null)));
    if (m.due) {
      const orig = acct(m.account_id), same = activeAccounts().filter((a) => orig && a.currency === orig.currency);
      const on = !!m.auto_settle;
      out.push(h('div', { class: 'field grow adv-auto' },
        h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { m.auto_settle = e.target.checked ? ((same.find((a) => a.id === m.account_id) || same[0] || {}).id || '') : ''; redraw(); } }),
          h('span', null, '到了預計收回日，自動記成已收款（不用再按「收款」）')),
        on ? h('label', { class: 'adv-auto-acct' }, h('span', { class: 'hint' }, '還到哪個帳戶　'), h('select', { 'aria-label': '自動入帳的帳戶', onchange: (e) => { m.auto_settle = +e.target.value; } },
          same.map((a) => h('option', { value: a.id, selected: a.id === Number(m.auto_settle) }, a.name)))) : null,
        on ? h('span', { class: 'hint' }, `${m.due} 當天（或之後第一次打開程式時）會自動記一筆收款，這筆就結案。${m.no_stats ? '收款不算收入。' : '收款會算成收入。'}`) : null));
    }
    out.push(h('div', { class: 'field grow adv-opts' },
      h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: !!m.no_budget, onchange: (e) => { m.no_budget = e.target.checked; } }), h('span', null, '不計入預算')),
      h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: !!m.no_stats, onchange: (e) => { m.no_stats = e.target.checked; } }), h('span', null, '不計入收支統計與報表')),
      h('span', { class: 'hint' }, (m.no_stats ? '錢還是會從帳戶扣掉；對方還錢時，到「代墊」頁記一筆收款就會沖銷，收款不會算成收入。' : '錢直接算成你的支出；對方還錢時，到「代墊」頁記一筆收款，收款會算成收入，並進你選的帳戶。'))));
  }
  return h('div', { class: 'adv-box grow' }, ...out);
}

// "3/20 到期" / "今天到期" / "逾期 5 天"
function dueText(t) {
  if (!t.due || t.due_in == null) return '';
  if (t.due_in < 0) return `逾期 ${-t.due_in} 天`;
  if (t.due_in === 0) return '今天到期';
  return `${t.due.slice(5).replace('-', '/')} 到期`;
}
function dueMark(t, inline) {
  const txt = dueText(t); if (!txt) return null;
  return h('span', { class: `due-mark ${t.due_in < 0 ? 'late' : t.due_in <= 3 ? 'soon' : ''}${inline ? ' inline' : ''}` }, inline ? `・${txt}` : txt);
}
// a red count on the 代墊 link while something is overdue
function updateAdvBadge() {
  const n = ((S.st && S.st.owed_alerts) || {}).overdue || 0;
  document.querySelectorAll('a[data-route="advances"]').forEach((a) => {
    let b = a.querySelector('.nav-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = h('span', { class: 'nav-badge', 'aria-hidden': 'true' }); a.append(b); }
    b.textContent = String(n); a.title = `${n} 筆代墊已逾期`;
  });
}

// ---- small marks in the transaction list
function advBadge(t) {
  if (t.settle_of) return h('span', { class: 'adv-badge back', title: '代墊的收款' }, `收款${t.counterparty ? '·' + t.counterparty : ''}`);
  if (!t.advance) return null;
  const left = t.remaining != null && t.state !== 'done' && t.state !== 'off' ? `　${num(t.remaining, t.currency)}` : '';
  const late = t.due_in != null && t.due_in < 0;
  return h('span', { class: `adv-badge ${t.state || ''}${late ? ' late' : ''}`, title: `${ADV_LABEL[t.advance]}　${ADV_STATE[t.state] || ''}${t.due ? '　預計 ' + t.due.slice(5).replace('-', '/') + ' 收回' : ''}` },
    `${t.advance === 'friend' ? '代墊' : '待報帳'}·${t.counterparty} ${ADV_STATE[t.state] || ''}${left}`, t.due_in != null ? dueMark(t, true) : null);
}

// ---- record a payment that came back
// which account each person's money usually lands in, so the next repayment starts there
function repayMemory() { try { return JSON.parse(localStorage.getItem('pw_repay_acct') || '{}') || {}; } catch (e) { return {}; } }
function rememberRepay(who, id) { try { const m = repayMemory(); m[who] = id; localStorage.setItem('pw_repay_acct', JSON.stringify(m)); } catch (e) { /* private mode: fine */ } }
function openSettle(it) {
  const same = activeAccounts().filter((a) => a.currency === it.currency);
  const last = (it.payments || []).slice().sort((a, b) => (a.time < b.time ? 1 : -1))[0], mem = repayMemory()[it.counterparty];
  const pick = [mem, last && last.account_id, it.account_id].find((id) => id != null && same.some((a) => a.id === id));
  const m = { amount: String(it.remaining), account_id: pick != null ? pick : (same[0] || {}).id, time: nowLocal().slice(0, 16), note: '' };
  openDialog({
    title: `${it.advance === 'friend' ? '收回' : '報帳入帳'}：${it.counterparty}`,
    body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('p', { class: 'hint', style: 'margin:0' }, `${shortTime(it.time)}　${it.note || it.category}　墊了 ${num(it.amount, it.currency)} ${it.currency}，已收 ${num(it.repaid, it.currency)}，還剩 ${num(it.remaining, it.currency)}。`),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, `這次收到（${it.currency}）`), h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', value: m.amount, 'aria-label': '收到的金額', oninput: (e) => { m.amount = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '還到哪個帳戶'), h('select', { 'aria-label': '還到哪個帳戶', onchange: (e) => { m.account_id = +e.target.value; } }, same.map((a) => h('option', { value: a.id, selected: a.id === m.account_id }, a.name)))),
        h('label', { class: 'field' }, h('span', null, '時間'), h('input', { type: 'datetime-local', value: m.time, oninput: (e) => { m.time = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '備註（可不填）'), h('input', { autocomplete: 'off', maxlength: 200, oninput: (e) => { m.note = e.target.value; } }))),
      h('p', { class: 'hint', style: 'margin:0' }, `分幾次收也可以，收齊後這筆就會移到「已結清」。收款會增加你選的帳戶的餘額，${it.no_stats ? '但不會算成收入（這筆代墊沒有計入收支統計）。' : '並算成一筆收入（代墊當初算成支出，收回來就抵回去）。'}`)),
    primary: { label: '記下收款', run: async () => {
      const r = await api('POST', `/api/advances/${it.id}/settle`, { amount: m.amount, account_id: m.account_id, time: m.time || undefined, note: m.note });
      rememberRepay(it.counterparty, m.account_id);
      await afterChange(r.closed ? '已收齊，這筆結清了' : '已記下收款');
    } },
  });
}

async function writeOff(it) {
  const ok = await confirmBox({ title: '不收了？', confirmLabel: '不收了', danger: true,
    message: h('p', null, `${it.counterparty} 還欠 ${num(it.remaining, it.currency)} ${it.currency}。選「不收了」後，這筆會變成你自己的支出（計入收支統計與預算）。之後可以重新開啟。`) });
  if (!ok) return;
  try { await api('POST', `/api/advances/${it.id}/write-off`); await afterChange('已改成自己的支出'); } catch (e) { fail(e); }
}

// ---- the page
async function viewAdvances(view) {
  const tab = S.advTab || (S.advTab = 'open'), kindF = S.advKind || (S.advKind = '');
  const d = await api('GET', `/api/advances?state=${tab}`);
  const items = d.items.filter((x) => !kindF || x.advance === kindF);
  const bills = kindF === 'claim' ? [] : (d.bills || []);                  // split bills are always paid-for-friends
  const money1 = (list) => list.map((r) => `${num(r.amount, r.currency)} ${r.currency}`).join('、');
  const intro = pageIntro('幫朋友先付錢，或自己先墊、之後要報帳的花費，記在這裡追蹤。一桌人一起吃飯由你先付，按「分帳」一次記下每個人的份；對方還錢時按「收款」，選還到哪個帳戶（幫朋友付的算成支出，收回來算成收入；先付款待報帳的兩邊都不算）；記錯了，在收款那一行直接改帳戶。報帳可以設預計收到款項的日期，到那天自動記成已收款。逾期會在這裡、總覽和左邊選單提醒。');
  view.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, '代墊與報帳', eyeButton('advances'), intro.btn),
    intro.p),
    h('div', { class: 'page-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openBillDialog({}) }, '＋ 分帳'))));
  if (d.uncounted_friends) {
    view.append(h('section', { class: 'section adv-convert' }, h('p', { class: 'hint', style: 'margin:0 0 .5rem' },
      `有 ${d.uncounted_friends} 筆「幫朋友付」是用舊規則記的（不計入收支統計與預算）。現在幫朋友付直接算成你的支出，朋友還錢時算成收入。要把舊的也改成一樣嗎？已收的款項會跟著一起改。`),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const ok = await confirmBox({ title: '改成直接計入？', confirmLabel: '全部改成計入', message: h('p', null, `${d.uncounted_friends} 筆幫朋友付的款項會改成計入收支統計與預算，已收回的款項也會算成收入。之後可以逐筆再勾回「不計入」。`) });
        if (!ok) return;
        try { const r = await api('POST', '/api/advances/count-friends', { on: true }); await afterChange(`已改好 ${r.changed} 筆`); } catch (e) { fail(e); }
      } }, '全部改成計入')));
  }
  if (tab === 'open') {
    const parties = d.by_party.filter((g) => !kindF || g.advance === kindF);
    view.append(h('section', { class: 'section' }, parties.length
      ? h('div', { class: 'adv-cards' }, parties.map((g) => h('div', { class: 'adv-card' }, h('b', null, g.counterparty), h('span', { class: 'hint' }, `${ADV_LABEL[g.advance]}　${g.count} 筆`, g.overdue ? h('b', { class: 'due-mark late' }, `　${g.overdue} 筆逾期`) : null),
        h('span', { class: 'adv-owed num' }, money1(g.remaining.map((r) => ({ amount: r.amount, currency: r.currency })))))))
      : h('div', { class: 'empty' }, h('b', null, '目前沒有待收的款項'), '記一筆支出時選「幫朋友付」或「先付款，之後報帳」，就會列在這裡。')));
  }
  const seg = (list, cur, set, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, list.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(cur === k), onclick: () => { set(k); renderRoute(); } }, l)));
  S.advSel = S.advSel || new Set();
  const selBar = h('div', { class: 'adv-selbar', role: 'region', 'aria-label': '已勾選的項目', hidden: true });
  const everyId = () => [...bills.flatMap((b) => b.shares.map((x) => x.id)), ...items.map((x) => x.id)];
  const paintBar = () => {
    const n = S.advSel.size, all = everyId();
    selBar.hidden = !n;
    selBar.replaceChildren(h('b', null, `已勾選 ${n} 筆`),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { all.forEach((id) => S.advSel.add(id)); syncRows(); } }, `全選（${all.length}）`),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { S.advSel.clear(); syncRows(); } }, '取消勾選'),
      h('button', { class: 'btn sm danger solid', type: 'button', onclick: deleteSelected }, `刪除 ${n} 筆`));
  };
  const syncRows = () => {
    view.querySelectorAll('.adv-row[data-id]').forEach((el) => { const on = S.advSel.has(+el.dataset.id); el.classList.toggle('picked', on); const cb = el.querySelector('.adv-pick input'); if (cb) cb.checked = on; });
    view.querySelectorAll('.bill-pickall input').forEach((cb) => { const ids = cb.dataset.ids.split(',').map(Number); cb.checked = ids.every((id) => S.advSel.has(id)); });
    paintBar();
  };
  const pickIds = (ids, on) => { ids.forEach((id) => (on ? S.advSel.add(id) : S.advSel.delete(id))); syncRows(); };
  const deleteSelected = async () => {
    const ids = [...S.advSel];
    const ok = await confirmBox({ title: `刪除勾選的 ${ids.length} 筆？`, confirmLabel: '刪除', danger: true,
      message: h('p', null, '這些代墊連同它們已記下的收款會一起刪除，帳戶餘額會跟著還原。刪除後 1 分鐘內可以復原。') });
    if (!ok) return;
    try { const r = await api('POST', '/api/advances/delete', { ids }); S.advSel.clear(); await afterChange(`已刪除 ${r.deleted} 筆`, undoAction(r.undo)); } catch (e) { fail(e); }
  };
  const row = (it) => {
    const open = it.state === 'open' || it.state === 'partial';
    const edit = () => openTxDialog(it);
    const box = h('div', { class: 'adv-row' + (it.due_in != null && it.due_in < 0 ? ' late' : '') + (S.advSel.has(it.id) ? ' picked' : ''), 'data-id': String(it.id) },
      h('label', { class: 'adv-pick', title: '勾選' }, h('input', { type: 'checkbox', checked: S.advSel.has(it.id), 'aria-label': `勾選 ${it.counterparty} ${num(it.amount, it.currency)}`,
        onchange: (e) => { if (e.target.checked) S.advSel.add(it.id); else S.advSel.delete(it.id); syncRows(); } })),
      h('div', { class: 'adv-main', role: 'button', tabindex: '0', title: '點一下編輯這筆', onclick: edit, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } } },
        h('div', null, h('b', null, it.counterparty), h('span', { class: `adv-badge ${it.state}` }, `${ADV_LABEL[it.advance]}·${ADV_STATE[it.state]}`), dueMark(it), receiptMark(it)),
        h('div', { class: 'hint' }, `${shortTime(it.time)}　${it.category}${it.note ? '　' + it.note : ''}　${it.account}`)),
      h('div', { class: 'adv-nums num', onclick: edit }, 
        h('div', null, `${num(it.amount, it.currency)} ${it.currency}`),
        h('div', { class: 'hint' }, it.repaid ? `已收 ${num(it.repaid, it.currency)}` : '', open ? `　剩 ${num(it.remaining, it.currency)}` : '')),
      h('div', { class: 'adv-acts' },
        open ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => openSettle(it) }, '收款') : null,
        open ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => writeOff(it) }, '不收了') : null,
        it.state === 'off' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await api('POST', `/api/advances/${it.id}/reopen`); await afterChange('已重新開啟'); } catch (e) { fail(e); } } }, '重新開啟') : null));
    const delPay = async (p) => {
      const ok = await confirmBox({ title: '刪除這筆收款？', confirmLabel: '刪除', danger: true, message: h('p', null, '帳戶餘額會跟著減少，這筆代墊會回到還沒收的狀態。') });
      if (!ok) return;
      try { await api('DELETE', `/api/transactions/${p.id}`); await afterChange('已刪除收款'); } catch (e) { fail(e); }
    };
    // where a repayment landed can be changed right here (the same currency as the advance); the amount, time and note stay
    const moveRepay = async (p, accId) => {
      try {
        await api('PUT', `/api/transactions/${p.id}`, { type: 'income', account_id: accId, amount: String(p.amount), category: p.category, note: p.note, time: p.time, tags: (p.tags || []).join(' ') });
        await afterChange(`已改成還到「${(acct(accId) || {}).name || ''}」`);
      } catch (e) { fail(e); await refresh().catch(() => {}); }
    };
    if (it.payments.length) {
      box.append(h('ul', { class: 'adv-pays' }, it.payments.map((p) => {
        const choices = activeAccounts().filter((a) => a.currency === p.currency).concat(acct(p.account_id) && acct(p.account_id).archived ? [acct(p.account_id)] : []);
        return h('li', null,
          h('span', { class: 'pay-line', role: 'button', tabindex: '0', title: '點一下編輯這筆收款', onclick: () => openTxDialog(p), onkeydown: (e) => { if (e.key === 'Enter') openTxDialog(p); } },
            `${shortTime(p.time)}　收到 ${num(p.amount, p.currency)} ${p.currency}　${p.settle_from ? p.settle_from + ' → ' : ''}`),
          choices.length > 1 || (choices.length === 1 && choices[0].id !== p.account_id) ? h('select', { class: 'pay-acct', 'aria-label': `${shortTime(p.time)} 這筆收款還到哪個帳戶`, title: '還到哪個帳戶',
            onchange: (e) => { const to = +e.target.value; if (to !== p.account_id) moveRepay(p, to); } },
            choices.map((a) => h('option', { value: a.id, selected: a.id === p.account_id }, a.name))) : h('span', null, p.account),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => delPay(p) }, '刪除'));
      })));
    }
    return box;
  };
  const ids = new Set(everyId()); S.advSel.forEach((id) => { if (!ids.has(id)) S.advSel.delete(id); });
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, tab === 'open' ? '待收的款項' : '已結清'),
      h('span', { class: 'head-btns' }, seg([['open', '待收'], ['done', '已結清']], tab, (k) => { S.advTab = k; }, '狀態'), seg([['', '全部'], ['friend', '朋友'], ['claim', '報帳']], kindF, (k) => { S.advKind = k; }, '種類'))),
    selBar,
    bills.length ? h('div', { class: 'bill-list' }, bills.map((b) => billCard(b, row, pickIds))) : null,
    items.length ? h('div', { class: 'adv-list' }, items.map(row)) : (bills.length ? null : h('div', { class: 'empty' }, h('b', null, tab === 'open' ? '沒有待收的項目' : '還沒有結清的項目')))));
  paintBar();
}

// ---- quick templates: a favourite entry that fills the form with one tap
function applyTemplate(m, t) {
  const usable = (id) => id && acct(id) && !acct(id).archived;
  Object.assign(m, { type: t.type, category: t.category || '', note: t.note || '', amount: t.amount || '', tags: t.tags || '', advance: t.advance || '', counterparty: t.counterparty || '', due: '', auto_settle: '',
    no_budget: !!t.no_budget, no_stats: !!t.no_stats });
  if (usable(t.account_id)) m.account_id = t.account_id;
  if (t.type === 'transfer') { if (usable(t.to_account_id)) m.to_account_id = t.to_account_id; } else m.to_account_id = m.to_account_id || null;
  m.to_amount = '';
}
// A template that asks for the amount (the setting, or no amount saved): tapping it opens a small box that asks only the amount and records
// the entry. Any other template just fills the form, as before.
const asksAmount = (t) => !!t.ask_amount || (!t.auto && !String(t.amount || '').trim());
function useTemplate(m, t, redraw) {
  if (!asksAmount(t)) { applyTemplate(m, t); redraw(true); return; }
  askAmountDialog(m, t, redraw);
}
function askAmountDialog(m, t, redraw) {
  const host = document.querySelector('dialog[open]');                    // the "add an entry" box the template was tapped in, if any (closed once the entry is recorded)
  applyTemplate(m, t); m.amount = '';
  const a = acct(m.account_id), ccy = a ? a.currency : S.st.base;
  const suggest = String(t.amount || '').trim();
  const input = h('input', { class: 'amt', name: 'ask_amount', inputmode: 'decimal', autocomplete: 'off', placeholder: suggest || '0', 'aria-label': '這次的金額' });
  const fillForm = (dlg) => { dlg.close(); redraw(true); };               // not now: leave the template in the form to change anything first
  const dlg = openDialog({
    title: `${t.name}：這次多少？`,
    body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('p', { class: 'hint', style: 'margin:0' }, `${TYPE_LABEL[t.type]}${t.category ? '　' + t.category : ''}　${a ? a.name : ''}${t.note ? '　' + t.note : ''}`),
      h('label', { class: 'field' }, h('span', null, `金額（${ccy}）`), input),
      suggest ? h('div', null, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { input.value = suggest; input.form.requestSubmit(); } }, `用上次的 ${suggest}`)) : null),
    extraFoot: h('button', { class: 'btn ghost', type: 'button', style: 'margin-right:auto', onclick: () => fillForm(dlg) }, '改用完整表單'),
    primary: { label: '記下', run: async () => {
      const v = input.value.trim();
      if (!v) throw new Error('請輸入這次的金額');
      m.amount = v;
      await recordEntry(m);
      await refresh();
      if (host && host.isConnected) host.close();
    } } });
  return dlg;
}
// 清除帶入資料: empty everything a template (or typing) filled in. The kind, the account, the day and any photos stay.
function clearFilled(m) {
  Object.assign(m, { amount: '', to_amount: '', note: '', category: '', tags: pinnedTags(), advance: '', counterparty: '', due: '', auto_settle: '', no_budget: false, no_stats: false, save_tpl: false, tpl_ask: false, repeat: false });
}
function clearButton(m, redraw) {
  return h('button', { class: 'btn sm ghost', type: 'button', title: '把金額、類別、備註、標籤、代墊設定都清空，重新開始（類型、帳戶、日期不變）',
    onclick: () => { clearFilled(m); redraw(true); toast('已清除帶入的資料'); } }, '清除帶入資料');
}
function templatePayload(m, name) {
  return { name, type: m.type, category: m.type === 'transfer' ? '' : m.category, note: m.note, amount: String(m.amount || '').replace(/,/g, ''), account_id: m.account_id, to_account_id: m.type === 'transfer' ? m.to_account_id : null,
    tags: m.tags || '', advance: m.type === 'expense' ? (m.advance || '') : '', counterparty: m.counterparty || '', no_budget: !!m.no_budget, no_stats: !!m.no_stats, ask_amount: !!m.tpl_ask };
}
// Save the entry being typed as a quick template (the same kind of entry is updated instead of added twice).
async function saveEntryAsTemplate(m) {
  const t = templatePayload(m, (m.note || m.category || TYPE_LABEL[m.type]).trim().slice(0, 30));
  const same = (S.st.templates || []).find((x) => x.type === t.type && (x.category || '') === (t.category || '') && (x.note || '').trim() === (t.note || '').trim() && x.account_id == t.account_id);
  if (same) { await api('PUT', `/api/templates/${same.id}`, { ...t, name: same.name }); return '更新'; }
  await api('POST', '/api/templates', t); return '存成';
}

// 管理: saved templates and everything typed before. "帶入" only fills the form; nothing is recorded until the person presses 記下.
function openTemplateManager(m, redraw) {
  const q = h('input', { type: 'search', placeholder: '搜尋範本或記過的交易', 'aria-label': '搜尋', autocomplete: 'off' });
  const box = h('div', { class: 'tpl-manage' });
  let past = null, changed = false, dlg = null, hiddenN = 0;
  const text = (t) => `${TYPE_LABEL[t.type]}${t.category ? '　' + t.category : ''}${asksAmount(t) ? '　每次問金額' + (t.amount ? '（上次 ' + t.amount + '）' : '') : t.amount ? '　' + t.amount : ''}${t.advance ? '　' + ADV_LABEL[t.advance] + '·' + t.counterparty : ''}`;
  const hit = (t, k) => !k || `${t.name} ${t.note} ${t.category} ${t.counterparty} ${t.tags}`.toLowerCase().includes(k);
  const fill = (t) => { dlg.close(); applyTemplate(m, t); redraw(true); toast('已帶入表單，確認後按「記下」才會記入'); };
  const row = (t, ...btns) => h('div', { class: 'tpl-row' + (t.auto ? '' : ' saved'), 'data-id': t.auto ? null : String(t.id) },
    t.auto ? null : h('button', { class: 'tpl-grip', type: 'button', title: '拖曳換順序（也可以用鍵盤的上下鍵）', 'aria-label': `調整「${t.name}」的順序：按住拖曳，或用上下鍵`,
      onpointerdown: (e) => dragRow(e, e.currentTarget.closest('.tpl-row')),
      onkeydown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(t, e.key === 'ArrowUp' ? -1 : 1, true); } } }, '≡'),
    t.type === 'expense' || t.type === 'income' ? catChip(t.category || '未分類', 'sm') : null,
    h('div', { class: 'tpl-main' }, h('b', null, t.name), h('span', { class: 'hint' }, text(t) + (t.auto && t.count > 1 ? `　記過 ${t.count} 次` : ''))),
    h('span', { class: 'tpl-btns' }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => fill(t) }, '帶入'), ...btns));
  const saveOrder = async (next) => {
    try { await api('PUT', '/api/templates/order', { ids: next.map((x) => x.id) }); S.st.templates = next; changed = true; } catch (e) { fail(e); }
  };
  const nudge = async (t, d, keepFocus) => {
    const all = S.st.templates, i = all.findIndex((x) => x.id === t.id), j = i + d;
    if (i < 0 || j < 0 || j >= all.length) return;
    const next = [...all]; [next[i], next[j]] = [next[j], next[i]];
    await saveOrder(next); paint();
    if (keepFocus) { const g = box.querySelector(`.tpl-row[data-id="${t.id}"] .tpl-grip`); if (g) g.focus(); }
  };
  // drag a saved template by its ≡ handle: the row follows the pointer, the list is saved when it is dropped
  const dragRow = (e, rowEl) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget, body = box.closest('.dlg-body');
    const rows = () => [...box.querySelectorAll('.tpl-row.saved')];
    const before = rows().map((r) => r.dataset.id).join(',');
    const pid = e.pointerId; rowEl.classList.add('dragging');                // listen on the document: moving the row in the page would drop a pointer capture
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      if (body) { const r = body.getBoundingClientRect(); if (ev.clientY < r.top + 36) body.scrollBy(0, -12); else if (ev.clientY > r.bottom - 36) body.scrollBy(0, 12); }
      for (const o of rows()) {
        if (o === rowEl) continue;
        const r = o.getBoundingClientRect();
        if (ev.clientY > r.top && ev.clientY < r.bottom) {
          const list = rows(); if (list.indexOf(rowEl) < list.indexOf(o)) o.after(rowEl); else o.before(rowEl);
          break;
        }
      }
    };
    const up = async (ev) => {
      if (ev && ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      rowEl.classList.remove('dragging');
      const order = rows().map((r) => r.dataset.id);
      if (order.join(',') === before) return;
      const all = S.st.templates, shown = order.map((i) => all.find((x) => String(x.id) === i)), slots = all.map((x, i) => (shown.includes(x) ? i : -1)).filter((i) => i >= 0);
      const next = [...all]; slots.forEach((slot, k) => { next[slot] = shown[k]; });
      await saveOrder(next); paint();
    };
    document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  };
  const rename = (t) => {                                                  // name, amount, and whether tapping it asks for the amount
    const name = h('input', { maxlength: 30, autocomplete: 'off', value: t.name, 'aria-label': '範本名稱' });
    const amount = h('input', { inputmode: 'decimal', autocomplete: 'off', value: t.amount || '', placeholder: '留空 = 每次問金額', 'aria-label': '範本金額' });
    const ask = h('input', { type: 'checkbox', checked: asksAmount(t) });
    openDialog({ title: '編輯範本', body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('label', { class: 'field' }, h('span', null, '範本名稱'), name),
      h('label', { class: 'field' }, h('span', null, '金額'), amount),
      h('label', { class: 'row-inline' }, ask, h('span', null, '點這個範本時先問金額（填的金額只當作「用上次的…」的建議）')),
      h('p', { class: 'hint', style: 'margin:0' }, '不勾選：點一下就把金額填進表單。勾選或金額留空：點一下會跳出只問金額的小視窗，輸入後直接記下。')),
      primary: { label: '儲存', run: async () => {
        const nm = name.value.trim(); if (!nm) throw new Error('請幫範本取個名字');
        const { id, ...rest } = t;
        const amt = amount.value.replace(/,/g, '').trim();
        await api('PUT', `/api/templates/${t.id}`, { ...rest, name: nm, amount: amt, ask_amount: ask.checked || !amt });
        t.name = nm; t.amount = amt; t.ask_amount = ask.checked || !amt; changed = true; paint();
      } } });
  };
  const paint = () => {
    const k = q.value.trim().toLowerCase(), saved = (S.st.templates || []).filter((t) => hit(t, k));
    const old = (past || []).filter((t) => hit(t, k));
    box.replaceChildren(
      h('h4', { class: 'tpl-h' }, `我的範本（${saved.length}）`),
      ...(saved.length ? saved.map((t) => row(t,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => rename(t) }, '編輯'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try { await api('DELETE', `/api/templates/${t.id}`); S.st.templates = S.st.templates.filter((x) => x.id !== t.id); changed = true; load(); } catch (e) { fail(e); }
        } }, '刪除'))) : [h('p', { class: 'hint' }, k ? '沒有符合的範本。' : '還沒有範本。記帳時勾選「記下後存成範本」，或從下面記過的交易按「存成範本」。')]),
      h('h4', { class: 'tpl-h' }, past ? `記過的交易（${old.length}）` : '記過的交易'),
      ...(past === null ? [h('p', { class: 'hint' }, '讀取中…')] : old.length ? old.map((t) => row(t,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try { await api('POST', '/api/templates', t); changed = true; await load(); } catch (e) { fail(e); }
        } }, '存成範本'),
        h('button', { class: 'btn sm ghost', type: 'button', title: '以後不在範本列和這裡顯示這個', onclick: async () => {
          try { await api('POST', '/api/frequent/hide', { key: t.key }); changed = true; await load(); } catch (e) { fail(e); }
        } }, '不再顯示'))) : [h('p', { class: 'hint' }, k ? '沒有符合的交易。' : '還沒有記過的交易。')]),
      hiddenN ? h('p', { class: 'hint' }, `已隱藏 ${hiddenN} 筆　`, h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        try { await api('POST', '/api/frequent/restore'); changed = true; await load(); } catch (e) { fail(e); }
      } }, '恢復全部')) : null);
  };
  const load = async () => {
    try {
      const [tp, fq] = await Promise.all([api('GET', '/api/templates'), api('GET', '/api/frequent?limit=100')]);
      S.st.templates = tp.items; past = fq.items; hiddenN = fq.hidden || 0;
    } catch (e) { fail(e); past = past || []; }
    paint();
  };
  q.addEventListener('input', paint);
  dlg = openDialog({ title: '範本與記過的交易', wide: true, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('p', { class: 'hint', style: 'margin:0' }, '按「帶入」只會把資料填進記帳表單，不會直接記入；確認金額、日期後再按「記下」。'), q, box) });
  dlg.addEventListener('close', () => { if (changed) refresh(); });
  paint(); load();
}

function templateBar(m, redraw) {
  const list = S.st.templates || [];
  const past = (S.st.frequent || []).filter((t) => t.type === m.type || !m.type);       // typed before: offered without saving anything
  const chip0 = (t) => h('button', { type: 'button', class: 'tpl-chip' + (t.auto ? ' auto' : ''),
    title: `${t.auto ? `記過 ${t.count} 次：` : ''}${t.name}：${TYPE_LABEL[t.type]}${t.category ? '　' + t.category : ''}${asksAmount(t) ? '　點一下會先問金額' : t.amount ? '　' + t.amount : ''}`,
    onclick: () => useTemplate(m, t, redraw) }, t.type === 'expense' || t.type === 'income' ? catChip(t.category || '未分類', 'sm') : null, h('span', { class: 'tpl-name' }, t.name), asksAmount(t) ? h('i', { class: 'ask' }, '問金額') : t.amount ? h('i', null, t.amount) : null);
  const chip = (t) => !t.auto ? chip0(t) : h('span', { class: 'tpl-chip-wrap' }, chip0(t),
    h('button', { type: 'button', class: 'tpl-x', title: '不要再顯示這個', 'aria-label': `不要再顯示「${t.name}」`, onclick: async () => {
      try { await api('POST', '/api/frequent/hide', { key: t.key }); S.st.frequent = (S.st.frequent || []).filter((x) => x.key !== t.key); toast('不會再顯示這個；想找回來，到「管理」按「恢復全部」'); redraw(); } catch (e) { fail(e); }
    } }, '×'));
  const askBox = h('input', { type: 'checkbox', checked: !!m.tpl_ask, disabled: !m.save_tpl, onchange: (e) => { m.tpl_ask = e.target.checked; } });
  return h('div', { class: 'tpl-bar', role: 'group', 'aria-label': '快速範本' },
    h('span', { class: 'tpl-label' }, '範本'),
    h('span', { class: 'tpl-chips' }, list.map(chip), past.length ? h('span', { class: 'tpl-sep', title: '以前記過的交易，點一下就帶入', 'aria-label': '以前記過的' }, '記過') : null, past.map(chip),
      list.length || past.length ? null : h('span', { class: 'hint' }, '記過的交易會自動出現在這裡，點一下就帶入')),
    h('details', { class: 'tpl-more', open: !!(m.save_tpl || m.repeat || m.tpl_ask) || !!m.tplOpen, ontoggle: (e) => { m.tplOpen = e.target.open; } }, h('summary', null, '存成範本、每月自動記'), h('span', { class: 'tpl-tools' },
    h('label', { class: 'tpl-save', title: '輸入好這筆交易後勾選，按「記下」時會一併存成快速範本' },
      h('input', { type: 'checkbox', checked: !!m.save_tpl, onchange: (e) => { m.save_tpl = e.target.checked; askBox.disabled = !m.save_tpl; } }), '記下後存成範本'),
    h('label', { class: 'tpl-save', title: '存成的範本以後點一下會先問金額，不會直接帶入這次的金額' }, askBox, '每次問金額'),
    h('label', { class: 'tpl-save', title: '記下這一筆後，之後每個月同一天自動再記一筆（房租、訂閱、保費…）。到「設定 → 定期交易」可以暫停或修改。' },
      h('input', { type: 'checkbox', checked: !!m.repeat, onchange: (e) => { m.repeat = e.target.checked; } }), '之後每月自動記'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openTemplateManager(m, redraw) }, '管理'))),
    clearButton(m, redraw));
}
