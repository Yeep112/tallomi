/* Categories page: see every category with how often it is used, add one before any entry uses it,
   rename (a name that already exists merges the two), delete, and change its picture.
   Tabs: 全部 (the unified list) / 支出 / 收入. Entries are never lost: deleting a used category moves them to 未分類. */
'use strict';

const CAT_KIND_LABEL = { expense: '支出', income: '收入', both: '收入與支出' };

function catUsageText(u, tab) {
  const e = u ? u.expense : 0, i = u ? u.income : 0;
  if (tab === 'expense') return e ? `${e} 筆支出` : '尚未使用';
  if (tab === 'income') return i ? `${i} 筆收入` : '尚未使用';
  const parts = [];
  if (e) parts.push(`${e} 筆支出`);
  if (i) parts.push(`${i} 筆收入`);
  return parts.length ? parts.join('、') : '尚未使用';
}

function openCategoryRename(name) {
  const info = S.st.cat_info, u = info.usage[name], unused = !u;
  const input = h('input', { value: name, maxlength: 60, autocomplete: 'off', 'aria-label': '新名稱', list: 'cat-names' });
  const names = h('datalist', { id: 'cat-names' }, info.all.filter((c) => c !== name).map((c) => h('option', { value: c })));
  const kindSel = unused ? h('select', { 'aria-label': '類型' }, ['expense', 'income', 'both'].map((k) => h('option', { value: k, selected: k === (info.defined[name] || 'both') }, CAT_KIND_LABEL[k]))) : null;
  const note = h('p', { class: 'hint', style: 'margin:0' });
  const paint = () => {
    const v = input.value.trim();
    note.textContent = v && v !== name && info.all.includes(v)
      ? `「${v}」已經存在：儲存後會把「${name}」的紀錄全部併進「${v}」，金額不變。` : '改名後，這個類別的所有紀錄都會一起換成新名稱，金額不變。想合併到別的類別，直接輸入那個類別的名稱。';
  };
  input.addEventListener('input', paint); paint();
  openDialog({
    title: `改名或合併：${name}`,
    body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('label', { class: 'field' }, h('span', null, '新名稱'), input, names),
      kindSel ? h('label', { class: 'field' }, h('span', null, '用在'), kindSel) : null, note),
    primary: { label: '儲存', run: async () => {
      const r = await api('PUT', '/api/categories', { name, new_name: input.value, kind: kindSel ? kindSel.value : undefined });
      const nm = input.value.trim().replace(/\s+/g, ' ');
      if (nm && nm !== name) {                                                // what is typed in the form follows the new name too
        if (S.entry.category === name) S.entry.category = nm;
        for (const k of ['expense', 'income']) { const o = (S.st.prefs.tile_order || {})[k]; if (o) S.st.prefs.tile_order[k] = o.map((x) => (x === name ? nm : x)); }
      }
      const n = r.moved || 0;
      await afterChange(`${r.merged ? '已合併' : '已改名'}${n ? `，${n} 筆交易、範本、預算和圖示都已同步更新` : '，範本、預算和圖示已同步更新'}`);
    } },
  });
}

function openBudget(name) {
  const cur = S.st.budgets[name];
  const input = h('input', { name: 'budget', inputmode: 'decimal', autocomplete: 'off', value: cur ? String(cur) : '', placeholder: '例如 2700、2.7k 或 2k7', 'aria-label': '每月預算' });
  openDialog({
    title: `每月預算：${name}`,
    body: h('div', { class: 'rows', style: 'padding:0;max-width:none' },
      h('label', { class: 'field' }, h('span', null, `每月上限（${S.st.base}）`), input),
      h('p', { class: 'hint', style: 'margin:0' }, '只計算這個類別當月的「支出」（轉帳不算）。總覽的類別磚塊上會直接顯示預算和剩餘，進度條用到 80% 轉黃色、超過上限轉紅色。可以用簡寫：2k7 = 2,700、1.5萬 = 15,000。留空代表不設預算。')),
    primary: { label: '儲存', run: async () => { await api('PUT', '/api/budgets', { category: name, amount: input.value }); await afterChange(input.value.trim() ? '已設定預算' : '已移除預算'); } },
  });
}

async function deleteCategory(name) {
  const u = S.st.cat_info.usage[name], n = u ? u.income + u.expense : 0;
  const ok = await confirmBox({ title: `刪除類別「${name}」？`, confirmLabel: '刪除', danger: true,
    message: h('p', null, n ? `有 ${n} 筆紀錄用到這個類別，刪除後它們會改成「未分類」，金額不變。` : '這個類別還沒有任何紀錄用到。') });
  if (!ok) return;
  try { await api('DELETE', '/api/categories', { name }); if (S.entry.category === name) S.entry.category = ''; await afterChange(n ? `已刪除，${n} 筆交易改成未分類` : '已刪除'); } catch (e) { fail(e); }
}

async function viewCategories(view) {
  const info = S.st.cat_info;
  const tab = S.catTab || (S.catTab = 'all');
  const list = tab === 'all' ? info.all : info[tab];
  const nameIn = h('input', { name: 'newcat', maxlength: 60, autocomplete: 'off', placeholder: '例如：早餐、獎金', 'aria-label': '新類別名稱' });
  const kindIn = h('select', { 'aria-label': '用在' }, [['expense', '支出'], ['income', '收入'], ['both', '收入與支出']].map(([v, l]) => h('option', { value: v, selected: v === (tab === 'all' ? 'expense' : tab) }, l)));
  const add = h('form', { class: 'cm-add', 'aria-label': '新增類別' },
    h('label', { class: 'field grow' }, h('span', null, '新增類別'), nameIn),
    h('label', { class: 'field' }, h('span', null, '用在'), kindIn),
    h('button', { class: 'btn primary', type: 'submit' }, '新增'));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/categories', { name: nameIn.value, kind: kindIn.value }); nameIn.value = ''; await afterChange('已新增類別'); } catch (err) { fail(err); }
  });
  const count = (k) => (k === 'all' ? info.all : info[k]).length;
  const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': '類別清單' },
    [['all', '全部'], ['expense', '支出'], ['income', '收入']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { S.catTab = k; renderRoute(); } }, `${l}（${count(k)}）`)));
  const row = (c) => {
    const u = info.usage[c], def = info.defined[c];
    return h('li', { class: 'cm-row' },
      h('button', { class: 'chip-btn', type: 'button', title: `更換「${c}」的圖示`, 'aria-label': `更換「${c}」的圖示`, onclick: () => editCategoryIcon(c) }, catChip(c, 'lg')),
      h('div', { class: 'cm-main' }, h('b', null, c),
        h('span', { class: 'hint' }, catUsageText(u, tab), !u && def ? `（${CAT_KIND_LABEL[def]}）` : '', S.st.budgets[c] ? `　預算 ${num(S.st.budgets[c], S.st.base)} ／月` : '')),
      h('div', { class: 'cm-acts' },
        tab !== 'income' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openBudget(c) }, S.st.budgets[c] ? '預算' : '設預算') : null,
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openCategoryRename(c) }, '改名／合併'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => deleteCategory(c) }, '刪除')));
  };
  const intro = pageIntro('記帳時的類別選單會依「支出」或「收入」只列出對應的類別，選單底下也能切到「全部」。在這裡可以先建好類別、改名、合併或刪除；刪除不會讓紀錄消失，只是改成「未分類」。');
  view.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '類別', intro.btn), intro.p)),
    h('section', { class: 'section' }, add),
    h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, tab === 'all' ? '全部類別' : `${CAT_KIND_LABEL[tab]}類別`), tabs),
      list.length ? h('ul', { class: 'cm-rows' }, list.map(row)) : h('div', { class: 'empty' }, h('b', null, '還沒有類別'), '在上面輸入名稱新增，或直接記一筆收支，類別就會出現在這裡。')));
}
