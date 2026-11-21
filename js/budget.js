// 予算画面: 大カテゴリ/サブカテゴリ別の使用率バーと、基本・特定月・特定年の予算設定
import { call } from './api.js';
import { getPeriod, shiftPeriod, periodOfKey, today } from './period.js';
import { h, errText, openSheet, toast, yen, fill } from './ui.js';
import { createKeypad, evaluate } from './keypad.js';
import { resolveBudget, level, ratioPct, spentMaps, alerts } from './budget-calc.js';
import * as S from './state.js';

const st = { key: null };
const SRC_LABEL = { month: 'この月だけ', year: 'この年', default: '' };

export function bar(used, budget, { sub = false } = {}) {
  let lv = level(used, budget);
  if (sub && lv === 'warn') lv = 'ok';                 // サブ単位は強い警告を出さない
  const cls = sub && lv === 'over' ? 'caution' : lv;   // サブの超過は注意色止まり
  return h('div', { class: 'pbar ' + cls, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100,
    'aria-valuenow': ratioPct(used, budget), 'aria-label': '予算の使用率' },
  h('span', { class: 'pbar-fill', style: `width:${ratioPct(used, budget)}%` }));
}

export function remainText(used, budget) {
  const r = budget - used;
  return r >= 0 ? `残り ${yen(r)}` : `${yen(-r)} オーバー`;
}

export async function paintBudget(body) {
  await S.ensureBoot().catch(() => {});
  if (!st.key) st.key = getPeriod(today(), S.startDay()).key;
  const period = periodOfKey(st.key, S.startDay());
  const reload = () => paintBudget(body);
  const list = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));

  fill(body, 
    h('h2', {}, '予算'),
    h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn small', 'aria-label': '前の月', onclick: () => { st.key = shiftPeriod(st.key, -1, S.startDay()).key; reload(); } }, '‹'),
      h('strong', {}, `${st.key.replace('-', '年')}月`),
      h('button', { type: 'button', class: 'btn small', 'aria-label': '次の月', onclick: () => { st.key = shiftPeriod(st.key, 1, S.startDay()).key; reload(); } }, '›')),
    h('p', { class: 'muted center-text' }, `${period.from.replace(/-/g, '/')} 〜 ${period.to.replace(/-/g, '/')}`),
    list);

  try {
    const client = { user_id: S.currentUserId() };
    const [bl, stats] = await Promise.all([
      call('budget.list', {}, client),
      call('tx.stats', { from: period.from, to: period.to }, client)
    ]);
    const budgets = bl.items;
    const { top: spentTop, sub: spentSub } = spentMaps(stats.by_category);
    const tops = S.topCategories('expense');

    // 合計（大カテゴリ予算の合計 vs 予算を持つカテゴリの使用額）
    let totalBudget = 0, totalUsed = 0;
    tops.forEach((c) => {
      const b = resolveBudget(budgets, c.id, st.key);
      if (b) { totalBudget += b.amount; totalUsed += spentTop.get(c.id) || 0; }
    });
    const al = alerts(tops, budgets, spentTop, st.key);

    fill(list, 
      al.length > 0 && h('div', { class: 'card alert', role: 'status' },
        al.map((a) => h('p', {}, (a.level === 'over' ? '⚠️ ' : '🔔 ') + `${a.category.name}：` +
          (a.level === 'over' ? `予算を ${yen(a.used - a.budget)} 超えています` : `予算の ${Math.round((a.used / a.budget) * 100)}% に達しました`)))),
      totalBudget > 0 && h('div', { class: 'card' },
        h('div', { class: 'row tight' }, h('strong', {}, '予算の合計'), h('span', { class: 'muted' }, `${yen(totalUsed)} / ${yen(totalBudget)}`)),
        bar(totalUsed, totalBudget), h('p', { class: 'muted small-text' }, remainText(totalUsed, totalBudget))),
      h('div', { class: 'card' }, tops.map((c) => categoryBlock(c, budgets, spentTop, spentSub, reload))),
      h('p', { class: 'note' }, 'カテゴリ名をタップして予算を設定できます。サブカテゴリの予算は別枠で、超過しても警告は大カテゴリの合計のみ表示します。'));
  } catch (e) {
    fill(list, h('p', { class: 'msg' }, errText(e)));
  }
}

function categoryBlock(cat, budgets, spentTop, spentSub, reload) {
  const b = resolveBudget(budgets, cat.id, st.key);
  const used = spentTop.get(cat.id) || 0;
  const subs = S.subCategories(cat.id);
  const head = h('button', { type: 'button', class: 'bud-head', onclick: () => openBudgetEditor(cat, budgets, reload) },
    h('div', { class: 'row tight' },
      h('span', { class: 'bud-name' }, `${cat.icon || ''} ${cat.name}`, b && b.source !== 'default' && h('span', { class: 'badge' }, SRC_LABEL[b.source])),
      h('span', { class: 'bud-amt' }, b ? `${yen(used)} / ${yen(b.amount)}` : `${yen(used)}　予算未設定`)),
    b ? [bar(used, b.amount), h('span', { class: 'muted small-text ' + (level(used, b.amount) === 'over' ? 'expense' : '') }, remainText(used, b.amount))] : null);

  const subRows = subs.map((s) => {
    const sb = resolveBudget(budgets, s.id, st.key);
    const su = spentSub.get(s.id) || 0;
    if (!sb && !su) return h('button', { type: 'button', class: 'bud-sub muted', onclick: () => openBudgetEditor(s, budgets, reload, cat) }, `└ ${s.name}　予算未設定`);
    return h('button', { type: 'button', class: 'bud-sub', onclick: () => openBudgetEditor(s, budgets, reload, cat) },
      h('div', { class: 'row tight' }, h('span', {}, `└ ${s.name}`), h('span', { class: 'bud-amt' }, sb ? `${yen(su)} / ${yen(sb.amount)}` : yen(su))),
      sb && bar(su, sb.amount, { sub: true }));
  });
  return h('div', { class: 'bud-block' }, head, subs.length > 0 && h('div', { class: 'bud-subs' }, subRows));
}

/** 予算エディタ: 設定範囲（毎月/この月だけ/この年）を選び、テンキーで金額入力 */
function openBudgetEditor(cat, budgets, reload, parent = null) {
  const year = st.key.slice(0, 4);
  const [, mm] = st.key.split('-');
  const eff = resolveBudget(budgets, cat.id, st.key);
  const scopes = [
    { type: 'default', key: '', label: '毎月（基本）' },
    { type: 'month', key: st.key, label: `${year}年${Number(mm)}月だけ` },
    { type: 'year', key: year, label: `${year}年は毎月` }
  ];
  let scope = scopes.find((s) => eff && s.type === eff.source) || scopes[0];
  const existing = () => budgets.find((b) => b.category_id === cat.id && b.period_type === scope.type && String(b.period_key) === scope.key);

  const amountEl = h('div', { class: 'amount' });
  const exprEl = h('div', { class: 'expr muted' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '設定する範囲' });
  const note = h('p', { class: 'muted small-text' });
  const delBtn = h('button', { type: 'button', class: 'btn small danger', onclick: () => doDelete() }, 'この設定を削除');
  const saveBtn = h('button', { type: 'button', class: 'btn primary save', onclick: () => doSave() }, '保存する');
  const kp = createKeypad('', (e) => { expr = e; paintAmount(); });
  let expr = '';

  const paintAmount = () => {
    const v = evaluate(expr);
    amountEl.textContent = v === null ? 'エラー' : yen(v);
    exprEl.textContent = /[+\-×÷]/.test(expr) ? expr : '';
  };
  const paintScope = () => {
    fill(seg, ...scopes.map((s) => h('button', {
      type: 'button', class: 'seg-btn' + (s === scope ? ' on' : ''), 'aria-pressed': String(s === scope),
      onclick: () => { scope = s; const e = existing(); kp.set(e ? String(e.amount) : ''); paintScope(); }
    }, s.label)));
    const e = existing();
    delBtn.hidden = !e;
    note.textContent = scope.type === 'default' ? '特別な設定がない月に使われます。'
      : scope.type === 'month' ? 'この月だけ基本の予算を上書きします（月の予算が最優先）。'
        : `${year}年の毎月に適用します（基本より優先、月の設定より後）。`;
  };

  async function doSave() {
    msg.textContent = '';
    const amount = evaluate(expr);
    if (amount === null || !(amount > 0)) { msg.textContent = '金額を入力してください（0にしたい場合は「削除」を使います）'; return; }
    saveBtn.disabled = true;
    try {
      await call('budget.upsert', { category_id: cat.id, period_type: scope.type, period_key: scope.key, amount }, { user_id: S.currentUserId() });
      toast('予算を保存しました'); close(); reload();
    } catch (e) { msg.textContent = errText(e); saveBtn.disabled = false; }
  }
  async function doDelete() {
    const e = existing();
    if (!e || !confirm(`「${scope.label}」の予算設定を削除しますか？`)) return;
    try {
      await call('budget.delete', { id: e.id }, { user_id: S.currentUserId() });
      toast('削除しました'); close(); reload();
    } catch (err) { msg.textContent = errText(err); }
  }

  const close = openSheet(h('div', { class: 'budget-edit' },
    h('div', { class: 'sheet-head' },
      h('h2', {}, `${parent ? parent.name + ' ＞ ' : ''}${cat.name} の予算`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('p', { class: 'muted small-text' }, '金額は「1か月あたり」です。'),
    seg, note, exprEl, amountEl, kp.el, msg,
    h('div', { class: 'row' }, delBtn, saveBtn)), { label: '予算の設定' });

  const e0 = existing() || (eff && eff.source === scope.type ? existing() : null);
  kp.set(e0 ? String(e0.amount) : '');
  paintScope();
}
