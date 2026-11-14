// Software updates (copies for other people only; the owner's own copy is replaced by hand and shows none of this).
// The program looks for a new version by itself when it is online, downloads it, and puts it in place at the next start.
'use strict';

function updInfo() { return (S.st && S.st.update) || { enabled: false }; }

const UPD_TEXT = {
  idle: '還沒檢查過', checking: '正在檢查…', uptodate: '已是最新版', downloading: '正在下載新版…', applying: '正在套用更新…',
  offline: '目前連不上更新伺服器。離線時 Tallomi 照常使用，連上網後會自動再檢查。',
  available: '有新版，但「自動下載」已關閉。', manual: '有新版，但需要重新下載安裝（無法自動更新）。',
};

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
function updateUpdateBar() {
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
