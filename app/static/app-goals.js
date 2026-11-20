/* 1.67.0 — 儲蓄目標 and 月度回顧.
   Savings goals: a name, an amount, an optional deadline, and either an account (the goal is "what is in the account", or "what has been added since
   today" with 從現在起算) or an amount kept by hand. The home page shows a card per goal; 管理目標 adds, edits and deletes them.
   Month review: one card at the start of the month for the month before (biggest categories, change from the month before, unusually large entries);
   the same body opens in a dialog for any month. Both read their numbers from the server (/api/goals, /api/review): the maths lives in goals.py / reports.py.
   Only functions here: nothing touches `S` until a page is drawn. */
'use strict';

const GOAL_STATUS = {
  done: ['達成了', 'pos'], on_track: ['進度正常', 'pos'], behind: ['有點落後', 'warn'], overdue: ['期限已過', 'neg'], open: ['', ''],
};
const goalDay = (iso) => (iso ? iso.replace(/-/g, '/') : '');
const reviewLabel = (ym) => `${ym.slice(0, 4)} 年 ${+ym.slice(5)} 月`;
function shiftYm(ym, d) { const n = +ym.slice(0, 4) * 12 + (+ym.slice(5) - 1) + d; return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`; }
const thisYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const pctText = (p) => (p == null || !isFinite(p) ? '' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(0)}%`);

// ------------------------------------------------------------------ goals
function goalCard(g, { onEdit } = {}) {
  const [stText, stCls] = GOAL_STATUS[g.status] || ['', ''], c = g.currency;
  const bar = h('div', { class: 'goal-bar ' + (g.done ? 'done' : stCls), role: 'progressbar', 'aria-label': `${g.name} 進度`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(g.pct * 100)) },
    h('i', { style: `width:${(g.pct * 100).toFixed(1)}%` }));
  const lines = [];
  if (g.done) lines.push(h('span', { class: 'pos' }, '已經存到目標金額了'));
  else {
    lines.push(h('span', null, `還差 ${num(g.left, c)} ${c}`));
    if (g.deadline) {
      if (g.status === 'overdue') lines.push(h('span', { class: 'neg' }, `期限 ${goalDay(g.deadline)} 已過`));
      else lines.push(h('span', null, `期限 ${goalDay(g.deadline)}（剩 ${g.days_left} 天）`));
      if (g.need_month != null) lines.push(h('span', { class: 'goal-need' }, `每月要存 ${num(g.need_month, c)} ${c}`));
    }
    if (g.pace_month != null) lines.push(h('span', { class: 'muted' }, `近 90 天每月約存 ${num(g.pace_month, c, true)}`));
    if (g.forecast) lines.push(h('span', { class: 'muted' }, `照這個速度約 ${goalDay(g.forecast)} 達成`));
    else if (g.pace_month != null && g.pace_month <= 0) lines.push(h('span', { class: 'muted' }, '近期沒有在增加，無法預估'));
  }
  const where = g.account ? `${g.account}${g.from_now ? '（從設定那天起算）' : ''}` : '手動記錄';
  return h('div', { class: 'goal-card' + (onEdit ? ' tap' : '') },
    h('div', { class: 'goal-top' }, h('b', { class: 'goal-name' }, g.name), stText ? h('span', { class: `goal-st ${stCls}` }, stText) : null,
      h('span', { class: 'goal-nums' }, `${num(g.saved, c)} / ${num(g.target, c)}`, h('span', { class: 'ccy' }, c))),
    bar,
    h('div', { class: 'goal-lines' }, ...lines),
    h('div', { class: 'goal-where hint' }, where, g.note ? `　${g.note}` : ''),
    onEdit ? h('button', { class: 'btn sm ghost goal-edit', type: 'button', 'aria-label': `編輯「${g.name}」`, onclick: () => onEdit(g) }, '編輯') : null);
}

async function goalsBlock() {
  let r;
  try { r = await api('GET', '/api/goals'); } catch (e) { return null; }        // the home page must still draw when this cannot be read
  if (!r.goals.length) {
    return h('section', { class: 'section goals-card goals-empty' },
      h('div', { class: 'section-head' }, h('h2', null, '儲蓄目標'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openGoalDialog(null, r) }, '設定目標')),
      h('p', { class: 'hint' }, '想存一筆旅行、買車或緊急預備金？設定金額和期限，連到帳戶，這裡會顯示進度和每月該存多少。'));
  }
  const shown = r.goals.slice(0, 4);
  return h('section', { class: 'section goals-card' },
    h('div', { class: 'section-head' }, h('h2', null, '儲蓄目標'), h('span', { class: 'head-btns' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openGoalsManager() }, r.goals.length > shown.length ? `管理（共 ${r.goals.length} 個）` : '管理目標'))),
    h('div', { class: 'goal-list' }, shown.map((g) => goalCard(g))));
}

async function openGoalsManager() {
  let r = await api('GET', '/api/goals');
  const list = h('div', { class: 'goal-list' });
  const paint = () => {
    list.replaceChildren(...(r.goals.length ? r.goals.map((g) => goalCard(g, { onEdit: (x) => openGoalDialog(x, r, async () => { r = await api('GET', '/api/goals'); paint(); }) }))
      : [h('div', { class: 'empty' }, h('b', null, '還沒有儲蓄目標'), '按「新增目標」，設定金額和期限。')]));
  };
  paint();
  openDialog({
    title: '儲蓄目標', wide: true,
    body: h('div', { class: 'goals-manage' }, h('p', { class: 'hint' }, '目標可以連到一個帳戶（帳戶裡的錢就是已存的），也可以自己手動記一個已存金額。有期限的目標會算出每月該存多少，並和你近 90 天實際存的速度比較。'), list),
    extraFoot: h('button', { class: 'btn', type: 'button', onclick: () => openGoalDialog(null, r, async () => { r = await api('GET', '/api/goals'); paint(); }) }, '新增目標'),
  });
}

function openGoalDialog(g, data, onDone) {
  const accs = (data && data.accounts) || activeAccounts().map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const base = S.st.base;
  const m = { name: g ? g.name : '', target: g ? String(g.target) : '', deadline: g ? g.deadline : '', account_id: g ? (g.account_id || '') : '', from_now: g ? g.from_now : false,
    saved: g && !g.account_id ? String(g.saved) : '', note: g ? g.note : '', currency: g ? g.currency : base };
  const ccyOf = () => { const a = accs.find((x) => String(x.id) === String(m.account_id)); return a ? a.currency : m.currency; };
  const ccyTag = h('span', { class: 'ccy' }, ccyOf());
  const manualBox = h('label', { class: 'field' }, h('span', null, '已經存了多少'), h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: m.saved, oninput: (e) => { m.saved = e.target.value; } }));
  const nowBox = h('label', { class: 'row-inline goal-from' }, h('input', { type: 'checkbox', checked: m.from_now, onchange: (e) => { m.from_now = e.target.checked; } }),
    h('span', null, '從現在起算（帳戶裡原有的錢不算進去，只算之後多存的）'));
  const sync = () => { ccyTag.textContent = ccyOf(); manualBox.hidden = !!m.account_id; nowBox.hidden = !m.account_id; };
  const body = h('div', { class: 'rows', style: 'padding:0;max-width:none' },
    h('label', { class: 'field' }, h('span', null, '目標名稱'), h('input', { maxlength: 40, autocomplete: 'off', placeholder: '例如：日本旅行、緊急預備金', value: m.name, oninput: (e) => { m.name = e.target.value; } })),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, '目標金額'), h('span', { class: 'row-inline' }, h('input', { class: 'amt', inputmode: 'decimal', autocomplete: 'off', placeholder: '例如 100000', value: m.target, oninput: (e) => { m.target = e.target.value; } }), ccyTag)),
      h('label', { class: 'field' }, h('span', null, '期限（可不填）'), h('input', { type: 'date', value: m.deadline, onchange: (e) => { m.deadline = e.target.value; } }))),
    h('label', { class: 'field' }, h('span', null, '存在哪個帳戶'), h('select', { onchange: (e) => { m.account_id = e.target.value; sync(); } },
      h('option', { value: '' }, '不連到帳戶（我自己記）'), accs.map((a) => h('option', { value: a.id, selected: String(a.id) === String(m.account_id) }, `${a.name}（${a.currency}）`)))),
    nowBox, manualBox,
    h('label', { class: 'field' }, h('span', null, '備註（可不填）'), h('input', { maxlength: 200, autocomplete: 'off', value: m.note, oninput: (e) => { m.note = e.target.value; } })));
  sync();
  const finish = async (msg) => { if (onDone) await onDone(); await afterChange(msg); };
  openDialog({
    title: g ? '編輯儲蓄目標' : '新增儲蓄目標', body,
    extraFoot: g ? h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
      if (!window.confirm(`刪除目標「${g.name}」？帳戶裡的錢與交易不受影響。`)) return;
      try { await api('DELETE', `/api/goals/${g.id}`); e.target.closest('dialog').close(); await finish('已刪除目標'); } catch (err) { fail(err); }
    } }, '刪除') : null,
    primary: { label: g ? '儲存' : '新增', run: async () => {
      const p = { name: m.name, target: m.target, deadline: m.deadline, note: m.note };
      if (m.account_id) { p.account_id = +m.account_id; p.from_now = !!m.from_now; } else { p.account_id = null; p.currency = m.currency; p.saved = m.saved || '0'; }
      if (g) await api('PUT', `/api/goals/${g.id}`, p); else await api('POST', '/api/goals', p);
      await finish(g ? '已儲存目標' : '已新增目標');
    } },
  });
}

// ------------------------------------------------------------------ month review
function reviewDelta(x, goodWhenUp) {
  if (x.prev === 0 && x.total === 0) return null;
  if (x.prev === 0) return h('small', { class: 'rv-delta muted' }, '上個月沒有');
  const up = x.change > 0, cls = x.change === 0 ? 'muted' : (up === goodWhenUp ? 'pos' : 'neg');
  return h('small', { class: `rv-delta ${cls}` }, `比上月${up ? '多' : '少'} ${num(Math.abs(x.change), S.st.base)}（${pctText(x.pct)}）`);
}

function reviewBody(r, { full } = {}) {
  const base = r.base;
  if (!r.has_data) return h('div', { class: 'empty' }, h('b', null, `${reviewLabel(r.month)}沒有收支紀錄`), '記了帳之後，月初這裡會整理成一張卡片。');
  const cell = (label, x, good, tone) => h('div', { class: 'rv-cell' }, h('span', { class: 'label muted' }, label),
    h('b', { class: 'num ' + (tone || '') }, num(x.total, base, label === '結餘'), h('span', { class: 'ccy' }, base)), r.has_prev ? reviewDelta(x, good) : null);
  const kids = [h('div', { class: 'rv-stats' }, cell('支出', r.expense, false), cell('收入', r.income, true), cell('結餘', r.net, true, r.net.total >= 0 ? 'pos' : 'neg'))];
  const top = full ? r.top : r.top.slice(0, 3);
  if (top.length) {
    const max = Math.max(...top.map((t) => t.total), 1);
    kids.push(h('div', { class: 'rv-block' }, h('h3', null, '花最多的類別'),
      h('ol', { class: 'rv-top' }, top.map((t) => h('li', null,
        h('div', { class: 'rv-top-row' }, catChip(t.category, 'sm'), h('b', null, t.category),
          h('span', { class: 'rv-top-amt num' }, num(t.total, base), h('small', { class: 'muted' }, `　${(t.share * 100).toFixed(0)}%`))),
        h('div', { class: 'rv-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${(t.total / max * 100).toFixed(1)}%` })),
        r.has_prev ? h('div', { class: 'rv-top-d' }, t.new ? h('small', { class: 'muted' }, '這個月新出現的類別')
          : h('small', { class: t.change > 0 ? 'neg' : t.change < 0 ? 'pos' : 'muted' }, t.change === 0 ? '和上月一樣' : `比上月${t.change > 0 ? '多' : '少'} ${num(Math.abs(t.change), base)}（${pctText(t.pct)}）`)) : null)))));
  }
  const odd = full ? r.unusual : r.unusual.slice(0, 3);
  if (odd.length) {
    kids.push(h('div', { class: 'rv-block' }, h('h3', null, '比平常大的支出'),
      h('ul', { class: 'rv-odd' }, odd.map((u) => h('li', null,
        h('span', { class: 'rv-odd-main' }, h('b', null, u.note || u.category), h('small', { class: 'muted' }, `　${u.category}　${u.time.slice(5, 10).replace('-', '/')}　${u.account}`)),
        h('span', { class: 'num neg' }, num(u.amount, base)),
        h('small', { class: 'muted rv-odd-x' }, u.times ? `約是這類平常的 ${u.times.toFixed(1)} 倍` : '')))),
      full ? h('p', { class: 'hint' }, '「比平常大」是和這個類別前 6 個月的單筆金額相比（至少要有 3 筆紀錄才會比）。房租之類固定的大額不會被列進來。') : null));
  }
  if (r.missing_rates && r.missing_rates.length) kids.push(h('p', { class: 'hint' }, `缺少 ${r.missing_rates.join('、')} 的匯率，這些金額沒有算進去。`));
  return h('div', { class: 'rv-body' }, ...kids);
}

// The card on the home page: only in the first ten days of a month, for the month before, until it is closed.
function reviewSeen() { try { return localStorage.getItem('pw_review_seen') || ''; } catch (e) { return ''; } }
function reviewMarkSeen(ym) { try { localStorage.setItem('pw_review_seen', ym); } catch (e) { /* private mode */ } }
async function reviewBlock() {
  const now = new Date(), ym = shiftYm(thisYm(), -1);
  if (now.getDate() > 10 || reviewSeen() >= ym) return null;
  let r;
  try { r = await api('GET', `/api/review?month=${ym}`); } catch (e) { return null; }
  if (!r.has_data) return null;
  const card = h('section', { class: 'section review-card' },
    h('div', { class: 'section-head' }, h('h2', null, `${+ym.slice(5)} 月回顧`), h('span', { class: 'head-btns' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { reviewMarkSeen(ym); card.remove(); } }, '知道了'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openReviewDialog(ym) }, '看完整回顧'))),
    reviewBody(r));
  return card;
}

async function openReviewDialog(ym) {
  ym = ym || shiftYm(thisYm(), -1);
  const box = h('div', { class: 'rv-wrap' }), title = h('span', { class: 'rv-title' });
  let dlg;
  const load = async (to) => {
    ym = to; title.textContent = reviewLabel(ym); box.replaceChildren(h('p', { class: 'hint' }, '讀取中…'));
    try { box.replaceChildren(reviewBody(await api('GET', `/api/review?month=${ym}`), { full: true })); } catch (e) { box.replaceChildren(h('div', { class: 'neg' }, e.message || String(e))); }
    nextBtn.disabled = ym >= thisYm();
  };
  const prevBtn = h('button', { class: 'btn sm', type: 'button', 'aria-label': '上一個月', onclick: () => load(shiftYm(ym, -1)) }, '◀');
  const nextBtn = h('button', { class: 'btn sm', type: 'button', 'aria-label': '下一個月', onclick: () => load(shiftYm(ym, 1)) }, '▶');
  dlg = openDialog({ title: '月度回顧', wide: true, body: h('div', null, h('div', { class: 'rv-nav' }, prevBtn, title, nextBtn), box) });
  await load(ym);
}
