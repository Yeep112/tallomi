// Software updates (copies for other people only; the owner's own copy is replaced by hand and shows none of this).
// The program looks for a new version by itself when it is online, downloads it, and puts it in place at the next start.
'use strict';

function updInfo() { return (S.st && S.st.update) || { enabled: false }; }

const UPD_TEXT = {
  idle: '還沒檢查過', checking: '正在檢查…', uptodate: '已是最新版', downloading: '正在下載新版…', applying: '正在套用更新…',
  offline: '目前連不上更新伺服器。離線時 Tallomi 照常使用，連上網後會自動再檢查。',
  available: '有新版，但「自動下載」已關閉。', manual: '有新版，但需要重新下載安裝（無法自動更新）。',
};

const UPD_RESULT = { uptodate: '已是最新版', ready: '有新版，已下載', available: '有新版（自動下載已關）', manual: '有新版（需重新安裝）', error: '檢查失敗', offline: '連不上更新伺服器', downloading: '下載中', checking: '檢查中' };
function updSource(url) { try { const u = new URL(url); return u.host + u.pathname.replace(/\/$/, ''); } catch (e) { return url || '—'; } }

function updTime(iso) { return iso ? iso.replace('T', ' ').slice(0, 16) : '尚未檢查'; }

async function waitForVersion(version) {
  const note = h('p', { style: 'padding:40px;text-align:center' }, `正在更新到 ${version}…（約 10～30 秒，請不要關閉）`);
  document.body.replaceChildren(note);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const j = await (await fetch('/api/ping', { cache: 'no-store' })).json();
      if (j && j.version === version) { location.reload(); return; }
    } catch (e) { /* restarting */ }
    if (Date.now() - t0 > 120000) { note.textContent = '更新花的時間比預期久。請把 Tallomi 完全結束後，再用桌面捷徑重新開啟。'; return; }
  }
}

async function applyUpdate() {
  const u = updInfo();
  const ok = await confirmBox({ title: `更新到 ${u.ready}？`, confirmLabel: '更新並重新啟動',
    message: h('div', null, h('p', null, 'Tallomi 會先自動備份你的帳本，再換成新版並重新啟動，約 10～30 秒。'),
      h('p', { class: 'muted' }, '如果新版無法啟動，會自動回到目前的版本。') ) });
  if (!ok) return;
  try { await api('POST', '/api/update/apply'); } catch (e) { fail(e); return; }
  waitForVersion(u.ready);
}

// A thin strip at the top while a new version is waiting.
function updateFailureBar() {
  const u = updInfo();
  const f = u.enabled && u.failure;
  let bar = document.getElementById('failbar');
  if (!f || f.seen) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'failbar', class: 'updatebar failbar', role: 'alert' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar);
  }
  bar.replaceChildren(
    h('span', null, h('b', null, f.kind === 'rollback' ? `新版 ${f.version} 沒有裝成功，已還原到 ${f.back_to}` : `新版 ${f.version} 沒有安裝`), h('br'),
      h('span', { class: 'muted' }, f.reason + '　你的帳本沒有受到影響；這個版本不會再自動安裝。')),
    h('button', { class: 'btn sm', onclick: async () => {
      try { S.st.update = await api('POST', '/api/update/ack'); } catch (e) { bar.remove(); }
      updateFailureBar();
    } }, '知道了'));
}

function updateUpdateBar() {
  updateFailureBar();
  const u = updInfo();
  let bar = document.getElementById('updatebar');
  const show = u.enabled && (u.state === 'ready' || u.state === 'manual');
  if (!show) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'updatebar', class: 'updatebar', role: 'status' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar);
  }
  bar.replaceChildren(
    h('span', null, u.state === 'ready'
      ? [h('b', null, `新版 ${u.ready} 已下載`), '　下次開啟會自動更新，也可以現在更新。']
      : [h('b', null, `有新版 ${u.latest}`), '　這次需要重新下載安裝。']),
    u.state === 'ready'
      ? h('button', { class: 'btn sm primary', onclick: applyUpdate }, '立即更新')
      : h('a', { class: 'btn sm', href: u.url, target: '_blank', rel: 'noopener' }, '前往下載頁'));
}

function updateSection() {
  const u = updInfo();
  if (!u.enabled) return null;
  const box = h('div', { class: 'rows' });
  const paint = () => {
    const x = updInfo();
    const status = x.state === 'ready' ? `新版 ${x.ready} 已下載，下次開啟會自動更新。`
      : x.state === 'error' ? (x.error || '更新時發生問題。') : (UPD_TEXT[x.state] || '');
    box.replaceChildren(
      h('p', { style: 'margin-top:0' }, h('b', null, `目前版本 ${x.current}`), x.latest && x.latest !== x.current ? `　最新版 ${x.latest}` : '', h('br'),
        h('span', { class: x.state === 'error' ? 'neg' : 'muted' }, status), h('br'), h('span', { class: 'muted' }, `上次檢查：${updTime(x.last_checked)}`)),
      (() => {
        const c = x.last_check || {}, f = x.failure;
        return h('div', { class: 'upd-log' },
          h('p', { class: 'muted', style: 'margin:4px 0' }, c.at
            ? `檢查紀錄：${updTime(c.at)}　${UPD_RESULT[c.result] || c.result}${c.latest ? `（最新版 ${c.latest}）` : ''}${c.error ? `　${c.error}` : ''}`
            : '檢查紀錄：還沒有'),
          h('p', { class: 'muted', style: 'margin:4px 0;word-break:break-all' }, `更新來源：${updSource(x.source || x.url)}`),
          f ? h('p', { class: 'neg', style: 'margin:4px 0' }, `上次更新失敗（${updTime(f.at)}）：${f.reason}`) : '');
      })(),
      (x.notes && x.notes.length && x.latest !== x.current) ? h('ul', { class: 'upd-notes' }, ...x.notes.map((n) => h('li', null, n))) : '',
      h('label', { class: 'tally-toggle' }, h('input', { type: 'checkbox', checked: !!x.auto, onchange: async (e) => {
        try { S.st.update = await api('PUT', '/api/update/settings', { auto: e.target.checked }); paint(); } catch (er) { fail(er); }
      } }), h('span', null, '連網時自動檢查並下載新版（關掉就只在你按「現在檢查」時才會）')),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' },
        h('button', { class: 'btn', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = '檢查中…';
          try { S.st.update = await api('POST', '/api/update/check'); } catch (er) { fail(er); }
          paint(); updateUpdateBar();
        } }, '現在檢查'),
        x.state === 'ready' ? h('button', { class: 'btn primary', onclick: applyUpdate }, '立即更新並重新啟動') : ''),
      h('p', { class: 'hint' }, '更新前會自動備份帳本；如果新版無法啟動，會自動回到上一版。帳本資料不在程式資料夾裡，更新不會動到它。'));
  };
  paint();
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '軟體更新')), box);
}


// Settings → 意見回饋: a link to the public Google Form (what to add / what is wrong). Nothing from the book is sent.
// Hidden until the form address is configured, so nobody sees a button that goes nowhere.
function feedbackSection() {
  const url = S.st && S.st.feedback_url;
  if (!url) return null;
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '意見回饋')),
    h('div', { class: 'rows' },
      h('p', { style: 'margin:0' }, '想要新功能，或遇到問題？告訴我們。'),
      h('div', { class: 'row-inline' },
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, '開啟意見回饋表單')),
      h('p', { class: 'hint', style: 'margin:0' }, '表單只有兩題：想新增的功能、目前遇到的問題。你的帳本資料不會被送出。')));
}

// ---- 1.72.2 — the owner's copy: Claude's tested update waiting on GitHub. One button: receive_update.bat opens in its own window,
// runs the whole test-suite on this computer and only then signs and publishes (nothing here publishes by itself).
let ownerPend = null;
function ownerHere() {
  const m = S.st && S.st.app_mode;
  return !!(m && m.can_switch && m.mode === 'owner' && !S.st.remote && !S.st.phone);
}
async function ownerPendingCheck(force) {
  if (!ownerHere()) return null;
  try { ownerPend = await api('GET', '/api/owner-pending' + (force ? '?force=1' : '')); } catch (e) { return null; }
  ownerPendingBar();
  ownerResultMaybe();
  return ownerPend;
}

// ---- 1.72.2: when the black window is done, say so here (published, or why not) — once per result
const PEND_SEEN = 'pw_pend_seen';
const PEND_TEXT = {
  published: (r) => [`✓ Tallomi ${r.version} 已發佈到網站`, '其他人的 Tallomi 會在下次開啟時自動更新。', 'ok'],
  tests_failed: (r) => [`Tallomi ${r.version} 測試沒過，沒有發佈`, '網站沒有變。把測試報告傳給 Claude，它修好後會再放上來。', 'bad'],
  publish_failed: (r) => [`Tallomi ${r.version} 發佈沒有成功`, '測試都通過了，是推上網站時出了問題，網站沒有變。把記錄傳給 Claude。', 'bad'],
  conflict: (r) => [`Tallomi ${r.version} 先停下來了`, `這些檔案跟 Claude 拿到的不一樣，為了不蓋掉你的修改沒有套用：${r.detail || ''}。把它們傳給 Claude。`, 'bad'],
  wrong_base: (r) => [`Tallomi ${r.version} 沒有套用`, `${r.detail || '版本對不上'}。跟 Claude 說一聲就好。`, 'bad'],
  no_pytest: (r) => [`Tallomi ${r.version} 沒有發佈`, `沒辦法先測試：${r.detail || '這台電腦沒有 pytest'}`, 'bad'],
};
function ownerResultMaybe() {
  const r = ownerPend && ownerPend.last_result;
  if (!r || !PEND_TEXT[r.state]) return;
  // 1.72.5: just published and the files on disk are that new version: start it now (the "已發佈" notice shows once it is up)
  if (r.state === 'published' && ownerPend.disk === r.version && S.st && S.st.version !== r.version && Date.now() / 1000 - r.at < 30 * 60) {
    ownerRestartInto(r.version);
    return;
  }
  const seen = Number(lsGet(PEND_SEEN) || 0);
  if (r.at <= seen || Date.now() / 1000 - r.at > 3 * 86400) return;          // shown once; an old one is not brought up again
  ownerResultBar(r);
}
let ownerRestarting = false;
async function ownerRestartInto(version) {
  if (ownerRestarting) return;
  ownerRestarting = true;
  document.getElementById('pendresult')?.remove();
  const bar = h('div', { id: 'pendresult', class: 'updatebar pend-ok', role: 'status' },
    h('span', null, h('b', null, `✓ Tallomi ${version} 已發佈`), '　正在重新啟動 Tallomi，換成新版本…'));
  const main = document.querySelector('main.main');
  if (main) main.prepend(bar);
  try { await api('POST', '/api/owner-pending/restart'); } catch (e) {
    ownerRestarting = false;
    bar.replaceChildren(h('span', null, h('b', null, `✓ Tallomi ${version} 已發佈`), `　${(e && e.message) || '沒辦法自動重新啟動'}。結束 Tallomi 再打開，就會是新版本。`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => bar.remove() }, '知道了'));
    return;
  }
  const t0 = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 800));
    try {
      const j = await (await fetch('/api/ping', { cache: 'no-store' })).json();
      if (j && j.version === version) { location.reload(); return; }
    } catch (e) { /* restarting */ }
    if (Date.now() - t0 > 60000) {
      bar.replaceChildren(h('span', null, h('b', null, '重新啟動花的時間比預期久'), '　請稍等，或結束 Tallomi 再用蜂巢 T 捷徑打開。'));
      return;
    }
  }
}
function ownerResultBar(r) {
  const [title, text, tone] = PEND_TEXT[r.state](r);
  document.getElementById('pendresult')?.remove();
  const done = () => { lsSet(PEND_SEEN, String(r.at)); bar.remove(); };
  const bar = h('div', { id: 'pendresult', class: 'updatebar pend-' + tone, role: 'status' },
    h('span', null, h('b', null, title), '　' + text),
    h('span', { class: 'head-btns' },
      r.report && tone === 'bad' ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { await api('POST', '/api/owner-pending/open-report', { path: r.report }); } catch (e) { fail(e); }
      } }, r.state === 'tests_failed' ? '打開測試報告' : '打開記錄') : null,
      h('button', { class: 'btn sm' + (tone === 'ok' ? ' primary' : ''), type: 'button', onclick: done }, '知道了')));
  const main = document.querySelector('main.main');
  if (main) main.prepend(bar);
  toast(title, tone === 'bad');
}
let pendWatch = 0;
function ownerWatchRun() {                                                   // after the button: look every 15 s until the window has written its result
  const since = Date.now() / 1000 - 5, until = Date.now() + 40 * 60 * 1000;
  clearInterval(pendWatch);
  pendWatch = setInterval(async () => {
    if (Date.now() > until) { clearInterval(pendWatch); return; }
    let p = null; try { p = await api('GET', '/api/owner-pending'); } catch (e) { return; }
    const r = p && p.last_result;
    if (r && r.at >= since) { clearInterval(pendWatch); ownerPend = p; ownerPendingBar(); ownerResultMaybe(); refreshOwnerSection(); }
  }, 15000);
}
function ownerPendingBar() {
  let bar = document.getElementById('pendingbar');
  const show = !!(ownerPend && ownerPend.enabled && ownerPend.state === 'waiting');      // (while it runs, the bar steps aside)
  if (!show) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div', { id: 'pendingbar', class: 'updatebar', role: 'status' });
    const main = document.querySelector('main.main');
    if (main) main.prepend(bar);
  }
  bar.replaceChildren(
    h('span', null, h('b', null, `Tallomi ${ownerPend.version} 已準備好`), `　Claude 測試過的更新（網站目前是 ${ownerPend.live || '—'}），按一下就測試並發佈。`),
    h('button', { class: 'btn sm primary', type: 'button', onclick: ownerPendingRun }, '查看並發佈'));
}
async function ownerPendingRun() {
  const p = ownerPend; if (!p) return;
  const list = (items) => h('ul', { class: 'pend-list' }, items.map((t) => h('li', null, t)));
  const ok = await confirmBox({ title: `發佈 Tallomi ${p.version}？`, confirmLabel: '測試並發佈',
    message: h('div', null,
      h('p', null, h('b', null, '這次更新')), list(p.notes || []),
      (p.tested || []).length ? [h('p', null, h('b', null, 'Claude 已做的測試')), list(p.tested)] : null,
      h('p', { class: 'muted' }, '按下後會開一個黑色視窗：先在這台電腦跑完整測試（約 3～5 分鐘），全部通過才簽章並推上網站，完成後會自動清空待發佈的更新。測試沒過就不會發佈，報告會存起來給 Claude。')) });
  if (!ok) return;
  try { await api('POST', '/api/owner-pending/run'); } catch (e) { fail(e); return; }
  toast('已開始：黑色視窗會跑測試並發佈，好了這裡會告訴你');
  ownerPend = Object.assign({}, ownerPend, { state: 'running' }); ownerPendingBar(); refreshOwnerSection();
  ownerWatchRun();
}

// ---- 1.72.2: Settings → 發佈新版本 (the owner's copy): see what is waiting, check now, publish, and the last result
let ownerSectionPaint = null;
function refreshOwnerSection() { if (ownerSectionPaint) ownerSectionPaint(); }
function ownerPublishSection() {
  if (!ownerHere()) return null;
  const box = h('div', { class: 'rows' });
  const paint = () => {
    if (!box.isConnected && ownerSectionPaint !== paint) return;
    const p = ownerPend || {};
    const r = p.last_result;
    const line = p.state === 'waiting' ? [h('b', null, `待發佈：Tallomi ${p.version}`), `（網站目前是 ${p.live || '—'}）`]
      : p.state === 'running' ? [h('b', null, '發佈中…'), '黑色視窗正在跑測試與發佈，好了這裡和最上方都會顯示結果。']
      : p.state === 'error' ? [h('b', { class: 'neg' }, '檢查不到'), `：${p.error || '連不上 GitHub'}`]
      : p.state === 'none' ? [h('b', null, '目前沒有待發佈的更新'), p.live ? `（網站是 ${p.live}）` : '']
      : [h('span', { class: 'muted' }, '還沒檢查')];
    const last = r && PEND_TEXT[r.state] ? h('p', { class: 'muted', style: 'margin:4px 0' }, `上次：${r.when || ''}　${PEND_TEXT[r.state](r)[0]}`) : null;
    box.replaceChildren(
      h('p', { style: 'margin-top:0' }, h('b', null, `這台電腦的版本 ${S.st.version}`), h('br'), ...line),
      last,
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' },
        h('button', { class: 'btn', type: 'button', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = '檢查中…';
          await ownerPendingCheck(true);
          paint();
        } }, '檢查待發佈更新'),
        p.state === 'waiting' ? h('button', { class: 'btn primary', type: 'button', onclick: ownerPendingRun }, '查看並發佈') : null),
      h('p', { class: 'hint' }, 'Claude 測試好的更新會放在 GitHub 的 pending。按「查看並發佈」會開一個黑色視窗：先在這台電腦跑完整測試，全部通過才簽章並推上網站，好了這裡會顯示結果。私鑰不會離開這台電腦。'));
  };
  ownerSectionPaint = paint;
  paint();
  if (!ownerPend) ownerPendingCheck().then(paint);
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '發佈新版本')), box);
}
