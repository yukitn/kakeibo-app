// 共有メモボード: 付箋風カード・ピン留め・完了チェック（検討中の買い物 / 臨時支出の予定 / 今月の振り返り など）
import { call } from './api.js';
import { h, chip, field, errText, openSheet, toast, fill } from './ui.js';
import * as S from './state.js';

export const KINDS = {
  purchase: { label: '検討中の買い物', icon: '🛒' },
  plan: { label: '臨時支出の予定', icon: '📅' },
  review: { label: '今月の振り返り', icon: '📝' },
  other: { label: 'その他', icon: '📌' }
};
const COLORS = { yellow: '付箋イエロー', green: 'セージ', blue: 'ブルー', pink: 'ピンク', gray: 'グレー' };
const st = { kind: '', showDone: true };

/** 並び順: ピン留め → 未完了 → 完了、同じ中では新しい順（純粋関数） */
export function sortMemos(items) {
  const rank = (m) => (isOn(m.pinned) ? 0 : 1) * 2 + (isOn(m.done) ? 1 : 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}
const isOn = (v) => v === true || v === 'TRUE' || v === 'true';

export async function paintMemo(body) {
  await S.ensureBoot().catch(() => {});
  const reload = () => paintMemo(body);
  const grid = h('div', { class: 'memo-grid' }, h('p', { class: 'muted' }, '読み込み中…'));
  fill(body,
    h('div', { class: 'row tight' }, h('h2', {}, 'メモ'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => openMemoEditor(null, reload) }, '＋ メモを書く')),
    h('div', { class: 'chips' },
      chip('すべて', { selected: !st.kind, onclick: () => { st.kind = ''; reload(); } }),
      Object.entries(KINDS).map(([k, v]) => chip(v.label, { icon: v.icon, selected: st.kind === k, onclick: () => { st.kind = k; reload(); } })),
      h('label', { class: 'check memo-done-toggle' }, h('input', { type: 'checkbox', checked: st.showDone, onchange: (e) => { st.showDone = e.target.checked; reload(); } }), '完了も表示')),
    grid);

  try {
    const { items } = await call('memo.list', {}, { user_id: S.currentUserId() });
    let list = sortMemos(items).filter((m) => (!st.kind || m.kind === st.kind) && (st.showDone || !isOn(m.done)));
    if (!list.length) {
      fill(grid, h('div', { class: 'card' }, h('p', {}, items.length ? '条件に合うメモはありません。' : 'まだメモがありません。'),
        !items.length && h('p', { class: 'muted' }, '「検討中の大きな買い物」「臨時支出の予定」「今月の振り返り」などを、付箋のように残せます。夫婦・家族で共有できます。')));
      return;
    }
    const users = S.getBoot()?.users || [];
    fill(grid, list.map((m) => memoCard(m, users, reload)));
  } catch (e) {
    fill(grid, h('p', { class: 'msg' }, errText(e)));
  }
}

function memoCard(m, users, reload) {
  const done = isOn(m.done), pinned = isOn(m.pinned);
  const author = users.length > 1 ? users.find((u) => u.id === m.user_id)?.name : '';
  const toggle = async (patch, okMsg) => {
    try {
      await call('memo.upsert', { id: m.id, title: m.title, body: m.body, kind: m.kind, color: m.color, pinned, done, ...patch }, { user_id: S.currentUserId() });
      if (okMsg) toast(okMsg);
      reload();
    } catch (e) { toast(errText(e)); }
  };
  return h('article', { class: `memo ${m.color || 'yellow'}${done ? ' is-done' : ''}` },
    h('div', { class: 'memo-top' },
      h('span', { class: 'badge' }, `${(KINDS[m.kind] || KINDS.other).icon} ${(KINDS[m.kind] || KINDS.other).label}`),
      h('button', { type: 'button', class: 'icon-btn' + (pinned ? ' on' : ''), 'aria-pressed': String(pinned), 'aria-label': pinned ? 'ピン留めを外す' : 'ピン留めする',
        onclick: () => toggle({ pinned: !pinned }) }, '📌')),
    h('button', { type: 'button', class: 'memo-body', onclick: () => openMemoEditor(m, reload) },
      m.title && h('strong', { class: 'memo-title' }, m.title),
      m.body && h('span', { class: 'memo-text' }, m.body)),
    h('div', { class: 'memo-foot' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: done, onchange: (e) => toggle({ done: e.target.checked }, e.target.checked ? '完了にしました' : '') }), '完了'),
      author && h('span', { class: 'muted small-text' }, author)));
}

function openMemoEditor(m, reload) {
  let kind = m?.kind || 'other', color = m?.color || 'yellow', pinned = m ? isOn(m.pinned) : false;
  const title = h('input', { type: 'text', maxlength: 60, value: m?.title || '', placeholder: '例: 冷蔵庫の買い替え' });
  const text = h('textarea', { rows: 6, maxlength: 2000, placeholder: '内容（例: 予算10万円、来月までに決める）' }, m?.body || '');
  const kindBox = h('div', { class: 'chips' }), colorBox = h('div', { class: 'chips' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const pinIn = h('input', { type: 'checkbox', checked: pinned, onchange: (e) => { pinned = e.target.checked; } });
  const paint = () => {
    fill(kindBox, Object.entries(KINDS).map(([k, v]) => chip(v.label, { icon: v.icon, selected: kind === k, onclick: () => { kind = k; paint(); } })));
    fill(colorBox, Object.entries(COLORS).map(([k, l]) => h('button', { type: 'button', class: `swatch ${k}${color === k ? ' selected' : ''}`, 'aria-pressed': String(color === k), 'aria-label': l,
      onclick: () => { color = k; paint(); } })));
  };
  const saveBtn = h('button', { type: 'button', class: 'btn primary save', onclick: async () => {
    msg.textContent = '';
    if (!title.value.trim() && !text.value.trim()) { msg.textContent = 'タイトルか内容を入力してください'; return; }
    saveBtn.disabled = true;
    try {
      await call('memo.upsert', { id: m?.id, title: title.value, body: text.value, kind, color, pinned, done: m ? isOn(m.done) : false }, { user_id: S.currentUserId() });
      toast(m ? 'メモを更新しました' : 'メモを追加しました'); close(); reload();
    } catch (e) { msg.textContent = errText(e); saveBtn.disabled = false; }
  } }, m ? '更新する' : '追加する');
  const del = m && h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
    if (!confirm('このメモを削除しますか？')) return;
    try { await call('memo.delete', { id: m.id }, { user_id: S.currentUserId() }); toast('削除しました'); close(); reload(); }
    catch (e) { msg.textContent = errText(e); }
  } }, '削除');

  const close = openSheet(h('div', {},
    h('div', { class: 'sheet-head' }, h('h2', {}, m ? 'メモを編集' : 'メモを書く'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('h3', { class: 'sub-h' }, '種類'), kindBox, field('タイトル', title), field('内容', text),
    h('h3', { class: 'sub-h' }, '付箋の色'), colorBox,
    h('label', { class: 'check' }, pinIn, '上にピン留めする'), msg,
    h('div', { class: 'row' }, del || h('span'), saveBtn)), { label: 'メモの編集' });
  paint();
}
