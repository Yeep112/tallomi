/* 1.61.0 — 提早要資料 (ask ahead).
   A page is built after the program state has arrived, and most pages then ask the computer for their own data, one question after the other.
   Over the phone link (Tailscale: 100 ms and more per question) those waits add up to what feels like "the page is thinking".
   This file remembers which questions each page asked the last time and sends them all at once, together with the question for the state,
   so the page finds its answers waiting. It also starts the state question while the program files are still being read.
   Safety: an answer is used only if it is not older than the newest change this window knows of (the X-Rev of every reply), is used once,
   and is dropped after a few seconds; a question that fails is simply asked again the normal way (so the PIN lock and pairing still work).
   Only functions and constants here: S and the page builders live in app.js, which loads after this file. */
'use strict';

const PF_TTL = 8000;                                     // an answer nobody asked for is thrown away after this long (ms)
const PF_KEEP = 'pw_pf1';                                // what each page asked last time, kept in the browser for the first page after a restart
const PF_SKIP = /^\/api\/(rev|ping|sheets|state|update|lock|invest\/fetch|market\/refresh)(\?|\/|$)/;      // moving, polled or write-like questions are never sent ahead
const pfAsked = new Map();                               // path -> { at, p } : questions on their way
let pfSeen = null;                                       // route -> [paths]
let pfRecording = null;                                  // the list a page's questions go into while it is being built

// Not on the public phone copy (its "computer" is a worker in the page: asking ahead only queues work there) and not while offline.
// With offline mode on it still helps: offlineApi() asks the network through apiNet(), where the answers waiting here are picked up.
const pfOn = () => !window.PW_PHONE && navigator.onLine !== false;

function pfStore() {
  if (pfSeen) return pfSeen;
  try { const v = JSON.parse(localStorage.getItem(PF_KEEP) || '{}'); pfSeen = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { pfSeen = {}; }
  return pfSeen;
}

// A computer that does not answer at all (Tailscale drops the packets of a computer that is off) must not hold the first page for minutes. With the
// phone's own copy switched on a question gives up after the same while api() would have waited (app-local.js: locSlow) and the page goes over to the
// copy; without it there is nothing else to fall back on, so the question just waits. (localStorage is read directly: app-local.js loads later.)
function pfGuardMs() {
  try {
    if (localStorage.getItem('pw_local') !== '1') return 0;
    const t = Number(localStorage.getItem('pw_loc_down')) || 0;
    return t && Date.now() - t < 600000 ? 1800 : 7000;
  } catch { return 0; }
}

function pfGo(path) {
  const old = pfAsked.get(path), now = Date.now();
  if (old && now - old.at < PF_TTL) return old;
  for (const [k, e] of pfAsked) if (now - e.at >= PF_TTL) pfAsked.delete(k);
  if (pfAsked.size > 40) pfAsked.clear();
  const e = { at: now, p: null };
  const ms = pfGuardMs(), ac = ms && typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => { try { ac.abort(); } catch { /* done already */ } if (typeof locNoteSilent === 'function') locNoteSilent(); }, ms) : 0;
  e.p = fetch(path, ac ? { headers: { 'X-Pennyworth': '1' }, signal: ac.signal } : { headers: { 'X-Pennyworth': '1' } }).then(async (r) => {
    clearTimeout(timer);
    if (!r.ok) return null;                              // locked, not paired, an old program, ...: the normal request deals with it
    return { data: await r.json(), rev: Number(r.headers.get('X-Rev')) || 0 };
  }).catch(() => { clearTimeout(timer); return null; });
  pfAsked.set(path, e);
  return e;
}

// The answer to `path` if one was asked ahead and is still good; otherwise null (and the caller asks the normal way).
async function pfTake(path) {
  const e = pfAsked.get(path);
  if (!e) return null;
  pfAsked.delete(path);
  if (Date.now() - e.at > PF_TTL) return null;
  const got = await e.p;
  const known = (typeof S === 'object' && S && S.rev) || 0;
  if (!got || got.rev < known) return null;              // something changed after this answer was made: ask again
  if (got.rev > known && typeof S === 'object' && S) S.rev = got.rev;
  return got;
}

// Send every question this page asked last time (called when moving to a page and after a refresh).
function pfRoute(route) {
  if (!pfOn()) return;
  const list = pfStore()[route];
  if (Array.isArray(list)) for (const p of list.slice(0, 8)) if (typeof p === 'string' && p.startsWith('/api/') && !PF_SKIP.test(p)) pfGo(p);
}

// 1.62.0 — a head start. A tap takes 80–150 ms between the finger touching a tab and the page change; a slide takes longer. Those milliseconds are
// spent asking the page's questions already: the finger going down on a menu icon, or a page-slide that has started, sends them at once.
// If the person changes their mind the answers just wait their few seconds and are thrown away (they are only ever read, never written).
function pfHeadStart(route) { if (route && typeof ROUTES === 'object' && ROUTES[route] && route !== (typeof S === 'object' && S && S.route)) pfRoute(route); }
document.addEventListener('pointerdown', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('.nav a[data-route], .side a[data-route]') : null;
  if (a && e.isPrimary !== false && (e.pointerType !== 'mouse' || e.button === 0)) pfHeadStart(a.dataset.route);
}, true);

// Learning: while a page is built, api() reports every GET it makes.
function pfBegin() { return (pfRecording = []); }
function pfNote(path) {
  if (pfRecording && path.length < 300 && !PF_SKIP.test(path) && !pfRecording.includes(path)) pfRecording.push(path);
}
function pfEnd(route, rec, ok) {
  if (pfRecording === rec) pfRecording = null;
  else return;                                           // another page started meanwhile: the two lists would be mixed up
  if (!ok) return;
  const mine = rec.slice(0, 8), all = pfStore();
  if (JSON.stringify(all[route] || []) === JSON.stringify(mine)) return;
  if (mine.length) all[route] = mine; else delete all[route];
  try { localStorage.setItem(PF_KEEP, JSON.stringify(all)); } catch { /* storage full or blocked: the list still works until the page closes */ }
}

// The state: asked for here, while the other program files are still loading; refresh() in app.js picks it up.
async function pfState() {
  const b = window.pfBoot; window.pfBoot = null;
  if (b && pfOn() && Date.now() - b.at < 20000) {
    const got = await b.p;
    if (got && got.data && got.data.version) {
      if (typeof S === 'object' && S && got.rev > (S.rev || 0)) S.rev = got.rev;
      return got.data;
    }
  }
  return null;
}

if (pfOn()) {
  window.pfBoot = pfGo('/api/state');
  pfAsked.delete('/api/state');                          // kept apart: only pfState() takes it
  const first = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'overview';
  pfRoute(first);
}
