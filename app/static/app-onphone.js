// Tallomi on a phone, running by itself in the browser (no computer behind it). Everything here only matters when the server says
// `phone: true`: saving files through the browser, Face ID / fingerprint unlock, the settings page of the phone version, and the hints that
// keep the phone from throwing the book away.
'use strict';

const BIO_KEY = 'pw_bio_cred';
window.PW_BIO_OK = false;
try {
  if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((v) => { window.PW_BIO_OK = !!v; }).catch(() => {});
  }
} catch { /* no WebAuthn */ }

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// ---- Face ID / fingerprint. The phone checks the person itself (WebAuthn); the program only learns "yes" and opens the book.
function bioReady() { return !!(window.PublicKeyCredential && lsGet(BIO_KEY)); }
async function bioRegister() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Tallomi' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'pennyworth', displayName: 'Tallomi' },
    challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000, attestation: 'none' } });
  localStorage.setItem(BIO_KEY, b64u(cred.rawId));
}
async function bioAssert() {
  const id = lsGet(BIO_KEY);
  if (!id) throw new Error('no credential');
  await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), userVerification: 'required', timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: unb64u(id) }] } });
}
// The "use Face ID" row inside the PIN card (only when the PIN lock is on).
function bioRow(l, save) {
  if (!window.PW_BIO_OK) return h('p', { class: 'hint', style: 'margin:0' }, '這支手機沒有可用的 Face ID／指紋（或這個瀏覽器不支援），只能用 PIN。');
  return h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: !!(l.biometric && bioReady()), onchange: async (e) => {
    try {
      if (e.target.checked) { await bioRegister(); await save({ biometric: true }); toast('已開啟 Face ID／指紋解鎖'); }
      else { try { localStorage.removeItem(BIO_KEY); } catch { /* ignore */ } await save({ biometric: false }); toast('已關閉 Face ID／指紋解鎖'); }
    } catch (err) { e.target.checked = !e.target.checked; fail(err); }
  } }), h('span', null, '用 Face ID／指紋解鎖（PIN 仍然可以用）'));
}
// On the lock screen: offer the button and try once by itself.
function bioOnLockScreen(box, tryUnlock) {
  fetch('/api/lock/status', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
    if (!j.biometric || !bioReady()) return;
    box.append(h('button', { type: 'button', class: 'btn lk-bio', onclick: tryUnlock }, '用 Face ID／指紋解鎖'));
    setTimeout(tryUnlock, 250);
  }).catch(() => {});
}

// ---- saving a file through the browser (there is no folder to write into)
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exported(r) {                                    // after an export call: phone gets the CSV text back, the computer a file path
  if (r.content != null) { saveBlob(r.filename, new Blob([r.content], { type: 'text/csv;charset=utf-8' })); toast(`已匯出 ${r.rows} 筆（${r.filename}）`); return; }
  toast(`已匯出 ${r.rows} 筆：${r.path}`);
  await api('POST', '/api/open-folder', { which: 'exports' });
}

// ---- start-up of the phone version: ask the browser not to clear our storage, and show the install hint
const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
async function storageState() {
  try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
}
// The page may have been drawn from the answers kept last time while the program was still starting (phone/phone-boot.js). Once the
// program is up, ask again and redraw. A box that already has something typed in it gets a few seconds to be finished first; a sheet
// that is open does not matter (it is not part of the page being redrawn).
async function freshenAfterStale() {
  const root = document.documentElement;
  root.classList.add('stale');
  if (typeof staleNote === 'function') staleNote('更新中…');
  try { await window.__phoneReady; } catch { root.classList.remove('stale'); if (typeof staleNote === 'function') staleNote(null); return; }
  for (let i = 0; i < 16; i++) {
    const a = document.activeElement;           // "typing" = a box with something already in it (an empty focused box is just where the cursor waits)
    if (!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  try { await refresh(); } catch { /* the next action says what is wrong */ }
  root.classList.remove('stale');
  if (typeof staleNote === 'function') staleNote(null);
}
function phoneStartup() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
  if (isStandalone()) return;
  try { if (sessionStorage.getItem('pw_hint_off')) return; } catch { /* ignore */ }
  const main = document.querySelector('main') || $('#view');
  if (!main || document.querySelector('.updatebar.install')) return;
  const bar = h('div', { class: 'updatebar install', role: 'note' },
    h('span', null, h('b', null, '先把 Tallomi 加到主畫面'), isIOS()
      ? '　按 Safari 下方的「分享」→「加入主畫面」，之後都從主畫面的圖示開啟。這樣 iPhone 才不會定期清掉你的帳本。'
      : '　按瀏覽器選單的「安裝應用程式」或「加到主畫面」，之後都從主畫面的圖示開啟，帳本比較不會被瀏覽器清掉。'),
    h('span', { class: 'head-btns' },
      installEvent ? h('button', { class: 'btn sm primary', onclick: async () => { try { installEvent.prompt(); await installEvent.userChoice; } catch { /* ignore */ } bar.remove(); } }, '安裝') : null,
      h('button', { class: 'btn sm', onclick: () => { try { sessionStorage.setItem('pw_hint_off', '1'); } catch { /* ignore */ } bar.remove(); } }, '先不要')));
  main.prepend(bar);
}

// ---- the settings page of the phone version (the computer-only sections are simply left out)
async function phoneSettings(view) {
  const persisted = await storageState();
  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '備份與匯出')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '你的帳本只存在這支手機的瀏覽器裡，不會傳給任何人。換手機、清除瀏覽資料或 iPhone 長時間沒開，都可能讓它消失，所以請定期「下載備份檔」，存到「檔案」或雲端硬碟。'),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await fetch('/api/phone/backup', { headers: { 'X-Pennyworth': '1' } });
            if (!r.ok) throw new Error('備份失敗');
            const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'pennyworth.db';
            saveBlob(name, await r.blob()); toast(`已下載備份檔 ${name}`);
          } catch (er) { fail(er); }
          e.target.disabled = false;
        } }, '下載備份檔'),
        h('button', { class: 'btn', onclick: async () => { try { await exported(await api('POST', '/api/export')); } catch (e) { fail(e); } } }, '匯出 CSV（Excel 可開）')),
      (() => {
        const pick = h('input', { type: 'file', accept: '.db,application/octet-stream', 'aria-label': '選擇備份檔' });
        return h('div', { class: 'row-inline' }, pick, h('button', { class: 'btn', onclick: async (e) => {
          const f = pick.files[0]; if (!f) return toast('請先選擇備份檔', true);
          if (!(await confirmBox({ title: '用這個備份檔還原？', confirmLabel: '還原', danger: true,
            message: h('p', null, `目前的帳本會被「${f.name}」取代。還原前會先自動留一份目前的備份。`) }))) return;
          const fd = new FormData(); fd.append('file', f);
          e.target.disabled = true;
          try { await api('POST', '/api/phone/restore', fd, true); pick.value = ''; await afterChange('已還原備份'); } catch (er) { fail(er); }
          e.target.disabled = false;
        } }, '從備份檔還原'));
      })(),
      h('p', { class: 'hint', style: 'margin:0' }, persisted ? '瀏覽器已答應保留這份帳本的儲存空間。' : '瀏覽器還沒有承諾永久保留儲存空間；把 Tallomi 加到主畫面後會比較穩，但仍請定期備份。'))));

  view.append(importSection());

  view.append(lockSection());

  { const fs = feedbackSection(); if (fs) view.append(fs); }

  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '關於這個版本')),
    h('div', { class: 'rows' },
      h('p', { style: 'margin:0' }, `Tallomi 手機版 ${S.st.version}`),
      h('p', { class: 'hint', style: 'margin:0' }, '沒有網路時照常記帳。有新版本時會在畫面下方通知你，按一下就更新，帳本不受影響。匯率與股價需要網路，而且手機瀏覽器擋掉了部分資料來源，查不到時請手動輸入。PIN／Face ID 是用來遮住畫面，不會替瀏覽器裡的檔案加密。'))));

  view.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '危險區')),
    h('div', { class: 'rows' }, h('div', { class: 'danger-zone' },
      h('p', { style: 'margin-top:0' }, h('b', null, '清除所有交易，帳戶回到初始金額'), h('br'), h('span', { class: 'muted' }, '帳戶本身會保留，交易紀錄全部刪除。清除前會自動備份一份。')),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox({ title: '清除所有交易？', message: h('p', null, '所有交易會被刪除，帳戶餘額回到初始金額。'), confirmLabel: '清除全部', danger: true }))) return;
        try { const r = await api('POST', '/api/clear-all', { confirm: '清除全部' }); await afterChange(`已清除 ${r.deleted} 筆交易`); } catch (e) { fail(e); }
      } }, '清除所有交易…')))));
}
