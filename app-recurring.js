/* Recurring entries (rent, subscriptions, insurance...): set once, recorded automatically on the due day.
   The server does the recording (app/recurring.py); this file is the list, the editor, the "repeat from this entry" shortcut and the warning banner.
   Only functions and constants here: nothing touches `S` until a page is drawn. */
'use strict';

const RECUR_FREQ = { weekly: '每週', monthly: '每月', yearly: '每年' };
const RECUR_STATUS = { active: '', paused: '已暫停', ended: '已結束', error: '記不下去' };

const recurDay = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const recurIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The day after `iso` on which a rule starting there fires next (a 31st becomes the month's last day, then goes back to the 31st).
function nextRepeatDate(iso, freq, anchor) {
  const d = recurDay(iso), day = anchor || d.getDate();
  if (freq === 'weekly') { d.setDate(d.getDate() + 7); return recurIso(d); }
  const months = freq === 'yearly' ? 12 : 1;
  const t = new Date(d.getFullYear(), d.getMonth() + months, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return recurIso(t);
}
const recurWhen = (r) => {
  const d = recurDay(r.next_due);
  const rule = r.freq === 'weekly' ? `每週${'日一二三四五六'[d.getDay()]}` : r.freq === 'yearly' ? `每年 ${d.getMonth() + 1}/${r.anchor_day} 日` : `每月 ${r.anchor_day} 日`;
  return rule + (r.end_date ? `，到 ${r.end_date} 止` : '');
};

// "之後每月自動記" on the entry form: after the entry is recorded, make a monthly rule starting next month on the same day.
async function createRepeatRule(m) {
  const day = (m.time ? String(m.time).slice(0, 10) : nowLocal().slice(0, 10));
  const anchor = Number(day.slice(8, 10));
  const rule = { type: m.type, account_id: m.account_id, to_account_id: m.type === 'transfer' ? m.to_account_id : null,
    amount: String(m.amount).replace(/,/g, ''), category: m.category, note: m.note, tags: m.tags || '', no_budget: !!m.no_budget, no_stats: !!m.no_stats,
    freq: 'monthly', anchor_day: anchor, next_due: nextRepeatDate(day, 'monthly', anchor) };
  await api('POST', '/api/recurring', rule);
  return rule.next_due;
}

function recurringBanner() {
  const al = (S.st.recurring_alerts || []);
  if (!al.length) return null;
  return h('div', { class: 'banner late' },
    h('span', null, h('b', null, `有 ${al.length} 個定期交易記不下去：`), al.slice(0, 2).map((a) => `${a.name}（${a.error}）`).join('；'), al.length > 2 ? ' 等' : ''),
    h('button', { class: 'btn sm', type: 'button', onclick: () => openRecurringManager() }, '查看並修正'));
}

function openRecurringEditor(rule, onDone) {
  const r = rule || {};
  const accs = activeAccounts();
  const f = { type: r.type || 'expense', name: r.name || '', category: r.category || '', amount: r.amount || '', account_id: r.account_id || (accs[0] && accs[0].id),
    to_account_id: r.to_account_id || null, freq: r.freq || 'monthly', next_due: r.next_due || recurIso(new Date()), end_date: r.end_date || '', note: r.note || '' };
  const holder = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const sel = (key, opts, label, after) => h('label', { class: 'field' }, h('span', null, label),
    h('select', { onchange: (e) => { f[key] = isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value; if (after) after(); } },
      opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(f[key] == null ? '' : f[key]) }, t))));
  const txt = (key, label, props = {}) => h('label', { class: 'field' }, h('span', null, label),
    h('input', { value: f[key], autocomplete: 'off', ...props, oninput: (e) => { f[key] = e.target.value; } }));
  const draw = () => {
    const ccy = (accs.find((a) => a.id === f.account_id) || {}).currency || S.st.base;
    const cats = (f.type === 'income' ? S.st.cat_info.income : S.st.cat_info.expense) || [];
    holder.replaceChildren(
      h('div', { class: 'grid2' },
        sel('type', [['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']], '類型', draw),
        txt('name', '名稱', { maxlength: 30, placeholder: '例如：房租、Netflix、保費' }),
        f.type === 'transfer' ? null : h('label', { class: 'field' }, h('span', null, '類別'),
          h('input', { value: f.category, autocomplete: 'off', list: 'recur-cats', maxlength: 60, placeholder: '未分類', oninput: (e) => { f.category = e.target.value; } })),
        txt('amount', `金額（${ccy}）`, { inputmode: 'decimal', placeholder: '0' }),
        sel('account_id', accs.map((a) => [a.id, a.name]), f.type === 'income' ? '入帳到' : '從哪個帳戶', draw),
        f.type === 'transfer' ? sel('to_account_id', [['', '請選擇'], ...accs.filter((a) => a.id !== f.account_id).map((a) => [a.id, a.name])], '轉入') : null,
        sel('freq', Object.entries(RECUR_FREQ), '多久一次', draw),
        h('label', { class: 'field' }, h('span', null, '下一次入帳日'), h('input', { type: 'date', value: f.next_due, onchange: (e) => { f.next_due = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '結束日（可留空）'), h('input', { type: 'date', value: f.end_date, onchange: (e) => { f.end_date = e.target.value; } })),
        txt('note', '備註', { maxlength: 500 })),
      h('datalist', { id: 'recur-cats' }, cats.map((c) => h('option', { value: c }))),
      h('p', { class: 'hint', style: 'margin:0' }, f.freq === 'monthly'
        ? '每月固定日期入帳；設在 29～31 日的，遇到較短的月份會記在月底，之後又回到原本的日子。'
        : '到期當天早上 9 點入帳。電腦或手機沒開的那幾天，下次打開時會自動補記（最多補 60 筆）。'));
  };
  draw();
  return openDialog({ title: rule ? `編輯定期交易：${r.name}` : '新增定期交易', wide: true, body: holder,
    primary: { label: '儲存', run: async () => {
      const body = { ...f, amount: String(f.amount).replace(/,/g, '').trim(), to_account_id: f.type === 'transfer' ? f.to_account_id || null : null };
      if (!body.amount) throw new Error('請輸入金額');
      const res = rule ? await api('PUT', `/api/recurring/${rule.id}`, body) : await api('POST', '/api/recurring', body);
      await afterChange(res && res.posted ? `已儲存，補記了 ${res.posted} 筆` : '已儲存定期交易');
      if (onDone) onDone();
    } } });
}

async function openRecurringManager() {
  const box = h('div', { class: 'tpl-manage' });
  const dlg = openDialog({ title: '定期交易', wide: true, body: box, cancelLabel: '關閉',
    extraFoot: h('button', { class: 'btn', type: 'button', style: 'margin-right:auto', onclick: () => openRecurringEditor(null, paint) }, '＋ 新增') });
  const paint = async () => {
    let items = [];
    try { items = (await api('GET', '/api/recurring')).items; } catch (e) { box.replaceChildren(h('p', { class: 'neg' }, e.message || String(e))); return; }
    if (!items.length) { box.replaceChildren(h('p', { class: 'hint' }, '還沒有定期交易。房租、訂閱、保費這類每月固定的，設定一次就會自動入帳。按左下角的「＋ 新增」，或在記帳時勾選「之後每月自動記」。')); return; }
    box.replaceChildren(...items.map((r) => h('div', { class: 'tpl-row saved' + (r.status === 'error' ? ' bad' : '') },
      h('div', { class: 'tpl-main' },
        h('b', null, r.name, RECUR_STATUS[r.status] ? h('small', { class: r.status === 'error' ? 'neg' : 'muted' }, `　${RECUR_STATUS[r.status]}`) : null),
        h('span', { class: 'hint' }, `${TYPE_LABEL[r.type]}${r.category ? '　' + r.category : ''}　${num(Number(r.amount), r.currency)} ${r.currency}　${r.account}${r.to_account ? ' → ' + r.to_account : ''}`),
        h('span', { class: 'hint' }, `${recurWhen(r)}${r.status === 'active' ? `　下一次 ${r.next_due}` : ''}`),
        r.last_error ? h('span', { class: 'hint neg' }, `停在 ${r.next_due}：${r.last_error}。改好後按「編輯」儲存就會繼續。`) : null),
      h('span', { class: 'tpl-btns' },
        r.status === 'error' || r.status === 'ended' ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try { await api('POST', `/api/recurring/${r.id}/active`, { on: !r.active }); await afterChange(r.active ? '已暫停' : '已恢復（暫停期間的日子不補記）'); paint(); } catch (e) { fail(e); }
        } }, r.active ? '暫停' : '恢復'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openRecurringEditor(r, paint) }, '編輯'),
        h('button', { class: 'btn sm ghost danger', type: 'button', onclick: async () => {
          const ok = await confirmBox({ title: `刪除定期交易「${r.name}」？`, message: h('p', null, '之後不會再自動入帳；已經記下的交易不受影響。'), confirmLabel: '刪除', danger: true });
          if (!ok) return;
          try { await api('DELETE', `/api/recurring/${r.id}`); await afterChange('已刪除定期交易'); paint(); } catch (e) { fail(e); }
        } }, '刪除')))));
  };
  await paint();
  return dlg;
}

function recurringSection() {
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '定期交易')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '房租、訂閱、保費這類固定的收支，設定一次，到期日自動入帳。電腦或手機沒開的那幾天，下次打開時會自動補記。'),
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => openRecurringManager() }, '管理定期交易'))));
}
