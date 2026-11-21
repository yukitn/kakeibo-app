// 資産画面: 総資産・推移グラフ・構成比・口座別残高の更新（収支とは連動しない独立入力）
import { call } from './api.js';
import { today } from './period.js';
import { h, chip, field, errText, openSheet, toast, yen, fill } from './ui.js';
import { createKeypad, evaluate } from './keypad.js';
import { donut, lineChart, colorAt } from './charts.js';
import { ASSET_KINDS, latestBalances, totalsByDate, clipRange, composition, toDays } from './asset-calc.js';
import * as S from './state.js';

const st = { months: 12 };   // 推移の表示範囲: 6 / 12 / 0(全期間)
const RANGES = [[6, '6か月'], [12, '1年'], [0, '全期間']];
const compact = (v) => (Math.abs(v) >= 10000 ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万` : String(v));
const signed = (n) => (n < 0 ? '−' : '') + yen(Math.abs(n));
const kind = (k) => ASSET_KINDS[k] || ASSET_KINDS.other;
const isActive = (a) => a.is_active !== false && a.is_active !== 'FALSE';

export async function paintAssets(body) {
  await S.ensureBoot().catch(() => {});
  const reload = () => paintAssets(body);
  const content = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));
  fill(body, h('h2', {}, '資産'), content);

  try {
    const { accounts: all, snapshots } = await call('asset.list', {}, { user_id: S.currentUserId() });
    const accounts = all.filter(isActive).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
    const ids = accounts.map((a) => a.id);
    const latest = latestBalances(snapshots.filter((s) => ids.includes(s.asset_account_id)));
    const timeline = totalsByDate(snapshots, ids);
    const total = timeline.length ? timeline[timeline.length - 1].total : 0;
    const prev = timeline.length > 1 ? timeline[timeline.length - 2] : null;
    const diff = prev ? total - prev.total : null;

    const totalCard = h('div', { class: 'card' },
      h('p', { class: 'muted', style: 'margin:0' }, '総資産'),
      h('p', { class: 'big-amt ' + (total >= 0 ? '' : 'expense') }, signed(total)),
      prev && h('p', { class: 'muted small-text' }, `前回の記録（${prev.date.replace(/-/g, '/')}）から `,
        h('strong', { class: diff >= 0 ? 'income' : 'expense' }, (diff >= 0 ? '+' : '−') + yen(Math.abs(diff)))),
      !timeline.length && h('p', { class: 'muted' }, 'まだ残高が記録されていません。下の口座をタップして、いまの残高を入力してください。'));

    const pts = clipRange(timeline, today(), st.months).map((p) => ({ date: p.date, value: p.total }));
    const trendCard = timeline.length > 0 && h('div', { class: 'card' }, h('h3', {}, '総資産の推移'),
      h('div', { class: 'seg small', role: 'group', 'aria-label': '表示期間' },
        RANGES.map(([m, l]) => h('button', { type: 'button', class: 'seg-btn' + (st.months === m ? ' on' : ''), 'aria-pressed': String(st.months === m),
          onclick: () => { st.months = m; reload(); } }, l))),
      pts.length > 1
        ? lineChart(pts, { label: '総資産の推移', fmt: (v) => `¥${compact(v)}`, toDays })
        : h('p', { class: 'muted' }, 'グラフには2回以上の記録が必要です（残高を更新するたびに推移が残ります）'));

    const { pos, neg } = composition(accounts, latest);
    const posTotal = pos.reduce((a, r) => a + r.value, 0);
    const segs = pos.map((r, i) => ({ label: r.account.name, value: r.value, color: colorAt(i) }));
    const compCard = (pos.length > 0) && h('div', { class: 'card' }, h('h3', {}, '資産の構成'),
      h('div', { class: 'donut-wrap' },
        donut(segs, { center: yen(posTotal), sub: 'プラス残高の合計', label: `資産の構成（${yen(posTotal)}）` }),
        h('ul', { class: 'legend' }, segs.map((s) => h('li', {}, h('div', { class: 'legend-row' },
          h('span', { class: 'dot', style: `background:${s.color}`, 'aria-hidden': 'true' }),
          h('span', { class: 'legend-name' }, s.label), h('span', { class: 'legend-val' }, yen(s.value)),
          h('span', { class: 'legend-pct muted' }, `${Math.round((s.value / posTotal) * 100)}%`)))))),
      neg.length > 0 && h('p', { class: 'muted small-text' }, 'マイナス残高: ' + neg.map((r) => `${r.account.name} ${signed(r.balance)}`).join('、')));

    const listCard = h('div', { class: 'card' }, h('h3', {}, '口座ごとの残高'),
      accounts.length ? accounts.map((a) => {
        const l = latest.get(a.id);
        return h('button', { type: 'button', class: 'tx', onclick: () => openBalanceEditor(a, snapshots, reload) },
          h('span', { class: 'tx-icon', 'aria-hidden': 'true' }, kind(a.kind).icon),
          h('span', { class: 'tx-main' }, h('span', { class: 'tx-name' }, a.name),
            h('span', { class: 'tx-sub muted' }, l ? `${l.date.replace(/-/g, '/')} 時点` : '未入力　タップして入力')),
          h('span', { class: 'tx-amt ' + (l && l.balance < 0 ? 'expense' : '') }, l ? signed(l.balance) : '—'));
      }) : h('p', { class: 'muted' }, '口座がありません。「口座を管理」から追加してください。'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: () => openAccountManager(all, reload) }, '口座を管理')));

    fill(content, totalCard, trendCard, compCard, listCard,
      h('p', { class: 'note' }, '資産は日々の収支とは連動しません。残高を確認したときに入力すると、推移が残ります。'));
  } catch (e) {
    fill(content, h('p', { class: 'msg' }, errText(e)));
  }
}

/** 残高の記録（日付・金額・マイナス可）と、この口座の直近の記録 */
function openBalanceEditor(account, snapshots, reload) {
  const mine = snapshots.filter((s) => s.asset_account_id === account.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const last = mine[0];
  let expr = last ? String(Math.abs(Number(last.balance))) : '';
  let negative = last ? Number(last.balance) < 0 : false;
  let date = today();

  const amountEl = h('div', { class: 'amount' });
  const exprEl = h('div', { class: 'expr muted' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const note = h('input', { type: 'text', maxlength: 100, placeholder: 'メモ（任意）' });
  const paint = () => {
    const v = evaluate(expr);
    amountEl.textContent = v === null ? 'エラー' : (negative && v > 0 ? '−' : '') + yen(v);
    amountEl.className = 'amount' + (negative ? ' expense' : '');
    exprEl.textContent = /[+\-×÷]/.test(expr) ? expr : '';
  };
  const kp = createKeypad(expr, (e) => { expr = e; paint(); });
  const saveBtn = h('button', { type: 'button', class: 'btn primary save', onclick: () => doSave() }, '記録する');
  const history = h('div', {});

  const paintHistory = () => fill(history,
    mine.length > 0 && h('h3', { class: 'sub-h' }, '最近の記録'),
    mine.slice(0, 6).map((s) => h('div', { class: 'row tight hist' },
      h('span', {}, s.date.replace(/-/g, '/')), h('strong', {}, signed(Number(s.balance))),
      h('button', { type: 'button', class: 'btn small danger', onclick: () => doDelete(s) }, '削除'))));

  async function doSave() {
    msg.textContent = '';
    if (!expr) { msg.textContent = '金額を入力してください（0円なら 0 を入力）'; return; }
    const v = evaluate(expr);
    if (v === null) { msg.textContent = '計算できない式です'; return; }
    saveBtn.disabled = true;
    try {
      await call('asset.snapshot', { asset_account_id: account.id, date, balance: negative ? -v : v, note: note.value }, { user_id: S.currentUserId() });
      toast(`${account.name} の残高を記録しました`); close(); reload();
    } catch (e) { msg.textContent = errText(e); saveBtn.disabled = false; }
  }
  async function doDelete(s) {
    if (!confirm(`${s.date.replace(/-/g, '/')} の記録（${signed(Number(s.balance))}）を削除しますか？`)) return;
    try { await call('asset.delete', { id: s.id }, { user_id: S.currentUserId() }); toast('削除しました'); close(); reload(); }
    catch (e) { msg.textContent = errText(e); }
  }

  const dateIn = h('input', { type: 'date', value: date, class: 'date-input', 'aria-label': '残高の日付', onchange: (e) => { if (e.target.value) date = e.target.value; } });
  const negIn = h('input', { type: 'checkbox', checked: negative, onchange: (e) => { negative = e.target.checked; paint(); } });

  const close = openSheet(h('div', { class: 'budget-edit' },
    h('div', { class: 'sheet-head' }, h('h2', {}, `${kind(account.kind).icon} ${account.name}`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    last && h('p', { class: 'muted small-text' }, `前回: ${signed(Number(last.balance))}（${last.date.replace(/-/g, '/')}）`),
    h('div', { class: 'row-left' }, h('label', { class: 'check' }, negIn, 'マイナス残高（借入など）'), dateIn),
    exprEl, amountEl, kp.el, field('メモ', note), msg,
    h('div', { class: 'row' }, h('span'), saveBtn), history), { label: '残高の記録' });
  paint(); paintHistory();
}

/** 資産口座の追加・名前変更・非表示 */
function openAccountManager(allAccounts, reload) {
  const msg = h('p', { class: 'msg', role: 'alert' });
  const listEl = h('div', {});
  let newKind = 'bank';
  const newName = h('input', { type: 'text', maxlength: 30, placeholder: '例: ○○銀行 / ○○証券' });
  const kindBox = h('div', { class: 'chips' });
  const client = () => ({ user_id: S.currentUserId() });

  const paintKinds = () => fill(kindBox, Object.entries(ASSET_KINDS).map(([k, v]) =>
    chip(v.label, { icon: v.icon, selected: newKind === k, onclick: () => { newKind = k; paintKinds(); } })));
  const paintList = () => fill(listEl, allAccounts.filter(isActive).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)).map((a) => {
    const inp = h('input', { type: 'text', value: a.name, maxlength: 30, 'aria-label': `${a.name} の名前` });
    return h('div', { class: 'row tight acc-row' }, h('span', { 'aria-hidden': 'true' }, kind(a.kind).icon), inp,
      h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const name = inp.value.trim(); if (!name || name === a.name) return;
        try { const r = await call('master.upsert', { entity: 'asset_account', item: { id: a.id, name } }, client()); a.name = r.name; toast('名前を変更しました'); }
        catch (e) { msg.textContent = errText(e); }
      } }, '保存'),
      h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        if (!confirm(`「${a.name}」を非表示にしますか？（記録は残り、総資産の集計から外れます）`)) return;
        try { await call('master.archive', { entity: 'asset_account', id: a.id }, client()); a.is_active = false; toast('非表示にしました'); paintList(); }
        catch (e) { msg.textContent = errText(e); }
      } }, '非表示'));
  }));

  const close = openSheet(h('div', {},
    h('div', { class: 'sheet-head' }, h('h2', {}, '口座を管理'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { close(); }, 'aria-label': '閉じる' }, '✕')),
    listEl, h('h3', { class: 'sub-h' }, '口座を追加'), field('名前', newName), kindBox, msg,
    h('div', { class: 'row' }, h('span'), h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      msg.textContent = '';
      const name = newName.value.trim(); if (!name) { msg.textContent = '名前を入力してください'; return; }
      try {
        const r = await call('master.upsert', { entity: 'asset_account', item: { name, kind: newKind, sort: allAccounts.length + 1 } }, client());
        allAccounts.push(r); newName.value = ''; toast('口座を追加しました'); paintList();
      } catch (e) { msg.textContent = errText(e); }
    } }, '追加'))), { label: '口座の管理', onClose: reload });
  paintKinds(); paintList();
}
