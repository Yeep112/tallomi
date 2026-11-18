/* Long lists, finger gestures and loading skeletons.
   - virtualBody: a windowed table body ("virtual scrolling"). Only the rows near the screen exist in the page, so thousands of transactions
     scroll as smoothly as forty. Rows keep their real height once seen; the rest use an estimate.
   - enableSwipe: on a phone a transaction row slides sideways: left = delete (with 復原), right = record it again (再記一筆).
   - skeletonFor: grey placeholder blocks shaped like the page that is loading, so switching pages never starts from a blank screen.
   Only functions here: nothing touches `S` until a page is drawn (app.js loads after this file). */
'use strict';

// ---------------------------------------------------------------- windowed rows
let activeVirtual = null;                                   // the one windowed list on screen (the transactions page)
function virtualRefresh() { if (activeVirtual) activeVirtual.refresh(); }

// tbody: the <tbody> to fill. entries: [{ key, kind }] in page order. makeRow(entry) builds one <tr>.
// Spacer rows above and below stand in for the rows that are not drawn, so the scrollbar and the page height stay right.
function virtualBody(tbody, entries, makeRow, { cols = 1, estimate = { day: 44, tx: 60 }, buffer = 700 } = {}) {
  if (activeVirtual) activeVirtual.dispose();
  const heights = new Map(), est = { ...estimate }, measured = { day: false, tx: false };
  let list = entries, cum = [0], disposed = false, raf = 0;
  const live = [];                                          // [{ i, key, tr }] in page order
  const spacer = () => { const td = h('td', { colspan: cols }); return { tr: h('tr', { class: 'vs', 'aria-hidden': 'true' }, td), td }; };
  const top = spacer(), bottom = spacer();
  tbody.replaceChildren(top.tr, bottom.tr);

  const recompute = () => {
    cum = new Array(list.length + 1); cum[0] = 0;
    for (let i = 0; i < list.length; i++) cum[i + 1] = cum[i] + (heights.get(list[i].key) || est[list[i].kind]);
  };
  const find = (y) => {                                     // index of the entry that covers offset y
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] > y) hi = mid; else lo = mid + 1; }
    return lo;
  };
  const offsetY = () => -tbody.getBoundingClientRect().top; // how far the top of the screen is below the top of the list
  const measure = (tr) => {
    const cs = getComputedStyle(tr);
    return tr.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  };
  const setSpacers = () => {
    const first = live.length ? live[0].i : 0, last = live.length ? live[live.length - 1].i : -1;
    top.td.style.height = `${cum[first]}px`;
    bottom.td.style.height = `${Math.max(0, cum[list.length] - cum[last + 1])}px`;
  };
  const place = (i) => { const e = list[i]; return { i, key: e.key, tr: makeRow(e, i) }; };

  // make the drawn rows exactly a..b
  const draw = (a, b) => {
    while (live.length && live[0].i < a) live.shift().tr.remove();
    while (live.length && live[live.length - 1].i > b) live.pop().tr.remove();
    if (!live.length) {
      const frag = document.createDocumentFragment();
      for (let i = a; i <= b; i++) { const it = place(i); live.push(it); frag.appendChild(it.tr); }
      bottom.tr.before(frag);
    } else {
      const head = live[0].i, tail = live[live.length - 1].i;
      if (a < head) { const frag = document.createDocumentFragment(), add = []; for (let i = a; i < head; i++) { const it = place(i); add.push(it); frag.appendChild(it.tr); } live.unshift(...add); top.tr.after(frag); }
      if (b > tail) { const frag = document.createDocumentFragment(); for (let i = tail + 1; i <= b; i++) { const it = place(i); live.push(it); frag.appendChild(it.tr); } bottom.tr.before(frag); }
    }
  };
  const learn = () => {                                     // remember the real heights of what is on screen now
    if (!tbody.isConnected) return;
    for (const it of live) {
      const hh = measure(it.tr);
      if (hh > 0) heights.set(it.key, hh);
    }
    for (const kind of ['day', 'tx']) {                     // the first rows seen set the estimate for the ones not seen yet
      if (measured[kind]) continue;
      const got = live.filter((it) => list[it.i] && list[it.i].kind === kind && heights.get(it.key));
      if (got.length) { est[kind] = got.reduce((s, it) => s + heights.get(it.key), 0) / got.length; measured[kind] = true; }
    }
  };

  // anchor: { index, offset } = the entry at the top of the screen and how far it sits below the top; it is put back after the heights change
  let dirty = true;                                          // rows were drawn before the table was in the page: their heights are still guesses
  const paint = (force, anchor) => {
    if (disposed || !list.length) return;
    const connected = tbody.isConnected;
    const y = connected ? offsetY() : 0, vh = window.innerHeight;
    let a, b;
    if (!connected || y + vh + buffer < 0) { a = 0; b = Math.min(list.length - 1, 14); }   // not on screen (yet): just the first few
    else { a = find(Math.max(0, y - buffer)); b = find(Math.max(0, y + vh + buffer)); }
    const need = force || !live.length || live[0].i > a || live[live.length - 1].i < b;
    if (!need && !(dirty && connected)) return;
    let ai = 0, aOff = 0;
    if (connected) {
      if (anchor) { ai = anchor.index; aOff = anchor.offset; }
      else { ai = find(Math.max(0, y)); aOff = cum[ai] - y; }
    }
    if (need) draw(Math.max(0, a - 4), Math.min(list.length - 1, b + 4));
    learn(); recompute(); setSpacers(); dirty = !connected;
    if (connected) { const ny = cum[ai] - aOff; if (Math.abs(ny - y) > 1) window.scrollBy(0, ny - y); }
  };
  const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(false); }); };
  const onResize = () => { heights.clear(); measured.day = measured.tx = false; recompute(); paint(true); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  recompute();
  draw(0, Math.min(list.length - 1, 14)); setSpacers();       // a first picture before the table is even in the page

  const api = {
    refresh: () => paint(false),
    // the list changed (a day was folded, more rows arrived): keep the entry at the top of the screen where it is
    setEntries(next) {
      let anchor = null;
      if (tbody.isConnected && list.length) {
        const y = offsetY(), at = find(Math.max(0, y)), has = new Map(next.map((e, i) => [e.key, i]));
        let j = at; while (j > 0 && !has.has(list[j].key)) j--;        // the row itself may be gone (its day was folded): use the nearest one before it
        anchor = { index: has.has(list[j].key) ? has.get(list[j].key) : 0, offset: cum[j] - y };
      }
      live.splice(0).forEach((it) => it.tr.remove());
      list = next; recompute();
      paint(true, anchor);
    },
    dispose() { disposed = true; window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf); if (activeVirtual === api) activeVirtual = null; },
    get size() { return list.length; },
    get drawn() { return live.length; },
  };
  activeVirtual = api;
  return api;
}

// ---------------------------------------------------------------- swipe a row
// Touch only (a mouse has the buttons and the keyboard has the editor). Vertical scrolling stays the browser's own: the row asks for
// `touch-action: pan-y`, so a mostly-vertical move never reaches us. A swipe has to travel a clear distance before it counts.
const SWIPE_AT = 92;                                         // px the row must travel before letting go does something
function enableSwipe(tr, { onLeft, onRight, leftLabel = '刪除', rightLabel = '再記一筆', leftCls = 'del', rightCls = 'copy' }) {
  tr.classList.add('swipeable');
  let st = null, bg = null, reset = 0;
  const finish = (dx, act) => {
    tr.style.transition = 'transform .18s ease-out';
    tr.style.transform = '';
    clearTimeout(reset);
    reset = setTimeout(() => { tr.style.transition = ''; tr.classList.remove('swiping'); if (bg) { bg.remove(); bg = null; } }, 200);
    if (act) { if (dx < 0 && onLeft) onLeft(); else if (dx > 0 && onRight) onRight(); }
  };
  tr.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    if (e.target.closest('input, select, textarea, a, summary')) return;
    const W = document.documentElement.clientWidth;
    if (e.clientX < 22 || e.clientX > W - 22) return;        // the screen's edges belong to the system's own swipe-back
    clearTimeout(reset); tr.style.transition = '';
    st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false };
  });
  tr.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { st = null; return; }     // scrolling, not swiping
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if ((dx < 0 && !onLeft) || (dx > 0 && !onRight)) { st = null; return; }
      st.on = true; tr.classList.add('swiping');
      bg = h('span', { class: 'sw-bg', 'aria-hidden': 'true' }); tr.appendChild(bg);
    }
    if ((dx < 0 && !onLeft) || (dx > 0 && !onRight)) { st.dx = 0; tr.style.transform = ''; if (bg) { bg.style.width = '0'; } return; }
    const a = Math.abs(dx), shown = a <= 150 ? a : 150 + (a - 150) * 0.25;               // a little rubber band past the far end
    st.dx = Math.sign(dx) * shown;
    tr.style.transform = `translateX(${st.dx}px)`;
    const left = dx < 0, armed = shown >= SWIPE_AT;
    bg.className = `sw-bg ${left ? leftCls : rightCls}${armed ? ' armed' : ''}`;
    bg.style.width = `${shown}px`;
    bg.textContent = armed ? (left ? `放開${leftLabel}` : `放開${rightLabel}`) : (left ? leftLabel : rightLabel);
  });
  const up = () => {
    if (!st) return;
    const { dx, on } = st; st = null;
    if (on) finish(dx, Math.abs(dx) >= SWIPE_AT);
  };
  tr.addEventListener('pointerup', up);
  tr.addEventListener('pointercancel', () => { if (!st) return; const on = st.on; st = null; if (on) finish(0, false); });
}

// ---------------------------------------------------------------- loading skeletons
// A few grey blocks (they shimmer gently) shaped like the page that is coming: a list, a set of tiles, a settings page or plain cards.
const SKELETON_SHAPE = { overview: 'tiles', transactions: 'list', accounts: 'list', advances: 'list', categories: 'tiles', tags: 'list', calendar: 'cal', exchange: 'cards', invest: 'cards', reports: 'report', settings: 'groups' };
function skeletonFor(route) {
  const sk = (cls, style) => h('i', { class: `sk ${cls}`, style: style || null });
  const row = () => h('div', { class: 'sk-row' }, sk('sk-dot'), h('div', { class: 'sk-lines' }, sk('sk-line', 'width:58%'), sk('sk-line sm', 'width:36%')), sk('sk-line', 'width:56px'));
  const shape = SKELETON_SHAPE[route] || 'cards';
  const parts = [sk('sk-title')];
  if (shape === 'tiles') parts.push(sk('sk-card tall'), h('div', { class: 'sk-tiles' }, [1, 2, 3, 4, 5, 6].map(() => sk('sk-tile'))));
  else if (shape === 'list') parts.push(sk('sk-card short'), h('div', { class: 'sk-list' }, [1, 2, 3, 4, 5, 6, 7].map(row)));
  else if (shape === 'cal') parts.push(sk('sk-line', 'width:52%;margin:0 auto 14px'), h('div', { class: 'sk-calgrid' }, Array.from({ length: 35 }, () => sk('sk-cell'))), sk('sk-card short'));
  else if (shape === 'report') parts.push(h('div', { class: 'sk-kpis' }, [1, 2, 3, 4].map(() => sk(''))), sk('sk-card tall'), sk('sk-card short'));
  else if (shape === 'groups') parts.push(sk('sk-line', 'width:46%;margin-top:18px'), sk('sk-card'), sk('sk-line', 'width:38%;margin-top:18px'), sk('sk-card'), sk('sk-line', 'width:42%;margin-top:18px'), sk('sk-card short'));
  else parts.push(sk('sk-card'), sk('sk-card tall'), sk('sk-card short'));
  return h('div', { class: 'skeleton', 'aria-hidden': 'true' }, parts);
}
