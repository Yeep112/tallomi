'use strict';
/* 1.60.0 — 快速記帳網址: a link that opens the "記一筆" form with the account, category, amount … already filled in,
     <address of the app>#/add?type=expense&account=現金&category=早餐&amount=65&note=豆漿
   Put it behind a Home Screen icon, an iPhone Shortcut, a bookmark or the taskbar's jump list and a purchase is one tap and one confirmation.
   A link never saves anything by itself: it only fills the form, and the person presses 記下. (A page that did something just because it was opened
   could be made to write entries by any link someone sends.)  Uses helpers from app.js / app-tiles.js at run time.
   Loaded before app.js on purpose: the listener below sees a link first and keeps the page on the screen it was on. */
const QUICK_TYPES = { expense: 'expense', 支出: 'expense', income: 'income', 收入: 'income', transfer: 'transfer', 轉帳: 'transfer' };
const isQuickHash = (hash) => /^#\/add(\?|$)/.test(hash || '');
const quickClean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// -> what the link asks for, every value already tidied: unknown or odd values become empty and are simply not filled in
function quickParse(hash) {
  const at = (hash || '').indexOf('?');
  let sp; try { sp = new URLSearchParams(at < 0 ? '' : hash.slice(at + 1)); } catch { sp = new URLSearchParams(''); }
  const get = (k, max = 200) => quickClean(sp.get(k), max);
  const amount = get('amount', 30).replace(/,/g, '');
  let date = get('date', 10);
  if (date) {                                                              // a real calendar day, written YYYY-MM-DD
    const d = new Date(date + 'T00:00:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(d) || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` !== date) date = '';
  }
  return {
    type: QUICK_TYPES[get('type', 20).toLowerCase()] || 'expense',
    account: get('account', 40), to: get('to', 40), category: get('category', 60), note: get('note', 500), tags: get('tags', 200),
    amount: /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 ? amount : '',
    date,
    inbox: ['1', 'true', 'yes', 'on'].includes(get('inbox', 6).toLowerCase()), merchant: get('merchant', 80), card: get('card', 60), amountRaw: get('amount', 40),
  };
}
// the account a link names: its exact name (any case), else its number, else a name that contains the words (only when that is unambiguous)
function quickAccount(want, pool) {
  const t = String(want || '').trim().toLowerCase();
  if (!t) return null;
  const byName = pool.find((a) => a.name.toLowerCase() === t);
  if (byName) return byName;
  if (/^\d+$/.test(t)) { const byId = pool.find((a) => String(a.id) === t); if (byId) return byId; }
  const part = pool.filter((a) => a.name.toLowerCase().includes(t));
  return part.length === 1 ? part[0] : null;
}
function quickBuild(base, g) {
  const sp = new URLSearchParams();
  if (g.type && g.type !== 'expense') sp.set('type', g.type);
  const keys = g.type === 'transfer' ? ['account', 'to', 'amount', 'note', 'tags'] : ['account', 'category', 'amount', 'note', 'tags'];
  keys.forEach((k) => { const v = String(g[k] || '').trim(); if (v) sp.set(k, v); });
  const q = sp.toString();
  return `${base}#/add${q ? '?' + q : ''}`;
}

// Open the form the link describes. Returns false when there is nothing to open it on (still starting, first-run wizard, no account yet).
function quickLinkOpen(hash) {
  if (!S.st || S.st.onboarding) return false;
  const p = quickParse(hash);
  if (p.inbox) { inboxArrive(p).catch(fail); return true; }                // from a Shortcut: it waits in 待確認, nothing is recorded yet
  const pool = activeAccounts();
  if (!pool.length) { toast('還沒有帳戶，請先到「帳戶」新增一個', true); return false; }
  const seed = {}, unknown = [];
  const from = p.account ? quickAccount(p.account, pool) : null;
  if (p.account && !from) unknown.push(`帳戶「${p.account}」`);
  if (from) seed.account_id = from.id;
  if (p.type === 'transfer') {
    const to = p.to ? quickAccount(p.to, pool) : null;
    if (p.to && !to) unknown.push(`轉入帳戶「${p.to}」`);
    if (to && (!from || to.id !== from.id)) seed.to_account_id = to.id;
  } else if (p.category) seed.category = p.category;
  if (p.amount) seed.amount = p.amount;
  if (p.note) seed.note = p.note;
  if (p.tags) seed.tags = p.tags;
  openQuickAdd({ type: p.type, category: seed.category || '', date: p.date, seed, title: '快速記帳' });
  if (unknown.length) toast(`找不到${unknown.join('、')}，請在表單裡選擇`, true);
  return true;
}

// ---- how the page receives a link
// Cold start: boot() (app.js) calls quickLinkStart() once the book is loaded (after a PIN lock, if there is one). While the app is open: a link that only
// changes the part after the # arrives as a hashchange; it is taken here, the address goes back to the page that was showing, and the page is not rebuilt.
let quickPending = null, quickLast = isQuickHash(location.hash) ? '#/overview' : (location.hash || '#/overview');
const quickHome = (hash) => { history.replaceState(null, '', location.pathname + location.search + hash); };
window.addEventListener('hashchange', (e) => {
  if (!isQuickHash(location.hash)) { quickLast = location.hash || '#/overview'; return; }
  const link = location.hash;
  quickHome(quickLast);
  e.stopImmediatePropagation();                                           // the page itself did not change: no need to build it again
  if (!quickLinkOpen(link) && !S.st) quickPending = link;                // still starting: boot picks it up
});
function quickLinkStart() {
  const link = quickPending || (isQuickHash(location.hash) ? location.hash : null);
  quickPending = null;
  if (!link) return;
  if (isQuickHash(location.hash)) quickHome('#/overview');
  quickLast = location.hash || '#/overview';
  quickLinkOpen(link);
}

// ---- Settings: make a link
// Where the link points: the address the phone opens (set under 手機連線) when this is the computer, else the address of the page being used.
async function quickBase() {
  const here = location.origin + location.pathname.replace(/[^/]*$/, '');
  if (S.st.remote || S.st.phone) return here;
  try { const info = await api('GET', '/api/remote'); if (info && info.url) return info.url.replace(/\/+$/, '') + '/'; } catch { /* not available: use this window's address */ }
  return here;
}
function quickQr(text) {
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': '快速記帳網址的 QR code' });
  try { const q = qrcode(0, 'L'); q.addData(text); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }      // generated by the library from the text only
  catch { box.textContent = '網址太長，無法產生 QR code。'; }
  return box;
}
async function quickCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not allowed here: fall back below */ }
  const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' }); ta.value = text; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}

async function openQuickLinkBuilder() {
  const base = await quickBase();
  const pool = activeAccounts();
  const g = { type: 'expense', account: pool[0] ? pool[0].name : '', to: '', category: '', amount: '', note: '', tags: '' };
  const out = h('div', { class: 'ql-out' });
  const holder = h('div', { class: 'rows', style: 'padding:0;max-width:none' });
  const paintOut = () => {
    const url = quickBuild(base, g);
    out.replaceChildren(
      h('div', { class: 'field' }, h('span', null, '網址'), h('input', { class: 'ql-url', readonly: true, value: url, 'aria-label': '快速記帳網址', onfocus: (e) => e.target.select() })),
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { toast((await quickCopy(url)) ? '已複製網址' : '複製失敗，請按住上面的網址自行複製', false); } }, '複製網址'),
        h('button', { class: 'btn', type: 'button', onclick: () => quickLinkOpen(url.slice(url.indexOf('#'))) }, '試試看')),
      h('div', { class: 'ql-qr' }, quickQr(url), h('span', { class: 'hint' }, '用手機相機掃，就能在手機打開這個連結。')));
  };
  const draw = () => {
    const accSel = (key, label) => h('label', { class: 'field half' }, h('span', null, label),
      h('select', { onchange: (e) => { g[key] = e.target.value; paintOut(); } }, h('option', { value: '' }, '（開啟後再選）'),
        pool.map((a) => h('option', { value: a.name, selected: a.name === g[key] }, `${a.name}（${a.currency}）`))));
    const cats = g.type === 'transfer' ? [] : catOptions('', g.type, false);
    holder.replaceChildren(
      h('div', { class: 'seg', role: 'group', 'aria-label': '交易類型' }, ['expense', 'income', 'transfer'].map((t) => h('button', { type: 'button', 'aria-pressed': String(g.type === t),
        onclick: () => { g.type = t; if (t === 'transfer' && !g.to) { const o = pool.find((a) => a.name !== g.account); g.to = o ? o.name : ''; } draw(); } }, TYPE_LABEL[t]))),
      h('div', { class: 'grid2' },
        accSel('account', g.type === 'transfer' ? '轉出帳戶' : '帳戶'),
        g.type === 'transfer' ? accSel('to', '轉入帳戶')
          : h('label', { class: 'field half' }, h('span', null, '類別'), h('select', { onchange: (e) => { g.category = e.target.value; paintOut(); } }, h('option', { value: '' }, '（開啟後再選）'),
            cats.map((c) => h('option', { value: c, selected: c === g.category }, c)))),
        h('label', { class: 'field half' }, h('span', null, '金額（可留空）'), h('input', { inputmode: 'decimal', autocomplete: 'off', value: g.amount, placeholder: '例如 65', oninput: (e) => { g.amount = e.target.value; paintOut(); } })),
        h('label', { class: 'field half' }, h('span', null, '備註（可留空）'), h('input', { autocomplete: 'off', maxlength: 100, value: g.note, placeholder: '例如 早餐', oninput: (e) => { g.note = e.target.value; paintOut(); } })),
        h('label', { class: 'field' }, h('span', null, '標籤（可留空，用空白分開）'), h('input', { autocomplete: 'off', maxlength: 100, value: g.tags, oninput: (e) => { g.tags = e.target.value; paintOut(); } }))),
      out);
    paintOut();
  };
  draw();
  openDialog({ title: '建立快速記帳網址', wide: true, body: h('div', null,
    h('p', { class: 'hint', style: 'margin:0 0 10px' }, '打開網址會跳出填好的「記一筆」表單，按「記下」才會存。'),
    holder) });
}

function quickLinkSection() {
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '快速記帳')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '做一個連結，打開就是填好帳戶、類別、金額的「記一筆」表單（還是要按「記下」才會存）。常記的幾筆（早餐、捷運、午餐…）各做一個，放到手機主畫面或 iPhone 捷徑，一點就開。'),
      h('div', { class: 'row-inline' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openQuickLinkBuilder().catch(fail) }, '建立快速記帳網址…')),
      h('details', null, h('summary', { class: 'hint', style: 'cursor:pointer' }, '怎麼放到 iPhone、Android 或電腦？'),
        h('ol', { class: 'steps' },
          h('li', null, h('b', null, 'iPhone：'), '先在這裡建立網址並複製。打開「捷徑」App →「＋」→ 加入動作「打開 URL」→ 貼上網址 → 點右上角「⌄」→「加入主畫面」。之後點那顆圖示就會開出表單。'),
          h('li', null, 'iPhone 注意：捷徑的「打開 URL」會用 Safari 開，而 Safari 和主畫面上的 Tallomi 登入狀態是分開的。第一次點時 Safari 會要你輸入配對碼（和配對手機同一個步驟，只需一次）。'),
          h('li', null, h('b', null, 'Android：'), '用 Chrome 打開網址 → 「⋮」→「加到主畫面」。Tallomi 圖示長按也會出現「記一筆」捷徑。'),
          h('li', null, h('b', null, '電腦：'), '把網址存成瀏覽器書籤，或在桌面「新增 → 捷徑」貼上網址。')),
        h('p', { class: 'hint' }, '網址格式：',
          h('code', null, '#/add?type=expense&account=現金&category=早餐&amount=65&note=豆漿'),
          '。type 可用 expense / income / transfer；帳戶與類別用名稱；金額、備註、標籤、date（YYYY-MM-DD）可省略。找不到的帳戶會留空讓你自己選。'))));
}

// ---- Settings: 分享給其他人 (1.69.0). A QR code and an address that open the download page for other people: phones open the phone version from it,
// computers get the Windows download. Made on the spot (no network, nothing is sent anywhere). It lives in this file to keep the phone site's file count down.
function shareQrBlob(text) {
  return new Promise((ok, no) => {
    try {
      const q = qrcode(0, 'M'); q.addData(text); q.make();
      const img = new Image();
      img.onload = () => {
        const n = 1000, cv = h('canvas', { width: n, height: n }), cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, n, n); cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, n, n);
        cv.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/png');
      };
      img.onerror = () => no(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.createSvgTag({ cellSize: 10, margin: 4, scalable: false }));
    } catch (e) { no(e); }
  });
}

function shareQr(url, label) {
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': `${label}的 QR code` });
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }      // made by the library from the address only
  catch { box.textContent = '無法產生 QR code，請直接用下面的網址。'; }
  return box;
}

function shareSection() {
  const base = ((S.st && S.st.share_url) || '').replace(/\/+$/, '');
  if (!base) return null;                                                   // an older saved copy of the state: nothing to show
  const kinds = [['page', '下載頁（手機＋電腦）', base + '/'], ['phone', '只開手機版', base + '/app/']];
  let cur = 'page';
  const box = h('div', { class: 'share-box' });
  const paint = () => {
    const [, label, url] = kinds.find((k) => k[0] === cur);
    box.replaceChildren(
      h('div', { class: 'seg', role: 'group', 'aria-label': '要分享哪一個' }, kinds.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(cur === k), onclick: () => { cur = k; paint(); } }, l))),
      h('div', { class: 'share-qr' }, shareQr(url, label),
        h('div', { class: 'share-side' },
          h('label', { class: 'field' }, h('span', null, '網址'), h('input', { class: 'ql-url share-url', readonly: true, value: url, 'aria-label': `${label}的網址`, onfocus: (e) => e.target.select() })),
          h('div', { class: 'row-inline' },
            h('button', { class: 'btn primary', type: 'button', onclick: async () => { toast((await quickCopy(url)) ? '已複製網址' : '複製失敗，請按住上面的網址自行複製', false); } }, '複製網址'),
            navigator.share ? h('button', { class: 'btn', type: 'button', onclick: () => { navigator.share({ title: 'Tallomi', text: 'Tallomi 個人帳本', url }).catch(() => {}); } }, '分享…') : null,
            h('button', { class: 'btn', type: 'button', onclick: async () => {
              try { saveBlob(cur === 'page' ? 'tallomi-download-qr.png' : 'tallomi-phone-qr.png', await shareQrBlob(url)); toast('已下載 QR code 圖片'); } catch { toast('這個瀏覽器無法存成圖片，請直接用截圖', false); }
            } }, '下載 QR 圖片')))),
      h('p', { class: 'hint', style: 'margin:0' }, cur === 'page'
        ? '對方用手機掃，就會開啟下載頁：手機可直接使用，電腦在同一頁下載 Windows 版。'
        : '對方用手機掃，會直接開啟手機版。第一次開啟約 15 MB。iPhone 請用 Safari，Android 請用 Chrome。'));
  };
  paint();
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '分享給其他人')),
    h('div', { class: 'rows' }, box,
      h('p', { class: 'hint', style: 'margin:0' }, '給朋友的是「用戶版」：他們的帳本只存在自己的裝置，不會傳給你，也看不到你的資料。')));
}


// ---- 待確認 (1.70.0): what arrives by itself (a Shortcut after an Apple Pay payment, a Back Tap …) waits here until you pick the category
// A link with inbox=1 stores one item and shows a toast; it never records anything. Items count nowhere until confirmed (server: app/inbox.py).
const INBOX_MEM = 'pw_inbox_acct';                                              // which account each card went to last time, per card name
const inboxMem = () => { try { const v = JSON.parse(localStorage.getItem(INBOX_MEM) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
function inboxRemember(card, id) {
  if (!card || !id) return;
  try { const m = inboxMem(); m[card] = id; localStorage.setItem(INBOX_MEM, JSON.stringify(m)); } catch { /* storage not available: asked again next time */ }
}
// the account for a card name: the one chosen last time, else a name match (either way round) when it is unambiguous
function inboxAccount(card, pool) {
  if (!card) return null;
  const mem = inboxMem()[card], keep = mem && pool.find((a) => a.id === mem);
  if (keep) return keep;
  const hit = quickAccount(card, pool);
  if (hit) return hit;
  const low = card.toLowerCase(), within = pool.filter((a) => a.name.length >= 2 && low.includes(a.name.toLowerCase()));
  return within.length === 1 ? within[0] : null;
}
async function inboxArrive(p) {
  const res = await api('POST', '/api/inbox', { cid: newClientId(), amount: p.amountRaw, merchant: p.merchant, card: p.card, note: p.note, source: 'link' });
  await refresh();
  const n = (S.st.inbox || []).length;
  toast(res.duplicate ? `這筆已經在「待確認」了（共 ${n} 筆）` : `已放進「待確認」（共 ${n} 筆），到首頁選類別就會記下`, false);
}
function inboxBanner() {
  const n = (S.st.inbox || []).length;
  if (!n) return null;
  return h('div', { class: 'banner inbox-banner' },
    h('span', null, h('b', null, `有 ${n} 筆待確認：`), '自動帶入的付款，選好類別才會正式記下'),
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => openInbox() }, '查看並確認'));
}
function inboxConfirm(it) {
  const pool = activeAccounts(), acc = inboxAccount(it.card, pool);
  const seed = {};
  if (acc) seed.account_id = acc.id;
  if (it.amount) seed.amount = it.amount;
  if (it.merchant || it.note) seed.note = [it.merchant, it.note].filter(Boolean).join(' ');
  openQuickAdd({ type: 'expense', date: it.created_at.slice(0, 10), seed, title: '確認這筆待確認的付款',
    onSaved: async (m) => {
      await api('POST', '/api/inbox/remove', { cid: it.cid });
      inboxRemember(it.card, m.account_id);
    } });
}
function openInbox() {
  const items = S.st.inbox || [];
  const row = (it) => h('div', { class: 'inbox-row' },
    h('div', { class: 'inbox-main' },
      h('b', null, it.merchant || '（沒有帶入店名）'),
      h('span', { class: 'hint' }, [shortTime(it.created_at), it.card].filter(Boolean).join('・'))),
    h('div', { class: 'inbox-amt num' }, it.amount ? num(+it.amount, S.st.base) : '金額沒帶入'),
    h('div', { class: 'row-inline' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => { dlg.close(); inboxConfirm(it); } }, '確認'),
      h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `刪除 ${it.merchant || '這筆'}`, onclick: async () => {
        try { await api('POST', '/api/inbox/remove', { cid: it.cid }); await refresh(); dlg.close(); if ((S.st.inbox || []).length) openInbox(); } catch (e) { fail(e); } } }, '刪除')));
  const dlg = openDialog({ title: `待確認（${items.length}）`, wide: true,
    extraFoot: items.length > 1 ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      if (!(await confirmBox({ title: '全部刪除？', message: `這 ${items.length} 筆待確認都不記下，直接刪掉。`, confirmLabel: '全部刪除', danger: true }))) return;
      try { await api('POST', '/api/inbox/clear'); dlg.close(); await refresh(); } catch (e) { fail(e); } } }, '全部刪除') : null,
    body: h('div', { class: 'inbox-list' }, items.length ? items.map(row) : h('p', { class: 'hint' }, '沒有待確認的付款。')) });
  return dlg;
}

// ---- Settings: 自動記帳（待確認）— how to set up Back Tap and the Apple Pay automation, and a way to try it
function inboxSection() {
  const n = (S.st.inbox || []).length;
  const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  const tpl = async () => (await quickBase()) + '#/add?inbox=1&amount=&merchant=&card=';
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '自動記帳（待確認）')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '用 iPhone 的「背面輕點」或「Apple Pay 付款後自動執行」把付款送進來。送來的付款不會直接記下，會先放進「待確認」，你點一下、選好類別，才算正式一筆。'),
      S.st.phone && standalone ? h('div', { class: 'banner late' }, h('span', null,
        h('b', null, '你正在用主畫面上的 App：'), '捷徑會用 Safari 打開網址，而 Safari 和主畫面 App 的帳本是分開的，付款會進到 Safari 那一份。要用自動記帳，請固定用 Safari 開 Tallomi（不要加到主畫面），或改用和電腦配對的手機。')) : null,
      h('div', { class: 'row-inline' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => openInbox() }, n ? `查看待確認（${n}）` : '查看待確認'),
        h('button', { class: 'btn', type: 'button', onclick: () => inboxArrive({ amountRaw: '120', merchant: '測試商店', card: '', note: '' }).catch(fail) }, '送一筆測試'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { toast((await quickCopy(await tpl())) ? '已複製網址' : '複製失敗', false); } }, '複製自動記帳網址')),
      h('details', null, h('summary', { class: 'hint', style: 'cursor:pointer' }, '設定「背面輕點」（輕敲 iPhone 背面兩下就記一筆）'),
        h('ol', { class: 'steps' },
          h('li', null, '先在上面「快速記帳」建立網址（帳戶、類別、金額可以先填好常用的），複製起來。'),
          h('li', null, '打開「捷徑」App →「＋」→ 加入動作「打開 URL」→ 貼上網址，名稱取「記一筆」。'),
          h('li', null, '到「設定 → 輔助使用 → 觸控 → 背面輕點」，選「輕點兩下」或「輕點三下」，再選剛才的捷徑「記一筆」。'),
          h('li', null, '輕敲背面就會開出填好的「記一筆」表單。（需要 iPhone 8 以上、iOS 14 以上；裝了厚的保護殼可能要敲重一點。）'))),
      h('details', null, h('summary', { class: 'hint', style: 'cursor:pointer' }, '設定「Apple Pay 付款後自動送進待確認」（iOS 17 以上）'),
        h('ol', { class: 'steps' },
          h('li', null, '先按上面的「複製自動記帳網址」。'),
          h('li', null, '打開「捷徑」App →「自動化」→「＋」→ 選「交易」（英文介面是 Transaction）→ 選要監看的卡片 → 選「立即執行」。'),
          h('li', null, '加入動作「打開 URL」，貼上網址，再在 amount= 後面插入「捷徑輸入」的「金額」、merchant= 後面插「商家」、card= 後面插「卡片」。'),
          h('li', null, '之後每次用 Apple Pay 付款，iPhone 會自動打開這個網址，Tallomi 把它放進「待確認」；付款當下會短暫跳出 Safari。'),
          h('li', null, '店名含 & # + 這類符號時，網址會被切斷；在捷徑裡先用「URL 編碼」動作處理「商家」再放進網址即可（一般店名不用）。')),
        h('p', { class: 'hint' }, '要知道的限制：「錢包」App 需要允許使用行動數據，自動化才會觸發。iPhone 偶爾會把金額傳成 0、或店名留空，Tallomi 照樣收下，確認時再補。這是 iPhone 自動化本身的限制，偶爾會漏掉一筆，所以月底對帳時仍建議看一眼。'),
        h('p', { class: 'hint' }, '電腦配對的手機：帳本存在電腦上，捷徑開 Safari 沒有問題（第一次要輸入配對碼，只需一次）。用戶版手機：帳本存在手機瀏覽器裡，請固定用 Safari 使用。'))));
}
