// Switching between my own book and the preview of what other people get (owner's copy only).
// The preview is a completely separate, empty book (only Cash); nothing of mine is in it and nothing from it reaches mine.
// Going back to my own book can be guarded with an account + password that only I know.
'use strict';

function appMode() { return (S.st && S.st.app_mode) || { mode: 'owner', can_switch: false }; }

// The strip above every page while the preview is open, and the small tag under the name.
function updateModeTag() {
  const m = appMode(), preview = m.mode === 'public';
  document.body.classList.toggle('preview-mode', preview);
  const brand = document.querySelector('.brand small');
  if (brand) brand.textContent = preview ? '用戶版預覽' : '個人帳本';
  let bar = document.getElementById('modebar');
  if (!preview) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'modebar', class: 'modebar', role: 'status' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar);
  }
  bar.replaceChildren(
    h('span', null, h('b', null, '用戶版預覽'), '　這是其他人第一次打開看到的全新帳本，和你自己的帳本完全分開。'),
    h('button', { class: 'btn sm', onclick: () => switchMode('owner') }, '回到我的帳本'));
}

// After the request went through: wait until the program is back in the other mode, then reload.
async function waitSwitched(mode) {
  const to = mode === 'public' ? '用戶版預覽' : '你的帳本';
  const note = h('p', { style: 'padding:40px;text-align:center' }, `正在切換到${to}…`);
  document.body.replaceChildren(note);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const j = await (await fetch('/api/ping', { cache: 'no-store' })).json();
      if (j && j.mode === mode) { location.reload(); return; }
    } catch (e) { /* the program is restarting */ }
    if (Date.now() - t0 > 45000) {
      note.textContent = '切換花的時間比預期久。請稍等，或把 Tallomi 完全結束後再用蜂巢 T 捷徑開啟。';
      return;
    }
  }
}

async function switchMode(mode, reset = false) {
  if (mode === 'owner' && appMode().lock_set) {            // back to the real book: account + password first
    const acc = h('input', { type: 'text', autocomplete: 'off', 'aria-label': '帳號' });
    const pw = h('input', { type: 'password', autocomplete: 'off', 'aria-label': '密碼' });
    let done = false;
    const dlg = openDialog({
      title: '回到你的帳本', body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
        h('p', { class: 'muted', style: 'margin:0' }, '請輸入你設定的帳號與密碼。'),
        h('label', { class: 'field' }, h('span', null, '帳號'), acc), h('label', { class: 'field' }, h('span', null, '密碼'), pw)),
      primary: { label: '切換', run: async () => { await api('POST', '/api/app-mode', { mode, account: acc.value, password: pw.value }); done = true; } },
    });
    await new Promise((resolve) => dlg.addEventListener('close', resolve));
    if (done) waitSwitched(mode);
    return;
  }
  const ok = await confirmBox({
    title: mode === 'public' ? '切換到用戶版預覽？' : '回到你的帳本？',
    message: h('div', null,
      h('p', null, mode === 'public'
        ? '程式會重新啟動（約 5～10 秒），然後顯示一個全新的空白帳本，只有 Cash，就像其他人第一次開啟。'
        : '程式會重新啟動（約 5～10 秒），然後回到你自己的帳本。'),
      h('p', { class: 'muted' }, '兩邊的資料完全分開，切換不會動到任何一邊的紀錄。' + (reset ? '預覽裡目前的紀錄會被清空，從頭開始。' : ''))),
    confirmLabel: '切換',
    danger: !!reset,
  });
  if (!ok) return;
  try { await api('POST', '/api/app-mode', { mode, reset }); } catch (e) { fail(e); return; }
  waitSwitched(mode);
}

// Set / change / remove the account + password that guard the way back.
function ownerLockDialog() {
  const m = appMode();
  const acc = h('input', { type: 'text', autocomplete: 'off', value: m.lock_account || '', 'aria-label': '帳號' });
  const cur = m.lock_set ? h('input', { type: 'password', autocomplete: 'off', 'aria-label': '目前的密碼' }) : null;
  const pw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '新密碼' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '再輸入一次新密碼' });
  const apply = (info) => { S.st.app_mode.lock_set = info.set; S.st.app_mode.lock_account = info.account; renderRoute(); };
  openDialog({
    title: m.lock_set ? '變更切回帳本的帳號密碼' : '設定切回帳本的帳號密碼',
    body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('p', { class: 'muted', style: 'margin:0' }, '設定後，從「用戶版預覽」回到你自己的帳本時要輸入。至少 6 個字的密碼；忘記時請在電腦上刪除資料夾裡的 owner_lock.json。'),
      h('label', { class: 'field' }, h('span', null, '帳號'), acc),
      cur ? h('label', { class: 'field' }, h('span', null, '目前的密碼'), cur) : null,
      h('label', { class: 'field' }, h('span', null, '新密碼'), pw), h('label', { class: 'field' }, h('span', null, '再輸入一次'), pw2)),
    primary: { label: '儲存', run: async () => {
      if (pw.value !== pw2.value) throw new Error('兩次輸入的密碼不一樣');
      apply(await api('PUT', '/api/owner-lock', { account: acc.value, password: pw.value, current_password: cur && cur.value }));
      toast('已儲存');
    } },
  });
}

function removeOwnerLockDialog() {
  const cur = h('input', { type: 'password', autocomplete: 'off', 'aria-label': '目前的密碼' });
  openDialog({
    title: '移除帳號密碼', body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('p', { class: 'muted', style: 'margin:0' }, '移除後，任何人都能從用戶版預覽直接回到你的帳本。'), h('label', { class: 'field' }, h('span', null, '目前的密碼'), cur)),
    primary: { label: '移除', danger: true, run: async () => {
      const info = await api('PUT', '/api/owner-lock', { remove: true, current_password: cur.value });
      S.st.app_mode.lock_set = info.set; S.st.app_mode.lock_account = info.account; renderRoute(); toast('已移除');
    } },
  });
}

// Settings page card. Only the owner's copy has it.
function modeSection() {
  const m = appMode();
  if (!m.can_switch) return null;
  const preview = m.mode === 'public';
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '切換版本')),
    h('div', { class: 'rows' },
      h('p', { style: 'margin-top:0' }, preview
        ? h('span', null, h('b', null, '目前：用戶版預覽'), h('br'), h('span', { class: 'muted' }, '這是給其他人用的全新帳本，只有 Cash，沒有你的帳戶、持股或試算表連結。這裡記的資料和你的帳本完全分開，不會同步到你的帳本。'))
        : h('span', null, h('b', null, '目前：我的帳本'), h('br'), h('span', { class: 'muted' }, '想看其他人第一次打開 Tallomi 會看到什麼，可以切到「用戶版預覽」：一個全新的空白帳本，和你的帳本完全分開，隨時可以切回來。'))),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        preview
          ? [h('button', { class: 'btn primary', onclick: () => switchMode('owner') }, '回到我的帳本'),
             h('button', { class: 'btn danger', onclick: () => switchMode('public', true) }, '清空預覽，重新開始')]
          : h('button', { class: 'btn', onclick: () => switchMode('public') }, '切換到用戶版預覽')),
      preview ? null : h('div', { style: 'margin-top:16px' },
        h('p', { style: 'margin:0 0 8px' }, h('b', null, '切回帳本的帳號密碼：'), m.lock_set ? `已設定（帳號 ${m.lock_account}）` : '未設定',
          h('br'), h('span', { class: 'muted' }, '設定後，從預覽回到你的帳本要輸入帳號密碼，別人拿到預覽畫面也進不了你的帳本。')),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: ownerLockDialog }, m.lock_set ? '變更帳號密碼' : '設定帳號密碼'),
          m.lock_set ? h('button', { class: 'btn danger', onclick: removeOwnerLockDialog }, '移除') : null))));
}
