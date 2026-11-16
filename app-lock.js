// The PIN lock of the book: a full-screen PIN pad that appears when the book is locked, and the settings card to set it up.
'use strict';

let lockPromise = null;

function showLock() {
  if (lockPromise) return lockPromise;
  lockPromise = new Promise((resolve) => {
    let pin = '', busy = false;
    const dots = h('div', { class: 'lk-dots', 'aria-hidden': 'true' });
    const msg = h('div', { class: 'lk-msg', role: 'alert' });
    const paint = () => { dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' }))); };
    const done = () => { document.removeEventListener('keydown', onKey, true); screen.remove(); lockPromise = null; resolve(); };
    const submit = async () => {
      if (busy || pin.length < 4) return;
      busy = true; msg.textContent = '';
      try {
        const r = await fetch('/api/lock/unlock', { method: 'POST', headers: { 'X-Pennyworth': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { done(); return; }
        msg.textContent = j.error || 'PIN 不對';
        screen.classList.remove('shake'); void screen.offsetWidth; screen.classList.add('shake');
      } catch { msg.textContent = '連不上 Tallomi'; }
      pin = ''; paint(); busy = false;
    };
    const press = (d) => { if (pin.length < 8) { pin += d; paint(); } };
    const back = () => { pin = pin.slice(0, -1); paint(); };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { back(); e.preventDefault(); }
      else if (e.key === 'Enter') { submit(); e.preventDefault(); }
    };
    const key = (label, fn, cls = '') => h('button', { type: 'button', class: 'lk-key ' + cls, onclick: fn }, label);
    const pad = h('div', { class: 'lk-pad' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(String(n), () => press(String(n)))),
      key('⌫', back, 'alt'), key('0', () => press('0')), key('解鎖', submit, 'go'));
    const screen = h('div', { class: 'lockscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': '輸入 PIN 解鎖' },
      h('div', { class: 'lk-box' }, h('div', { class: 'lk-brand' }, 'Tallomi'), h('div', { class: 'lk-sub' }, '請輸入 PIN'), dots, msg, pad,
        h('p', { class: 'lk-hint' }, '4～8 個數字，也可以用鍵盤輸入')));
    paint();
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(screen);
    if (typeof bioOnLockScreen === 'function') {                       // phone version: Face ID / fingerprint, if it was turned on
      let asking = false;
      bioOnLockScreen(screen.querySelector('.lk-box'), async () => {
        if (asking) return; asking = true; msg.textContent = '';
        try {
          await bioAssert();
          const r = await fetch('/api/lock/unlock-biometric', { method: 'POST', headers: { 'X-Pennyworth': '1' } });
          if (r.ok) { done(); return; }
          msg.textContent = '這次沒有解開，請輸入 PIN';
        } catch { msg.textContent = '沒有通過 Face ID／指紋，請輸入 PIN'; }
        asking = false;
      });
    }
  });
  return lockPromise;
}

// While the book is open and a PIN is set, notice by itself when it has locked (idle time) and cover the screen.
async function lockCheck() {
  if (lockPromise || document.visibilityState !== 'visible' || !(S.st && S.st.lock && S.st.lock.enabled)) return;
  try {
    const j = await (await fetch('/api/lock/status', { cache: 'no-store' })).json();
    if (j.locked) { await showLock(); refresh().catch(() => {}); }
  } catch { /* program closed */ }
}
setInterval(lockCheck, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lockCheck(); });      // back from another app: cover the book at once if it locked meanwhile

const IDLE_LABEL = { 0: '只在開啟程式時要輸入', 1: '閒置 1 分鐘後上鎖', 5: '閒置 5 分鐘後上鎖', 15: '閒置 15 分鐘後上鎖', 60: '閒置 1 小時後上鎖' };

function pinDialog({ title, current, next, label, run }) {
  const cur = current ? h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', 'aria-label': '目前的 PIN' }) : null;
  const a = next ? h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', 'aria-label': '新的 PIN' }) : null;
  const b = next ? h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', 'aria-label': '再輸入一次新的 PIN' }) : null;
  openDialog({
    title, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      cur ? h('label', { class: 'field' }, h('span', null, '目前的 PIN'), cur) : null,
      a ? h('label', { class: 'field' }, h('span', null, '新的 PIN（4～8 個數字）'), a) : null,
      b ? h('label', { class: 'field' }, h('span', null, '再輸入一次'), b) : null),
    primary: { label, run: async () => {
      if (a && a.value !== b.value) throw new Error('兩次輸入的 PIN 不一樣');
      await run({ current: cur && cur.value, pin: a && a.value });
    } },
  });
}

function lockSection() {
  const box = h('div', { class: 'rows' });
  const paint = () => {
    const l = (S.st && S.st.lock) || { enabled: false, idle_min: 0, choices: [0, 1, 5, 15, 60] };
    const save = async (body) => { S.st.lock = await api('PUT', '/api/lock', body); paint(); };
    box.replaceChildren(...[
      h('p', { style: 'margin-top:0' }, h('b', null, l.enabled ? 'PIN 鎖：已開啟' : 'PIN 鎖：未開啟'), h('br'),
        h('span', { class: 'muted' }, l.enabled ? '開啟程式（或手機）時要先輸入 PIN 才看得到帳本。' : '開啟後，開啟程式（或手機）時要先輸入 PIN 才看得到帳本。可以隨時關閉。')),
      (S.st && S.st.phone && l.enabled) ? bioRow(l, save) : null,
      l.enabled ? h('label', { class: 'field' }, h('span', null, '自動上鎖'),
        h('select', { onchange: async (e) => { try { await save({ idle_min: Number(e.target.value) }); } catch (er) { fail(er); } } },
          ...l.choices.map((m) => h('option', { value: String(m), selected: m === l.idle_min }, IDLE_LABEL[m])))) : null,
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        l.enabled ? [
          h('button', { class: 'btn', onclick: async () => { await api('POST', '/api/lock/lock'); await showLock(); refresh().catch(() => {}); } }, '立即上鎖'),
          h('button', { class: 'btn', onclick: () => pinDialog({ title: '變更 PIN', current: true, next: true, label: '變更', run: async (v) => { await save({ pin: v.pin, current_pin: v.current }); toast('PIN 已變更'); } }) }, '變更 PIN'),
          h('button', { class: 'btn danger', onclick: () => pinDialog({ title: '關閉 PIN 鎖', current: true, label: '關閉', run: async (v) => { await save({ disable: true, current_pin: v.current }); toast('PIN 鎖已關閉'); } }) }, '關閉 PIN 鎖'),
        ] : h('button', { class: 'btn primary', onclick: () => pinDialog({ title: '設定 PIN', next: true, label: '開啟 PIN 鎖', run: async (v) => { await save({ pin: v.pin }); toast('PIN 鎖已開啟'); } }) }, '設定 PIN')),
      h('p', { class: 'hint' }, (S.st && S.st.phone)
        ? 'PIN 輸入錯 5 次會暫停一下才能再試。忘記 PIN 的話，只能清除這個網站的資料後重來（帳本會一起消失），所以請先在上面「下載備份檔」，之後用備份檔還原。這個鎖是遮住畫面，不是替手機裡的檔案加密。'
        : 'PIN 輸入錯 5 次會暫停一下才能再試。忘記 PIN：把 Tallomi 完全結束，到資料夾（Windows：%APPDATA%\\Pennyworth）刪除 applock.json 即可（用戶版預覽的鎖在 public_preview 資料夾裡）。這個鎖是擋住畫面與程式頁面，不是替帳本檔案加密。')].filter(Boolean));
  };
  paint();
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'PIN 鎖')), box);
}
