// 電卓テンキー。eval は使わず自前で四則演算（乗除優先）。
import { h } from './ui.js';

const OPS = ['+', '-', '×', '÷'];
const MAX_DIGITS = 10;

/** 式を計算。不完全な式は末尾の演算子を無視。計算不能は null、結果は整数に丸める */
export function evaluate(expr) {
  const tokens = expr.match(/\d+|[+\-×÷]/g) || [];
  while (tokens.length && OPS.includes(tokens[tokens.length - 1])) tokens.pop();
  if (!tokens.length) return 0;
  if (OPS.includes(tokens[0])) return null;
  // 乗除
  const stack = [Number(tokens[0])];
  const ops = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number(tokens[i + 1]);
    if (op === '×') stack[stack.length - 1] *= n;
    else if (op === '÷') {
      if (n === 0) return null;
      stack[stack.length - 1] /= n;
    } else { ops.push(op); stack.push(n); }
  }
  let total = stack[0];
  ops.forEach((op, i) => { total = op === '+' ? total + stack[i + 1] : total - stack[i + 1]; });
  return Math.round(total);
}

/** 1キー分の入力を式へ適用して新しい式を返す（純粋関数・テスト可能） */
export function press(expr, key) {
  const last = expr.slice(-1);
  if (key === 'C') return '';
  if (key === '⌫') return expr.slice(0, -1);
  if (key === '=') {
    const v = evaluate(expr);
    return v === null ? expr : (v > 0 ? String(v) : '');
  }
  if (OPS.includes(key)) {
    if (!expr) return '';                          // 先頭の演算子は無視
    if (OPS.includes(last)) return expr.slice(0, -1) + key; // 連続は置換
    return expr + key;
  }
  // 数字・00
  const curNum = (expr.match(/\d*$/) || [''])[0];
  if (key === '00') {
    if (!curNum || curNum === '0') return expr;    // 空・0 の後ろに 00 は付けない
    key = curNum.length + 2 > MAX_DIGITS ? '' : '00';
  } else if (curNum === '0') {
    return expr.slice(0, -1) + key;                // 先頭ゼロを置換
  }
  if (curNum.length + key.length > MAX_DIGITS) return expr;
  return expr + key;
}

/** キーパッド部品。onChange(expr) を状態変更のたびに呼ぶ */
export function createKeypad(initial, onChange) {
  let expr = initial || '';
  const keys = [
    '7', '8', '9', '÷',
    '4', '5', '6', '×',
    '1', '2', '3', '-',
    '0', '00', '⌫', '+'
  ];
  const el = h('div', { class: 'keypad', role: 'group', 'aria-label': '電卓' },
    keys.map((k) => h('button', {
      type: 'button', class: 'key' + (OPS.includes(k) ? ' op' : '') + (k === '⌫' ? ' fn' : ''),
      'aria-label': { '÷': '割る', '×': 'かける', '-': '引く', '+': '足す', '⌫': '一つ消す' }[k] || k,
      onclick: () => { expr = press(expr, k); onChange(expr); }
    }, k)),
    h('button', { type: 'button', class: 'key fn', onclick: () => { expr = press(expr, 'C'); onChange(expr); } }, 'C'),
    h('button', { type: 'button', class: 'key eq', onclick: () => { expr = press(expr, '='); onChange(expr); } }, '＝')
  );
  return { el, get: () => expr, set: (v) => { expr = v; onChange(expr); } };
}
