/* Tallomi — 診斷紀錄 (1.66.0). A short note, kept on this device only, of the things that go wrong or run slowly: a script error, a page that was cut off
   while it was on the screen (a crash, or the phone running out of memory), a freeze of half a second or more, a slow start.
   It is read in 設定 → 診斷紀錄 and copied by hand if wanted. Nothing is sent anywhere, and no amount, note or account is ever read for it:
   only the error's own text, the file and line, the page, and timings. Loaded first (not deferred) so that errors of the other files are caught too. */
'use strict';
(() => {
  const KEY = 'pw_diag', ALIVE = 'pw_alive', MAX = 80, T0 = Date.now();
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-MAX))); } catch { /* storage full or blocked */ } };
  const clean = (t) => String(t == null ? '' : t)
    .replace(/https?:\/\/[^\/\s)]*\/?/g, '')                 // the address of the computer is dropped; the path stays (static/app.js, api/transactions)
    .replace(/(\/[^\s?)]*)\?[^\s)]*/g, '$1')                // and so is a query string: it may hold what was typed into a search box
    .replace(/\s+/g, ' ').slice(0, 240);
  let longs = 0, made = 0;
  const note = (kind, text, extra) => {
    if (made >= 200) return;                                                                   // a page stuck in an error loop does not turn the log into the thing that slows it down
    made += 1;
    const v = read(), t = clean(text);
    let hit = -1;
    for (let i = v.length - 1; i >= 0 && i >= v.length - 12; i -= 1) if (v[i].k === kind && v[i].t === t) { hit = i; break; }          // the same thing again: one line with a count
    if (hit >= 0) { const e = v.splice(hit, 1)[0]; e.n = (e.n || 1) + 1; e.at = Date.now(); v.push(e); } else v.push({ at: Date.now(), k: kind, t, ...(extra || {}) });
    write(v);
  };
  const where = () => (location.hash.match(/^#\/([a-z-]+)/) || [])[1] || '';
  const build = () => ((document.querySelector('meta[name="pw-build"]') || {}).content || '').replace(/^__.*/, '');
  // The state of THIS window (sessionStorage: another window or tab never mixes in): on the screen, in the background, or closed.
  const alive = (state) => { try { sessionStorage.setItem(ALIVE, JSON.stringify({ s: state, at: Date.now(), v: build() })); } catch { /* ignore */ } };

  // A page that was on the screen and then simply ended (no "hidden", no "closed" before it) was cut off: a crash, or no memory left. One that went to the
  // background first is normal: the phone may throw such a page away at any time.
  try {
    const prev = JSON.parse(sessionStorage.getItem(ALIVE) || 'null');
    if (prev && prev.s === 'visible') note('cut-off', `上次在畫面上時被中斷（最後一次確認在 ${new Date(prev.at).toLocaleString('zh-TW', { hour12: false })}）：可能是閃退，或手機記憶體不足`);
  } catch { /* ignore */ }
  alive(document.visibilityState === 'visible' ? 'visible' : 'hidden');
  const beat = setInterval(() => { if (document.visibilityState === 'visible') alive('visible'); }, 5000);
  document.addEventListener('visibilitychange', () => alive(document.visibilityState === 'visible' ? 'visible' : 'hidden'));
  window.addEventListener('pagehide', () => { clearInterval(beat); alive('closed'); });

  window.addEventListener('error', (e) => { if (e && (e.message || e.filename)) note('error', `${e.message || '錯誤'}（${(e.filename || '').split('?')[0].split('/').pop()}:${e.lineno || 0}）`, { p: where() }); });
  window.addEventListener('unhandledrejection', (e) => { const r = e && e.reason; note('error', `未處理的失敗：${(r && r.message) || r || ''}`, { p: where() }); });
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) if (en.duration >= 600 && longs < 25) { longs += 1; note('freeze', `畫面停住 ${Math.round(en.duration)} 毫秒`, { p: where() }); }
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* the browser has no long-task timing */ }

  window.pwDiag = {
    read, note,
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
    start(ms, why) { if (ms > 3500) note('slow-start', `開啟到看見畫面用了 ${(ms / 1000).toFixed(1)} 秒${why ? `（${why}）` : ''}`); },       // called by app.js once the first page is drawn; 1.72.1: with where the time went
    text() {
      const v = read(), ua = navigator.userAgent.replace(/\s+/g, ' ').slice(0, 160);
      return [`Tallomi ${build()}　${new Date().toLocaleString('zh-TW', { hour12: false })}`, ua, ...v.map((e) => `${new Date(e.at).toLocaleString('zh-TW', { hour12: false })}　${e.k}${e.p ? '@' + e.p : ''}${e.n > 1 ? ' ×' + e.n : ''}　${e.t}`)].join('\n');
    },
  };
  void T0;
})();

// The settings section. (Only functions here: the page builders live in app.js, which loads after this file.)
function diagSection() {
  const KIND = { error: '錯誤', 'cut-off': '被中斷', freeze: '停住', 'slow-start': '慢啟動', 'remote-late': '更新慢' };
  const list = h('div', { class: 'rows' });
  const paint = () => {
    const v = window.pwDiag.read().slice().reverse();
    list.replaceChildren(
      h('p', { class: 'hint', style: 'margin:0' }, '程式遇到錯誤、畫面被中斷（閃退或記憶體不足）、停住超過半秒，或開啟太慢時，會在這支裝置上留一行記錄，方便找出原因。只存在這支裝置上、不會傳出去；只記錄錯誤訊息、發生的頁面和時間，不會主動記金額或備註。'),
      v.length ? h('ul', { class: 'diag-list' }, v.slice(0, 40).map((e) => h('li', null,
        h('span', { class: 'diag-when' }, new Date(e.at).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
        h('b', { class: 'diag-kind ' + e.k }, KIND[e.k] || e.k), e.p ? h('span', { class: 'muted' }, ` ${e.p}`) : null, e.n > 1 ? h('span', { class: 'muted' }, ` ×${e.n}`) : null, h('span', null, `　${e.t}`))))
        : h('p', { class: 'muted', style: 'margin:0' }, '目前沒有紀錄，一切正常。'),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn', type: 'button', disabled: !v.length, onclick: async () => { try { await navigator.clipboard.writeText(window.pwDiag.text()); toast('已複製診斷紀錄'); } catch { toast('這個瀏覽器不讓程式複製，請手動選取文字', true); } } }, '複製'),
        h('button', { class: 'btn ghost', type: 'button', disabled: !v.length, onclick: () => { window.pwDiag.clear(); paint(); toast('已清除診斷紀錄'); } }, '清除')));
  };
  paint();
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '診斷紀錄')), list);
}
