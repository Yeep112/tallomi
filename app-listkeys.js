'use strict';
/* The transactions list with the keyboard (1.64.0): ↑ ↓ (or K J) move from line to line, Enter or E edits, X ticks the line (Shift + ↑ ↓ ticks as you go),
   D records it again, Delete removes it (with 復原), Home / End / PageUp / PageDown jump, Esc leaves the list.
   Works on the 交易 page, whatever the cursor is on inside a line. Only functions and constants here, plus the key listener added once at the bottom. */
const LIST_KEYS = [
  ['↑ ↓  或  K J', '交易頁：移到上一筆 / 下一筆（還沒選時，J 或 K 先選到第一筆）'], ['Enter  或  E', '交易頁：編輯這一筆'], ['X', '交易頁：勾選 / 取消勾選這一筆（Shift + ↑ ↓ 連續勾選）'],
  ['D', '交易頁：再記一筆（用這一筆的內容）'], ['Delete', '交易頁：刪除這一筆（可以按「復原」）'], ['Home  End', '交易頁：第一筆 / 最後一筆（PageUp PageDown 一次跳 10 筆）'], ['Esc', '交易頁：離開清單'],
];
KEY_LIST.splice(KEY_LIST.length - 1, 0, ...LIST_KEYS);

const listRows = () => [...document.querySelectorAll('#view tr.tx-row')].filter((r) => !r.hidden && r._tx);
const listRowOf = (el) => (el && el.closest ? el.closest('tr.tx-row') : null);
function listFocus(row) {
  if (!row) return false;
  row.focus();
  row.scrollIntoView({ block: 'nearest' });
  return true;
}
// Move by `step` lines from `row` (rows far outside the screen are only drawn once the list scrolls there: ask the list to scroll, then try again).
function listMove(row, step, extend) {
  let rows = listRows(); let i = rows.indexOf(row);
  if (i < 0) { listFocus(rows[0]); return; }
  const to = Math.max(0, Math.min(rows.length - 1, i + step));
  if (extend) listTick(row, true);
  if (to === i && step > 0) { window.scrollBy(0, 400); requestAnimationFrame(() => { const more = listRows(); const j = more.indexOf(row); if (j >= 0 && j < more.length - 1) { if (extend) listTick(more[j + 1], true); listFocus(more[j + 1]); } }); return; }
  const target = rows[to];
  if (extend && target !== row) listTick(target, true);
  listFocus(target);
}
function listTick(row, on) {
  const box = row.querySelector('.c-sel input[type=checkbox]');
  if (!box) return;
  const want = on === undefined ? !box.checked : on;
  if (box.checked !== want) { box.checked = want; box.dispatchEvent(new Event('change', { bubbles: true })); }
}
async function listDelete(row) {
  const rows = listRows(), i = rows.indexOf(row);
  await swipeDelete(row._tx);
  const after = listRows();                                                          // the list was drawn again: carry on from the same place
  if (after.length) listFocus(after[Math.min(i, after.length - 1)]);
}

document.addEventListener('keydown', (e) => {
  if (!S || !S.st || S.route !== 'transactions' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (document.querySelector('dialog[open], .lockscreen')) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(t.type)))) return;   // typing is typing
  const row = listRowOf(t), k = e.key;
  const onBody = !row && (t === document.body || !t || t === document.documentElement);
  if (!row && !onBody) return;                                                       // a button or link elsewhere: its own keys
  if (row && t !== row && t.tagName !== 'INPUT') { if (!/^(ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Escape)$/.test(k) && !/^[jkxdeJKXDE]$/.test(k) && k !== 'Delete') return; }
  const go = (fn) => { e.preventDefault(); fn(); };
  if (!row) {                                                                        // nothing picked yet: J / K start at the top / bottom of what is drawn
    if (k === 'j' || k === 'J') go(() => listFocus(listRows()[0]));
    else if (k === 'k' || k === 'K') go(() => { const r = listRows(); listFocus(r[r.length - 1]); });
    return;
  }
  const down = k === 'ArrowDown' || k === 'j' || k === 'J', up = k === 'ArrowUp' || k === 'k' || k === 'K';
  if (down || up) go(() => listMove(row, down ? 1 : -1, e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')));
  else if (k === 'PageDown') go(() => listMove(row, 10));
  else if (k === 'PageUp') go(() => listMove(row, -10));
  else if (k === 'Home') go(() => listFocus(listRows()[0]));
  else if (k === 'End') go(() => { const r = listRows(); listFocus(r[r.length - 1]); });
  else if (k === 'x' || k === 'X') go(() => listTick(row));
  else if (k === 'e' || k === 'E') go(() => openTxDialog(row._tx));
  else if ((k === 'd' || k === 'D') && !row._tx.settle_of) go(() => openQuickAdd({ seed: entryFromTx(row._tx), title: '再記一筆' }));
  else if (k === 'Delete') go(() => { listDelete(row).catch(fail); });
  else if (k === 'Escape') go(() => row.blur());
});
