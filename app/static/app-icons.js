/* Icons: one cute picture + colour per category (shared by every transaction of that category) and one per account.
   Pictures are the bundled Twemoji files (see emoji/LICENSE.txt); anything else the user types is shown as a text emoji.
   Nothing is stored for a category until the user changes it - until then the picture is chosen from the name. */
'use strict';

const CHIP_COLORS = ['#94A3B8', '#A8A29E', '#F87171', '#FB923C', '#FBBF24', '#FACC15', '#A3E635', '#4ADE80', '#34D399',
  '#2DD4BF', '#22D3EE', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA', '#C084FC', '#F472B6', '#FB7185'];
const FALLBACK_ICONS = ['⭐', '🌟', '🍀', '🧩', '🎈', '🌈', '🎯', '📌', '🧸', '🎀', '🔔', '☂️'];
const stripVS = (s) => String(s || '').replace(/️/g, '');
const EMOJI_FILE = new Map();
const EMOJI_INDEX = [];
for (const g of EMOJI_GROUPS) {
  for (const [ch, file, kw] of g.items) {
    EMOJI_FILE.set(stripVS(ch), file);
    EMOJI_INDEX.push({ ch, file, group: g.name, color: g.color, words: kw.toLowerCase().split(/\s+/).filter(Boolean) });
  }
}

const isPicture = (v) => typeof v === 'string' && v.startsWith('data:image/');     // an image the user uploaded
function emojiImg(ch) {
  if (isPicture(ch)) return h('img', { class: 'emo pic', src: ch, alt: '', draggable: 'false' });
  const file = EMOJI_FILE.get(stripVS(ch));
  return file ? h('img', { class: 'emo', src: (window.PW_EMOJI && window.PW_EMOJI[file]) || `static/emoji/${file}.svg`, alt: ch, draggable: 'false' }) : h('span', { class: 'emo txt' }, ch);
}
function chipEl(icon, color, size) {
  return h('span', { class: 'cico' + (isPicture(icon) ? ' pic' : '') + (size ? ' ' + size : ''), style: isPicture(icon) ? '' : `background:${color || '#94A3B8'}33` }, emojiImg(icon));
}

const _autoCache = new Map();
const isCJK = (s) => /[㐀-鿿]/.test(s);
function hashOf(s) { let x = 7; for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0; return x; }
// Best picture for a name: the emoji whose search words match the name best; otherwise a stable pick from a few neutral ones.
function autoCategoryIcon(name) {
  const n = String(name || '').trim().toLowerCase();
  if (_autoCache.has(n)) return _autoCache.get(n);
  let best = null, top = 0;
  if (n && n !== '未分類') {
    for (const e of EMOJI_INDEX) {
      for (const w of e.words) {
        let s = 0;
        if (w === n) s = 100 + w.length;
        else if (n.includes(w) && (w.length >= 2 || isCJK(w))) s = 10 + w.length * 2;
        else if (w.includes(n) && n.length >= 2) s = 5 + n.length;
        if (s > top) { top = s; best = e; }
      }
    }
  }
  let r;
  if (best) r = { icon: best.ch, color: best.color };
  else if (!n || n === '未分類') r = { icon: '❓', color: '#94A3B8' };
  else { const hsh = hashOf(n); r = { icon: FALLBACK_ICONS[hsh % FALLBACK_ICONS.length], color: CHIP_COLORS[(hsh >> 3) % CHIP_COLORS.length] }; }
  _autoCache.set(n, r);
  return r;
}
function autoAccountIcon(a) {
  const n = String(a.name || '').toLowerCase();
  if (a.stock) return { icon: '📈', color: '#38BDF8' };
  if (/cash|現金|錢包|wallet|零用/.test(n)) return { icon: '💵', color: '#4ADE80' };
  if (/信用卡|credit|visa|master|jcb|card/.test(n)) return { icon: '💳', color: '#818CF8' };
  return { icon: '🏦', color: '#60A5FA' };
}
function catLook(name) {
  const o = (S.st.cat_icons || {})[name] || {}, a = autoCategoryIcon(name);
  return { icon: o.icon || a.icon, color: o.color || a.color, custom: !!(o.icon || o.color) };
}
function accLook(a) { const au = autoAccountIcon(a); return { icon: a.icon || au.icon, color: a.color || au.color, custom: !!(a.icon || a.color) }; }
const catChip = (name, size) => { const l = catLook(name); return chipEl(l.icon, l.color, size); };
const accChip = (a, size) => { const l = accLook(a); return chipEl(l.icon, l.color, size); };
function typeChip(type) {                       // transfers and zeroing adjustments have no category of their own
  return type === 'transfer' ? chipEl('🔁', '#94A3B8') : chipEl('⚖️', '#A8A29E');
}

const firstGlyph = (s) => {
  s = String(s || '').trim();
  if (!s) return '';
  if (window.Intl && Intl.Segmenter) { const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator](); return it.next().value.segment; }
  return Array.from(s)[0];
};

// A picture file -> a small PNG (data: URL) that fits in the database. Read with FileReader because the page may only load data: images.
function pictureToIcon(file) {
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)) return no(new Error('請選擇圖片檔（PNG、JPG、WebP 等）'));
    const fr = new FileReader();
    fr.onerror = () => no(new Error('讀不到這個檔案'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => no(new Error('這張圖片打不開，請換 PNG 或 JPG 試試'));
      img.onload = () => {
        const nw = img.naturalWidth || 128, nh = img.naturalHeight || 128;
        for (const size of [128, 96, 64]) {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const k = Math.min(size / nw, size / nh), w = nw * k, hh = nh * k;
          c.getContext('2d').drawImage(img, (size - w) / 2, (size - hh) / 2, w, hh);
          const data = c.toDataURL('image/png');
          if (data.length <= 45000) return ok(data);
        }
        no(new Error('這張圖片太複雜，請換一張簡單一點的'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// The picker. onSave(icon, color) is called with what the user chose; onReset() (optional) puts it back to automatic.
function openIconPicker({ title, name, icon, color, auto, sub, onSave, onReset }) {
  const sel = { icon, color };
  const preview = h('div', { class: 'ip-preview' });
  const grid = h('div', { class: 'emoji-grid', role: 'listbox', 'aria-label': '圖示' });
  const search = h('input', { type: 'search', class: 'ip-search', placeholder: '搜尋圖示，例如 咖啡、車、coffee', autocomplete: 'off', 'aria-label': '搜尋圖示', oninput: () => paintGrid() });
  const own = h('input', { class: 'ip-own', placeholder: '或貼上任何表情符號', autocomplete: 'off', 'aria-label': '自己輸入表情符號',
    oninput: (e) => { const g = firstGlyph(e.target.value); if (g) { sel.icon = g; paintPreview(); paintGrid(); } } });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': '上傳圖片',
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      usePicture(f);
    } });
  async function usePicture(f) {
    try {
      sel.icon = await pictureToIcon(f); own.value = ''; paintPreview(); paintGrid();
      const lib = S.st.icon_lib || (S.st.icon_lib = []);
      if (!lib.includes(sel.icon)) { lib.unshift(sel.icon); api('POST', '/api/icon-library', { icon: sel.icon }).catch(() => {}); }   // kept for next time
      paintLib();
    } catch (err) { toast(err.message || String(err), true); }
  }
  const libRow = h('div', { class: 'ip-lib field' });
  function paintLib() {
    const lib = S.st.icon_lib || [];
    libRow.hidden = !lib.length;
    libRow.replaceChildren(h('span', null, '曾經上傳（點一下使用）'), h('div', { class: 'lib-list' }, ...lib.map((d) =>
      h('span', { class: 'lib-item' + (d === sel.icon ? ' on' : '') },
        h('button', { type: 'button', class: 'lib-pick', title: '使用這張圖', 'aria-label': '使用這張上傳過的圖片', onclick: () => { sel.icon = d; own.value = ''; paintPreview(); paintGrid(); paintLib(); } },
          h('span', { class: 'cico pic sm' }, emojiImg(d))),
        h('button', { type: 'button', class: 'lib-del', title: '從清單移除', 'aria-label': '從清單移除這張圖片', onclick: async () => {
          try { await api('DELETE', '/api/icon-library', { icon: d }); S.st.icon_lib = (S.st.icon_lib || []).filter((x) => x !== d); paintLib(); } catch (err) { toast(err.message || String(err), true); }
        } }, '×')))));
  }
  const upload = h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, '上傳圖片…');
  const swatches = h('div', { class: 'ip-colors', role: 'radiogroup', 'aria-label': '顏色' });
  function paintPreview() {
    preview.replaceChildren(chipEl(sel.icon, sel.color, 'xl'), h('div', null, h('b', null, name || title), h('div', { class: 'muted' }, sub || '所有同類別的交易都會用這個圖示')));
  }
  function paintSwatches() {
    swatches.replaceChildren(...CHIP_COLORS.map((c) => h('button', { type: 'button', class: 'sw' + (c === sel.color ? ' on' : ''), style: `background:${c}`, role: 'radio', 'aria-checked': String(c === sel.color),
      'aria-label': c, onclick: () => { sel.color = c; paintPreview(); paintSwatches(); } })));
  }
  function paintGrid() {
    const q = search.value.trim().toLowerCase();
    const btn = (e) => h('button', { type: 'button', class: 'em' + (stripVS(e.ch) === stripVS(sel.icon) ? ' on' : ''), role: 'option', 'aria-selected': String(stripVS(e.ch) === stripVS(sel.icon)), title: e.words.slice(0, 3).join(' '),
      onclick: () => { sel.icon = e.ch; own.value = ''; paintPreview(); paintGrid(); } }, emojiImg(e.ch));
    if (q) {
      const hits = EMOJI_INDEX.filter((e) => e.words.some((w) => w.includes(q)) || e.ch === q);
      grid.replaceChildren(...(hits.length ? hits.map(btn) : [h('div', { class: 'empty ip-none' }, '找不到。可以在下面貼上任何表情符號。')]));
      return;
    }
    const kids = [];
    for (const g of EMOJI_GROUPS) {
      kids.push(h('div', { class: 'em-group' }, g.name));
      for (const e of EMOJI_INDEX.filter((x) => x.group === g.name)) kids.push(btn(e));
    }
    grid.replaceChildren(...kids);
  }
  paintPreview(); paintSwatches(); paintGrid();
  const body = h('div', { class: 'ip' }, preview,
    h('div', { class: 'ip-upload' }, upload, fileIn, h('span', { class: 'hint' }, '用自己的圖片（例如銀行 Logo）：可以選檔案、拖曳圖片到這裡，或在網頁上對圖片按右鍵「複製圖片」後在這個視窗按 Ctrl+V 貼上。會縮成小圖存在帳本裡，不需要網路。')),
    libRow, search, grid, h('label', { class: 'field' }, h('span', null, '自己輸入'), own),
    h('div', { class: 'field' }, h('span', null, '顏色（用於內建圖示的底色）'), swatches),
    h('p', { class: 'hint', style: 'margin:0' }, '內建圖片：Twemoji（CC BY 4.0）。'));
  paintLib();
  body.addEventListener('paste', (e) => {                 // an image copied from a web page or a screenshot
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((x) => /^image\//.test(x.type));
    if (f) { e.preventDefault(); usePicture(f); }
  });
  body.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  body.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { e.preventDefault(); usePicture(f); }
  });
  openDialog({
    title, body, wide: true,
    extraFoot: onReset ? h('button', { class: 'btn ghost', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { await onReset(); e.target.closest('dialog').close(); } catch (err) { e.target.disabled = false; toast(err.message || String(err), true); }
    } }, '還原成自動') : null,
    primary: { label: '儲存', run: async () => { await onSave(sel.icon, sel.color); } },
  });
}

function editCategoryIcon(name) {
  const l = catLook(name), au = autoCategoryIcon(name);
  openIconPicker({
    title: `圖示：${name || '未分類'}`, name: name || '未分類', icon: l.icon, color: l.color, auto: au,
    onSave: async (icon, color) => { await api('PUT', '/api/category-icons', { category: name, icon, color }); const u = S.st.cat_info.usage[name], n = u ? u.income + u.expense : 0; await afterChange(n ? `圖示已更新，${n} 筆相關交易也一起換上新圖示` : '圖示已更新'); },
    onReset: l.custom ? async () => { await api('PUT', '/api/category-icons', { category: name, icon: '', color: '' }); await afterChange('已還原成自動圖示'); } : null,
  });
}
