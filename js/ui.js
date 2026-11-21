// 共通UI部品。innerHTML は使わず DOM API のみ（XSS対策）。
import { ApiError } from './api.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const errText = (e) => (e instanceof ApiError ? e.message : '予期しないエラーが発生しました');

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export const yen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function dateLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}月${d}日（${WD[new Date(y, m - 1, d).getDay()]}）`;
}

/** 選択チップ。selected は真偽、onclick で切替 */
export function chip(label, { selected = false, onclick, icon, kind } = {}) {
  return h('button', {
    type: 'button', class: 'chip' + (selected ? ' selected' : '') + (kind ? ' ' + kind : ''),
    'aria-pressed': selected ? 'true' : 'false', onclick
  }, icon && h('span', { 'aria-hidden': 'true' }, icon), label);
}

let toastTimer = null;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', class: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** 画面いっぱいのシート（スマホ=下から、iPad=中央）。close 関数を返す */
export function openSheet(content, { onClose, label = '' } = {}) {
  const overlay = h('div', { class: 'overlay' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, content);
  overlay.append(sheet);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('no-scroll');
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  document.body.classList.add('no-scroll');
  return close;
}

export function closeAllSheets() {
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  document.body.classList.remove('no-scroll');
}

/**
 * 要素の中身を差し替える（native の replaceChildren は null/false を "null"/"false" という文字で表示してしまうため、
 * 空の値（null/undefined/false/空文字）を除外し、配列も展開する）。条件式 `cond && h(...)` を安全に渡せる。
 */
export function fill(el, ...children) {
  const nodes = children.flat(Infinity)
    .filter((c) => c != null && c !== false && c !== '')
    .map((c) => (c.nodeType ? c : document.createTextNode(String(c))));
  el.replaceChildren(...nodes);
  return el;
}
