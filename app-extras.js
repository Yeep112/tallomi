/* Tallomi: undo, tags, receipt photos and multi-select on the transactions page.
   Loaded after app.js; uses its globals (h, api, S, toast, fail, openDialog, confirmBox, afterChange, catField, num ...). */
'use strict';

const MAX_PHOTOS = 4;
const PHOTO_LIMIT = 300000;        // bytes after shrinking; the server refuses anything above 400 000

// ------------------------------------------------------------------------- undo
// A toast button that puts a deleted entry (or a whole batch) back. The server keeps it for about a minute.
function undoAction(token) {
  if (!token) return null;
  return { label: '復原', run: async () => { await api('POST', '/api/undo', { token }); await afterChange('已復原'); } };
}

// ------------------------------------------------------------------------- tags
const splitTags = (text) => String(text || '').split(/[\s,，、;；]+/).map((x) => x.replace(/^#+/, '')).filter(Boolean);

// Tag input: type them (space or comma between), or tap one of the tags used before.
function tagField(m, redraw) {
  const input = h('input', { name: 'tags', autocomplete: 'off', autocapitalize: 'off', maxlength: 160, placeholder: '例如 日本旅行', value: m.tags || '', 'aria-label': '標籤' });
  const pick = h('div', { class: 'tag-pick' });
  const paint = () => {
    const have = new Set(splitTags(input.value).map((x) => x.toLowerCase()));
    pick.replaceChildren(...(S.st.tag_list || []).slice(0, 8).map((t) => {
      const on = have.has(t.tag.toLowerCase());
      return h('button', { type: 'button', class: 'tag-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), title: `${t.count} 筆`, onclick: () => {
        const cur = splitTags(input.value);
        const next = on ? cur.filter((x) => x.toLowerCase() !== t.tag.toLowerCase()) : [...cur, t.tag];
        input.value = next.join(' '); m.tags = input.value; paint();
      } }, '#' + t.tag);
    }));
  };
  input.addEventListener('input', () => { m.tags = input.value; paint(); });
  paint();
  // In the entry bar only: keep these tags on every new entry until ended (a trip, say).
  const pinBtn = redraw && !pinnedTags() ? h('button', { class: 'btn sm ghost tag-pin', type: 'button', title: '之後每一筆都自動帶上這些標籤，直到你按「結束」', onclick: () => {
    const t = splitTags(input.value).join(' ');
    if (!t) { toast('先輸入一個標籤，例如 日本旅行', true); input.focus(); return; }
    setPinnedTags(t); toast(`目前標籤：${splitTags(t).map((x) => '#' + x).join(' ')}，之後每一筆都會自動帶上`);
  } }, '📌 每筆都帶上') : null;
  return h('label', { class: 'field grow tag-field' }, h('span', null, '標籤'), input, pick, pinBtn);
}

// Little #tag buttons under a transaction's note; tapping one shows only that tag.
function showTag(tag) {
  S.txf.tag = tag;
  if (currentRoute() === 'transactions') renderRoute(); else location.hash = '#/transactions';
}
function tagChips(t) {
  if (!t.tags || !t.tags.length) return null;
  return h('span', { class: 'tx-tags' }, t.tags.map((g) => h('button', { type: 'button', class: 'tag-chip sm', title: `只看「${g}」`, onclick: () => showTag(g) }, '#' + g)));
}

// ------------------------------------------------------------------ receipt photos
// A photo is shrunk here, in the browser (longest side 1280 px, JPEG, under ~300 KB), so the book stays small.
async function shrinkImage(file, limit = PHOTO_LIMIT) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('這張圖片打不開。若是 HEIC 格式，請改拍「最相容」的 JPG，或換一張 JPG／PNG'));
      i.src = url;
    });
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) throw new Error('這張圖片打不開');
    for (const side of [1280, 1024, 800, 640, 480]) {
      for (const q of [0.8, 0.65, 0.5]) {
        const k = Math.min(1, side / Math.max(nw, nh));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(nw * k)); c.height = Math.max(1, Math.round(nh * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
        if (blob && blob.size <= limit) return blob;
      }
    }
    throw new Error('這張圖片太大，壓不到夠小，請換一張');
  } finally { URL.revokeObjectURL(url); }
}

// m.photos = new photos waiting to be saved; m.receipts = ids already stored (edit dialog); m.dropped = stored ones to delete on save.
function photoField(m) {
  m.photos = m.photos || []; m.receipts = m.receipts || []; m.dropped = m.dropped || [];
  const box = h('div', { class: 'ph-row' });
  const add = h('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, '＋ 收據照片');
  const note = h('span', { class: 'hint' });
  const total = () => m.receipts.length + m.photos.length;
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-label': '選擇收據照片', onchange: async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      if (total() >= MAX_PHOTOS) { toast(`每筆交易最多 ${MAX_PHOTOS} 張照片`, true); break; }
      try { const blob = await shrinkImage(f); m.photos.push({ blob, url: URL.createObjectURL(blob) }); paint(); } catch (err) { fail(err); }
    }
  } });
  const thumb = (src, label, remove) => h('div', { class: 'ph' }, h('img', { src, alt: label }),
    h('button', { class: 'ph-x', type: 'button', 'aria-label': `移除${label}`, title: '移除', onclick: remove }, '×'));
  function paint() {
    box.replaceChildren(
      ...m.receipts.map((id) => thumb(`/api/receipts/${id}`, '已存的收據', () => { m.receipts = m.receipts.filter((x) => x !== id); m.dropped.push(id); paint(); })),
      ...m.photos.map((p, i) => thumb(p.url, '新照片', () => { URL.revokeObjectURL(p.url); m.photos.splice(i, 1); paint(); })));
    add.disabled = total() >= MAX_PHOTOS;
    add.textContent = total() ? `＋ 再加一張（${total()}/${MAX_PHOTOS}）` : '＋ 收據照片';
    note.textContent = total() ? `${total()} / ${MAX_PHOTOS} 張，按「記下」或「儲存修改」後才會存進帳本` : `每張會自動縮小（約 300 KB 以內），最多 ${MAX_PHOTOS} 張`;
  }
  paint();
  return h('div', { class: 'field grow photo-field' }, h('span', null, '收據照片'), h('div', { class: 'ph-ctl' }, add, note), box, input);
}

// Upload what photoField collected. Returns how many failed so the caller can say so.
async function uploadPhotos(txId, m) {
  let failed = 0;
  for (const p of (m.photos || [])) {
    try { await api('POST', `/api/transactions/${txId}/receipts`, p.blob, true); } catch { failed += 1; }
    URL.revokeObjectURL(p.url);
  }
  m.photos = [];
  return failed;
}
async function dropReceipts(m) {
  for (const id of (m.dropped || [])) { try { await api('DELETE', `/api/receipts/${id}`); } catch { /* already gone */ } }
  m.dropped = [];
}
function forgetPhotos(m) { (m.photos || []).forEach((p) => URL.revokeObjectURL(p.url)); m.photos = []; m.receipts = []; m.dropped = []; }

function openReceiptViewer(t) {
  openDialog({
    title: `收據照片（${t.receipts.length}）`, wide: true,
    body: h('div', { class: 'rc-view' }, t.receipts.map((id) => h('a', { href: `/api/receipts/${id}`, target: '_blank', rel: 'noopener', title: '用新分頁開啟原圖' }, h('img', { src: `/api/receipts/${id}`, alt: '收據' })))),
  });
}
function receiptMark(t) {
  if (!t.receipts || !t.receipts.length) return null;
  return h('button', { type: 'button', class: 'rc-mark', title: `${t.receipts.length} 張收據照片`, 'aria-label': `看 ${t.receipts.length} 張收據照片`, onclick: () => openReceiptViewer(t) }, `📎${t.receipts.length > 1 ? t.receipts.length : ''}`);
}

// ------------------------------------------------------------------ multi-select
function resetSelection() { S.sel = new Set(); }      // S.selMode / S.sel start out in app.js

async function bulkDo(action, extra, doneText) {
  const ids = [...S.sel];
  const r = await api('POST', '/api/transactions/bulk', { ids, action, ...extra });
  S.sel = new Set();
  const skip = r.skipped ? `；略過 ${r.skipped} 筆（股票交易、轉帳或不適用的類型）` : '';
  await afterChange(`${doneText(r.changed)}${skip}`, r.changed ? undoAction(r.undo) : null);
}

function bulkCategory() {
  const m = { type: 'all', category: '' };
  openDialog({
    title: `改 ${S.sel.size} 筆的類別`, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' }, catField(m),
      h('p', { class: 'hint' }, '只有收入與支出會改；轉帳、調整與股票交易會略過。輸入新名稱就會建立新類別。')),
    primary: { label: '改類別', run: async () => {
      const c = (m.category || '').trim();
      if (!c) throw new Error('請輸入或選擇一個類別');
      await bulkDo('category', { category: c }, (n) => `已把 ${n} 筆改成「${c}」，可以復原`);
    } },
  });
}
function bulkTag(remove) {
  const m = { tags: '' };
  const f = tagField(m);
  openDialog({
    title: `${remove ? '移除' : '加上'}標籤（${S.sel.size} 筆）`, body: h('div', { class: 'rows', style: 'padding:0;max-width:none' }, f,
      h('p', { class: 'hint' }, remove ? '這些交易如果有這個標籤，就會拿掉。一次處理一個標籤。' : '原本的標籤會保留，只多加這一個。一次加一個標籤。')),
    primary: { label: remove ? '移除標籤' : '加上標籤', run: async () => {
      const tags = splitTags(m.tags);
      if (tags.length !== 1) throw new Error('請輸入一個標籤（要處理多個，請分次進行）');
      await bulkDo(remove ? 'tag_remove' : 'tag_add', { tag: tags[0] }, (n) => `已${remove ? '移除' : '加上'}「#${tags[0]}」：${n} 筆，可以復原`);
    } },
  });
}
async function bulkDelete() {
  const n = S.sel.size;
  const ok = await confirmBox({ title: `刪除 ${n} 筆交易？`, message: h('p', null, `帳戶餘額會立刻重新計算。如果其中有代墊，已記下的收款（朋友還的錢）會一起刪除。刪除後約一分鐘內可以按「復原」救回來。`), confirmLabel: `刪除 ${n} 筆`, danger: true });
  if (!ok) return;
  try { await bulkDo('delete', {}, (c) => `已刪除 ${c} 筆`); } catch (e) { fail(e); }
}

// The bar that appears above the list while selecting.
function selectionBar(items, repaint) {
  const n = S.sel.size;
  const allOn = items.length > 0 && items.every((t) => S.sel.has(t.id));
  const act = (label, fn, cls = '') => h('button', { class: 'btn sm ' + cls, type: 'button', disabled: !n, onclick: fn }, label);
  return h('div', { class: 'sel-bar', role: 'toolbar', 'aria-label': '多筆操作' },
    h('b', { class: 'sel-n' }, `已勾選 ${n} 筆`),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { if (allOn) items.forEach((t) => S.sel.delete(t.id)); else items.forEach((t) => S.sel.add(t.id)); repaint(true); } }, allOn ? '取消全選' : `全選目前列出的 ${items.length} 筆`),
    act('改類別', bulkCategory), act('加標籤', () => bulkTag(false)), act('移除標籤', () => bulkTag(true)),
    act('刪除', () => bulkDelete(), 'danger'),
    h('button', { class: 'btn sm ghost sel-end', type: 'button', onclick: () => { resetSelection(); repaint(true); } }, '取消勾選'));
}

// Settings: how much the receipt photos take up (they are inside every backup too).
function receiptNote() {
  const r = S.st.receipt_stats || { count: 0, bytes: 0 };
  if (!r.count) return '收據照片：還沒有。在記帳或編輯時按「＋ 收據照片」可以附上，每張會自動縮小到約 300 KB 以內。';
  return `收據照片：${r.count} 張，約 ${(r.bytes / 1048576).toFixed(1)} MB（照片存在帳本裡，備份也會包含）。`;
}

// Settings: start Tallomi by itself (quietly, tray icon only) when you sign in to Windows.
async function loadAutostart(box) {
  const st = await api('GET', '/api/autostart');
  if (!st.supported) { box.remove(); return; }
  const paint = (s) => {
    const cb = h('input', { type: 'checkbox', checked: s.enabled, onchange: async (e) => {
      const want = e.target.checked;
      try {
        const r = await api('PUT', '/api/autostart', { enabled: want });
        paint(r); toast(want ? '已設定：登入 Windows 時會自動在背景啟動' : '已取消開機自動啟動');
      } catch (err) { e.target.checked = !want; fail(err); }
    } });
    box.replaceChildren(...[
      h('label', { class: 'tally-toggle' }, cb, h('span', null, '登入 Windows 時自動在背景啟動 Tallomi（沒有視窗，只有右下角的圖示）')),
      h('p', { class: 'hint', style: 'margin:4px 0 0' }, '這樣手機同步、匯率與股價更新、每日自動備份不必先開程式也會運作。要看帳本時，點圖示或用桌面捷徑開啟視窗。'),
      s.enabled && s.disabled_by_windows ? h('p', { class: 'hint bad', style: 'margin:4px 0 0' }, 'Windows 的「工作管理員 → 啟動應用程式」把 Tallomi 設成已停用，所以實際上不會啟動。重新勾選一次這個選項，或到工作管理員改成「已啟用」。') : null,
      s.enabled ? h('p', { class: 'hint', style: 'margin:4px 0 0' }, s.last_start ? '上次在背景啟動：' + s.last_start + '（重新開機後，這裡的時間應該會更新成開機後不久。）' : '還沒有在背景啟動過。登出再登入（或重新開機）一次之後，這裡會顯示啟動時間；如果仍然沒有，請把 %APPDATA%\\Pennyworth\\pennyworth.log 與 launch.log 給我看。') : null,
      s.enabled && !s.up_to_date ? h('p', { class: 'hint', style: 'margin:4px 0 0' }, '登錄的啟動路徑和目前這份程式不同，下次啟動時會自動更新。') : null].filter(Boolean));
  };
  paint(st);
}
