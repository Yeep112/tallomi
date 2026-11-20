/* Category rules (分類規則): "a note that contains <word> gets <category / tags / account>".
   The server does the filling (app/catrules.py); this file is the editor and the "apply to old entries" step.
   Only functions and constants here: nothing touches `S` until a page is drawn. */
'use strict';

const RULE_KINDS = [['any', '收入與支出'], ['expense', '只有支出'], ['income', '只有收入']];

function blankRule() { return { text: '', kind: 'any', category: '', tags: '', account_id: '', on: true }; }

// Edit the whole ordered list in one dialog and save it at once; the first rule from the top that fits wins.
async function openCatRulesEditor() {
  let items = [];
  try { items = (await api('GET', '/api/cat-rules')).items.map((r) => ({ ...r, tags: Array.isArray(r.tags) ? r.tags.join(' ') : (r.tags || ''), account_id: r.account_id || '' })); }
  catch (e) { fail(e); return null; }
  const accs = activeAccounts();
  const cats = [...new Set([...(S.st.cat_info.expense || []), ...(S.st.cat_info.income || [])])];
  const box = h('div', { class: 'rule-list' });
  const hint = h('p', { class: 'hint', style: 'margin:0 0 8px' }, '記帳時備註有包含關鍵字，就自動帶入類別、標籤或帳戶。由上往下，第一條符合的規則生效；你自己已經選好的欄位不會被改掉。一條規則可以放多個關鍵字，用頓號或逗號分開。');
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; draw(); };
  const draw = () => {
    if (!items.length) { box.replaceChildren(h('p', { class: 'hint', style: 'margin:12px 0' }, '還沒有規則。按左下角的「＋ 新增規則」，例如：備註有「星巴克、路易莎」→ 類別「咖啡」。')); return; }
    box.replaceChildren(...items.map((r, i) => h('div', { class: 'rule-row' + (r.on === false ? ' off' : '') },
      h('div', { class: 'rule-top' },
        h('label', { class: 'rule-on' }, h('input', { type: 'checkbox', checked: r.on !== false, 'aria-label': '啟用這條規則', onchange: (e) => { r.on = e.target.checked; e.target.closest('.rule-row').classList.toggle('off', !r.on); } }), h('span', null, `第 ${i + 1} 條`)),
        h('span', { class: 'tpl-btns' },
          h('button', { class: 'btn sm ghost', type: 'button', disabled: i === 0, 'aria-label': '往上移', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn sm ghost', type: 'button', disabled: i === items.length - 1, 'aria-label': '往下移', onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'btn sm ghost danger', type: 'button', 'aria-label': '刪除這條規則', onclick: () => { items.splice(i, 1); draw(); } }, '刪除'))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, '備註包含'), h('input', { value: r.text, autocomplete: 'off', maxlength: 200, placeholder: '星巴克、路易莎', oninput: (e) => { r.text = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '適用於'), h('select', { onchange: (e) => { r.kind = e.target.value; } }, RULE_KINDS.map(([v, t]) => h('option', { value: v, selected: v === r.kind }, t)))),
        h('label', { class: 'field' }, h('span', null, '類別'), h('input', { value: r.category, autocomplete: 'off', list: 'rule-cats', maxlength: 60, placeholder: '不改就留空', oninput: (e) => { r.category = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '標籤'), h('input', { value: r.tags, autocomplete: 'off', autocapitalize: 'off', maxlength: 160, placeholder: '例如 日常', oninput: (e) => { r.tags = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '帳戶（沒選帳戶時才用）'),
          h('select', { onchange: (e) => { r.account_id = e.target.value; } }, [h('option', { value: '' }, '不指定'), ...accs.map((a) => h('option', { value: a.id, selected: String(a.id) === String(r.account_id) }, a.name))]))))));
  };
  draw();
  const keepList = () => items.map((r) => ({ ...r, tags: r.tags, account_id: r.account_id === '' ? null : Number(r.account_id) }));
  const applyBtn = h('button', { class: 'btn', type: 'button', style: 'margin-right:auto', onclick: async () => {
    applyBtn.disabled = true;
    try {
      await api('PUT', '/api/cat-rules', { items: keepList() });
      const pv = await api('POST', '/api/cat-rules/preview');
      if (!pv.count) { toast('目前沒有「未分類」的舊紀錄符合這些規則'); return; }
      const lines = (pv.sample || []).slice(0, 6).map((s) => h('li', null, `${s.note} → ${s.to}`));
      const ok = await confirmBox({ title: `把規則套用到 ${pv.count} 筆舊紀錄？`, confirmLabel: '套用',
        message: h('div', null, h('p', null, '只會處理還在「未分類」的紀錄，補上類別和標籤（已經有類別的不動），完成後一分鐘內可以按「復原」退回。'), lines.length ? h('ul', { class: 'rule-sample' }, lines) : null) });
      if (!ok) return;
      const r = await api('POST', '/api/cat-rules/apply');
      await afterChange(`已整理 ${r.changed} 筆舊紀錄`, undoAction(r.undo));
    } catch (e) { fail(e); } finally { applyBtn.disabled = false; }
  } }, '套用到過去紀錄');
  const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => { items.push(blankRule()); draw(); const ins = box.querySelectorAll('.rule-row'); const last = ins[ins.length - 1]; if (last) { last.scrollIntoView({ block: 'nearest' }); const f = last.querySelector('input[type=text], input:not([type])'); if (f && !onTouch()) f.focus(); } } }, '＋ 新增規則');
  return openDialog({ title: '分類規則', wide: true, extraFoot: h('span', { class: 'rule-foot' }, addBtn, applyBtn),
    body: h('div', null, hint, h('datalist', { id: 'rule-cats' }, cats.map((c) => h('option', { value: c }))), box),
    primary: { label: '儲存', run: async () => {
      const res = await api('PUT', '/api/cat-rules', { items: keepList() });
      await afterChange(res.items.length ? `已儲存 ${res.items.length} 條分類規則` : '已清空分類規則');
    } } });
}

function catRulesSection() {
  const n = ((S.st && S.st.cat_rules) || []).length;
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, '分類規則')),
    h('div', { class: 'rows' },
      h('p', { class: 'hint', style: 'margin:0' }, '備註有某些字（例如「星巴克」），就自動帶入類別、標籤或帳戶。只補空白欄位，不會蓋掉你自己選的。可以一次整理過去還沒分類的紀錄，並且能復原。'),
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => openCatRulesEditor() }, n ? `管理分類規則（${n} 條）` : '新增分類規則'))));
}
