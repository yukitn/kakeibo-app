// 目標画面: 目的別の貯金・ライフプラン目標（達成率リング・積立/取り崩し/現在額の修正）
import { call } from './api.js';
import { today } from './period.js';
import { h, chip, field, errText, openSheet, toast, yen, fill } from './ui.js';
import { createKeypad, evaluate } from './keypad.js';
import { ring } from './charts.js';
import { goalPct, monthsLeft, monthlyNeeded } from './asset-calc.js';
import * as S from './state.js';

const PRESETS = [
  ['学費', '🎓'], ['旅行', '✈️'], ['家電買い替え', '📺'], ['車', '🚗'], ['引っ越し', '🏠'],
  ['結婚・お祝い', '💍'], ['老後', '🌿'], ['緊急資金', '🛟'], ['その他', '⭐']
];
const fmtDate = (d) => d.replace(/-/g, '/');

function deadlineText(g) {
  if (!g.deadline) return '期限なし';
  const left = monthsLeft(g.deadline, today());
  const base = `期限 ${fmtDate(g.deadline)}`;
  if (Number(g.current_amount) >= Number(g.target_amount)) return base;
  if (left === 0) return `${base}（期限を過ぎています）`;
  return `${base}（あと約${left}か月）`;
}

export async function paintGoals(body) {
  await S.ensureBoot().catch(() => {});
  const reload = () => paintGoals(body);
  const content = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));
  fill(body, h('div', { class: 'row tight' }, h('h2', {}, '目標'),
    h('button', { type: 'button', class: 'btn small primary', onclick: () => openGoalEditor(null, reload) }, '＋ 目標を追加')), content);

  try {
    const { goals, logs } = await call('goal.list', {}, { user_id: S.currentUserId() });
    const sorted = [...goals].sort((a, b) => {
      const da = Number(a.current_amount) >= Number(a.target_amount), db = Number(b.current_amount) >= Number(b.target_amount);
      if (da !== db) return da ? 1 : -1;                                   // 未達成を先に
      return (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1;      // 期限が近い順
    });
    if (!sorted.length) {
      fill(content, h('div', { class: 'card' }, h('p', {}, '目的別の目標を作ってみましょう。'), h('p', { class: 'muted' }, '学費・旅行・家電の買い替えなど。目標額と期限を決めて、積み立てるたびに達成率が上がります。'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => openGoalEditor(null, reload) }, '＋ 最初の目標を作る')));
      return;
    }
    fill(content, h('div', { class: 'goal-grid' }, sorted.map((g) => goalCard(g, logs, reload))));
  } catch (e) {
    fill(content, h('p', { class: 'msg' }, errText(e)));
  }
}

function goalCard(g, logs, reload) {
  const cur = Number(g.current_amount), target = Number(g.target_amount);
  const pct = goalPct(cur, target);
  const done = cur >= target;
  const need = monthlyNeeded(cur, target, g.deadline, today());
  return h('button', { type: 'button', class: 'card goal' + (done ? ' done' : ''), onclick: () => openGoalDetail(g, logs, reload) },
    ring(pct, { done, label: `${g.name}の達成率` }),
    h('div', { class: 'goal-main' },
      h('div', { class: 'goal-name' }, `${g.icon || '⭐'} ${g.name}`, done && h('span', { class: 'badge ok-badge' }, '達成🎉')),
      h('div', { class: 'goal-amt' }, `${yen(cur)} / ${yen(target)}`),
      h('div', { class: 'muted small-text' }, deadlineText(g)),
      need !== null && h('div', { class: 'small-text goal-need' }, `毎月 ${yen(need)} で達成`),
      !done && h('div', { class: 'muted small-text' }, `あと ${yen(target - cur)}`)));
}

/** 目標の作成/編集 */
function openGoalEditor(goal, reload) {
  let icon = goal?.icon || '', expr = goal ? String(goal.target_amount) : '', deadline = goal?.deadline || '';
  const name = h('input', { type: 'text', maxlength: 40, value: goal?.name || '', placeholder: '例: 子どもの学費' });
  const presetBox = h('div', { class: 'chips' });
  const amountEl = h('div', { class: 'amount' });
  const exprEl = h('div', { class: 'expr muted' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const dateIn = h('input', { type: 'date', value: deadline, class: 'date-input', 'aria-label': '期限', min: today(), onchange: (e) => { deadline = e.target.value; } });
  const paint = () => {
    const v = evaluate(expr);
    amountEl.textContent = v === null ? 'エラー' : yen(v);
    exprEl.textContent = /[+\-×÷]/.test(expr) ? expr : '';
  };
  const kp = createKeypad(expr, (e) => { expr = e; paint(); });
  const paintPresets = () => fill(presetBox, PRESETS.map(([n, ic]) => chip(n, {
    icon: ic, selected: icon === ic && name.value === n,
    onclick: () => { icon = ic; name.value = n; paintPresets(); }
  })));
  const saveBtn = h('button', { type: 'button', class: 'btn primary save', onclick: async () => {
    msg.textContent = '';
    const target = evaluate(expr);
    if (!name.value.trim()) { msg.textContent = '目標の名前を入力してください'; return; }
    if (target === null || !(target > 0)) { msg.textContent = '目標金額を入力してください'; return; }
    saveBtn.disabled = true;
    try {
      await call('goal.upsert', { id: goal?.id, name: name.value, target_amount: target, deadline, icon: icon || '⭐' }, { user_id: S.currentUserId() });
      toast(goal ? '目標を更新しました' : '目標を作りました'); close(); reload();
    } catch (e) { msg.textContent = errText(e); saveBtn.disabled = false; }
  } }, goal ? '更新する' : '作成する');

  const close = openSheet(h('div', {},
    h('div', { class: 'sheet-head' }, h('h2', {}, goal ? '目標を編集' : '目標を作る'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('h3', { class: 'sub-h' }, 'よく使う目的'), presetBox,
    field('名前', name, '選ぶと名前が入ります。自由に書き換えられます'),
    h('h3', { class: 'sub-h' }, '目標金額'), exprEl, amountEl, kp.el,
    h('div', { class: 'row-left' }, h('span', { class: 'field-label' }, '期限（任意）'), dateIn,
      h('button', { type: 'button', class: 'btn small', onclick: () => { deadline = ''; dateIn.value = ''; } }, '期限なし')),
    msg, h('div', { class: 'row' }, h('span'), saveBtn)), { label: '目標の編集' });
  paint(); paintPresets();
  name.addEventListener('input', paintPresets);
}

/** 目標の詳細: 積立・取り崩し・現在額の修正、履歴、編集/削除 */
function openGoalDetail(g, logs, reload) {
  const cur = Number(g.current_amount), target = Number(g.target_amount);
  const mine = logs.filter((l) => l.goal_id === g.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 8);
  let mode = 'add', expr = '';
  const MODES = [['add', '積立する'], ['sub', '取り崩す'], ['set', '現在額を修正']];
  const modeBar = h('div', { class: 'seg', role: 'group', 'aria-label': '操作' });
  const amountEl = h('div', { class: 'amount' });
  const exprEl = h('div', { class: 'expr muted' });
  const note = h('input', { type: 'text', maxlength: 100, placeholder: 'メモ（任意）' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const paint = () => {
    const v = evaluate(expr);
    amountEl.textContent = v === null ? 'エラー' : yen(v);
    amountEl.className = 'amount ' + (mode === 'sub' ? 'expense' : 'income');
    exprEl.textContent = /[+\-×÷]/.test(expr) ? expr : '';
  };
  const paintModes = () => fill(modeBar, MODES.map(([k, l]) => h('button', { type: 'button', class: 'seg-btn' + (mode === k ? ' on' : ''), 'aria-pressed': String(mode === k),
    onclick: () => { mode = k; expr = ''; kp.set(''); paintModes(); } }, l)));
  const kp = createKeypad('', (e) => { expr = e; paint(); });

  const run = h('button', { type: 'button', class: 'btn primary save', onclick: async () => {
    msg.textContent = '';
    const v = evaluate(expr);
    if (!expr || v === null) { msg.textContent = '金額を入力してください'; return; }
    const delta = mode === 'add' ? v : mode === 'sub' ? -v : v - cur;
    if (delta === 0) { msg.textContent = mode === 'set' ? '現在額と同じです' : '金額を入力してください'; return; }
    run.disabled = true;
    try {
      await call('goal.deposit', { goal_id: g.id, delta, date: today(), note: note.value || (mode === 'set' ? '現在額を修正' : '') }, { user_id: S.currentUserId() });
      toast(delta > 0 ? `${yen(delta)} 積み立てました` : `${yen(-delta)} 減らしました`); close(); reload();
    } catch (e) { msg.textContent = errText(e); run.disabled = false; }
  } }, '実行する');

  const pct = goalPct(cur, target);
  const close = openSheet(h('div', { class: 'budget-edit' },
    h('div', { class: 'sheet-head' }, h('h2', {}, `${g.icon || '⭐'} ${g.name}`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('div', { class: 'goal-hero' }, ring(pct, { size: 96, done: cur >= target, label: `${g.name}の達成率` }),
      h('div', {}, h('div', { class: 'goal-amt' }, `${yen(cur)} / ${yen(target)}`), h('div', { class: 'muted small-text' }, deadlineText(g)))),
    modeBar, exprEl, amountEl, kp.el, field('メモ', note), msg,
    h('div', { class: 'row' }, h('span'), run),
    mine.length > 0 && h('h3', { class: 'sub-h' }, '積立の履歴'),
    mine.map((l) => h('div', { class: 'row tight hist' }, h('span', {}, fmtDate(l.date)),
      h('span', { class: 'muted small-text hist-note' }, l.note || ''), h('strong', { class: Number(l.delta) >= 0 ? 'income' : 'expense' }, (Number(l.delta) >= 0 ? '+' : '−') + yen(Math.abs(Number(l.delta)))))),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        if (!confirm(`「${g.name}」を削除しますか？`)) return;
        try { await call('goal.delete', { id: g.id }, { user_id: S.currentUserId() }); toast('削除しました'); close(); reload(); }
        catch (e) { msg.textContent = errText(e); }
      } }, '目標を削除'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { close(); openGoalEditor(g, reload); } }, '名前・金額・期限を編集'))), { label: '目標の詳細' });
  paintModes(); paint();
}
