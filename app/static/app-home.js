'use strict';
/* 1.60.0 — 首頁區塊可自訂: which blocks the overview shows and in what order. The choice is kept with the book (prefs.home), so the computer and the
   phone show the same home page and it survives a restored backup. The page itself is put together in viewOverview (app.js); this file knows the
   list of blocks and has the "自訂首頁" sheet. Uses helpers from app.js at run time.
   Keep HOME_BLOCKS in step with Book.HOME_BLOCKS / HOME_OFF (book.py): a test compares them. */
const HOME_BLOCKS = [
  { id: 'summary', name: '總資產與本月結餘', hint: '總資產、淨資產的組成、本月收入與支出' },
  { id: 'review', name: '月度回顧', hint: '每月初一張卡片：上個月花最多的類別、和前一個月比、比平常大的支出（只在 1～10 日出現）' },
  { id: 'networth', name: '淨資產走勢', hint: '淨資產隨時間的變化，手指劃過可看每一天', off: true },
  { id: 'reminders', name: '提醒', hint: '該記的定期收支、待收回的代墊' },
  { id: 'tiles', name: '快速記帳磚塊', hint: '依類別一點就記一筆，並顯示本月各類別金額' },
  { id: 'budget', name: '本月預算', hint: '各類別預算用了多少' },
  { id: 'goals', name: '儲蓄目標', hint: '每個目標存了多少、還差多少、每月該存多少' },
  { id: 'accounts', name: '帳戶', hint: '各帳戶的餘額磚塊，可拖曳換位置' },
  { id: 'recent', name: '最近的紀錄', hint: '最近 8 筆交易' },
];
const HOME_DEFAULT = () => ({ order: HOME_BLOCKS.map((b) => b.id), hidden: HOME_BLOCKS.filter((b) => b.off).map((b) => b.id) });

// The layout to build the page from: every block exactly once. Whatever the saved list lacks (a block that came with a newer version) goes in at
// its usual place, and starts hidden when it is one of the blocks that start hidden. (The server answers with the same rules; this keeps an
// old copy of the page, or a book that was never customised, working.)
function homeLayout() {
  const saved = (S.st && S.st.prefs && S.st.prefs.home) || null, known = HOME_BLOCKS.map((b) => b.id);
  if (!saved || !Array.isArray(saved.order)) { const d = HOME_DEFAULT(); return { order: d.order, hidden: new Set(d.hidden) }; }
  const order = saved.order.filter((id, i, a) => known.includes(id) && a.indexOf(id) === i), hidden = new Set((saved.hidden || []).filter((id) => known.includes(id)));
  known.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = known.slice(0, i).reverse().find((x) => order.includes(x));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
    if (HOME_BLOCKS[i].off) hidden.add(id);
  });
  return { order, hidden };
}

function openHomeLayoutDialog() {
  const cur = homeLayout(), draft = { order: cur.order.slice(), hidden: new Set(cur.hidden) };
  const info = (id) => HOME_BLOCKS.find((b) => b.id === id);
  const list = h('ol', { class: 'home-blocks' });
  const paint = (focusSel) => {
    list.replaceChildren(...draft.order.map((id, i) => {
      const b = info(id), off = draft.hidden.has(id);
      const move = (d) => { const j = i + d; if (j < 0 || j >= draft.order.length) return; [draft.order[i], draft.order[j]] = [draft.order[j], draft.order[i]]; paint(`[data-id="${id}"] .${d < 0 ? 'hb-up' : 'hb-down'}`); };
      return h('li', { class: 'hb-row' + (off ? ' off' : ''), 'data-id': id },
        h('label', { class: 'hb-main' },
          h('input', { type: 'checkbox', checked: !off, 'aria-label': `顯示「${b.name}」`, onchange: (e) => { if (e.target.checked) draft.hidden.delete(id); else draft.hidden.add(id); paint(`[data-id="${id}"] input`); } }),
          h('span', { class: 'hb-text' }, h('b', null, b.name), h('small', { class: 'muted' }, b.hint))),
        h('span', { class: 'hb-move' },
          h('button', { class: 'btn sm ghost hb-up', type: 'button', disabled: i === 0, 'aria-label': `把「${b.name}」往上移`, title: '往上移', onclick: () => move(-1) }, '▲'),
          h('button', { class: 'btn sm ghost hb-down', type: 'button', disabled: i === draft.order.length - 1, 'aria-label': `把「${b.name}」往下移`, title: '往下移', onclick: () => move(1) }, '▼')));
    }));
    if (focusSel) { const el = list.querySelector(focusSel + ':not([disabled])') || list.querySelector(focusSel.replace(/ \.hb-(up|down)$/, ' input')); if (el) el.focus(); }
  };
  paint();
  const same = () => { const d = HOME_DEFAULT(); return d.order.join() === draft.order.join() && d.hidden.slice().sort().join() === [...draft.hidden].sort().join(); };
  const dlg = openDialog({
    title: '自訂首頁',
    body: h('div', { class: 'home-edit' }, h('p', { class: 'hint' }, '勾選要在總覽顯示的區塊，用 ▲▼ 調整先後。沒勾的區塊不會顯示，也不會去讀它的資料。電腦與手機看到的是同一份。'), list),
    extraFoot: h('button', { class: 'btn ghost', type: 'button', onclick: () => { const d = HOME_DEFAULT(); draft.order = d.order; draft.hidden = new Set(d.hidden); paint(); } }, '還原預設'),
    primary: {
      label: '完成', run: async () => {
        const body = same() ? null : { order: draft.order.slice(), hidden: draft.order.filter((id) => draft.hidden.has(id)) };      // the usual layout is not saved at all: a later new block then takes its place by itself
        await api('PUT', '/api/settings', { home_layout: body });
        S.st.prefs.home = body || HOME_DEFAULT();
        renderRoute();
      },
    },
  });
  return dlg;
}
