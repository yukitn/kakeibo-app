// ホーム（月次サマリ）と履歴（検索・編集・削除）
import { call } from './api.js';
import { getPeriod, shiftPeriod, periodOfKey, today } from './period.js';
import { h, chip, errText, openSheet, toast, yen, dateLabel, fill } from './ui.js';
import { openEntry } from './entry.js';
import { alerts, resolveBudget, level, spentMaps } from './budget-calc.js';
import { bar, remainText } from './budget.js';
import { ring } from './charts.js';
import { pending, removeItem, syncOutbox, cacheGet, cachePut } from './queue.js';
import { activeProfile } from './store.js';
import * as S from './state.js';

const sum = (items, type) => items.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0);

function periodLabel(p) { return `${p.from.replace(/-/g, '/')} 〜 ${p.to.replace(/-/g, '/')}`; }

function txTitle(t) {
  const c = S.catById(t.category_id);
  const sub = t.subcategory_id ? S.catById(t.subcategory_id) : null;
  return { icon: c?.icon || (t.type === 'income' ? '💰' : '🧾'), name: c ? c.name + (sub ? ` ＞ ${sub.name}` : '') : '（不明）' };
}

function txRow(t, onOpen) {
  const { icon, name } = txTitle(t);
  const tagNames = t.tags ? String(t.tags).split(';').map((id) => S.tagById(id)?.name).filter(Boolean) : [];
  return h('button', { type: 'button', class: 'tx', onclick: () => onOpen(t) },
    h('span', { class: 'tx-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-name' }, name),
      h('span', { class: 'tx-sub muted' }, [S.accById(t.account_id)?.name, t.memo, ...tagNames.map((n) => '#' + n)].filter(Boolean).join(' ・ '))),
    h('span', { class: 'tx-amt ' + t.type }, (t.type === 'income' ? '+' : '−') + yen(t.amount)));
}

/** 取引の詳細（領収書表示・編集・削除） */
export function openDetail(t, onChanged) {
  const { icon, name } = txTitle(t);
  const imgBox = h('div', { class: 'receipt' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const del = h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
    if (!confirm('この記録を削除しますか？（シート上は削除済みとして残ります）')) return;
    del.disabled = true;
    try {
      await call('tx.delete', { id: t.id }, { user_id: S.currentUserId() });
      toast('削除しました'); close(); onChanged();
    } catch (e) { msg.textContent = errText(e); del.disabled = false; }
  } }, '削除');
  const edit = h('button', { type: 'button', class: 'btn small', onclick: () => { close(); openEntry({ tx: t, onSaved: onChanged }); } }, '編集');
  const user = (S.getBoot().users || []).find((u) => u.id === t.user_id);

  const rows = [
    ['日付', dateLabel(t.date)],
    ['支払い方法/入金先', S.accById(t.account_id)?.name || '—'],
    ['タグ', t.tags ? String(t.tags).split(';').map((id) => S.tagById(id)?.name).filter(Boolean).map((n) => '#' + n).join(' ') || '—' : '—'],
    ['備考', t.memo || '—'],
    S.getBoot().users.length > 1 && ['入力者', user?.name || '—']
  ].filter(Boolean);

  const close = openSheet(h('div', { class: 'detail' },
    h('div', { class: 'sheet-head' }, h('h2', {}, `${icon} ${name}`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('p', { class: 'big-amt ' + t.type }, (t.type === 'income' ? '+' : '−') + yen(t.amount)),
    h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    imgBox, msg,
    h('div', { class: 'row' }, del, edit)), { label: '取引の詳細' });

  if (t.receipt_file_id) {
    imgBox.append(h('p', { class: 'muted' }, '領収書を読み込み中…'));
    call('image.get', { file_id: t.receipt_file_id }, { user_id: S.currentUserId() }).then((r) => {
      fill(imgBox, h('img', { src: `data:${r.mime};base64,${r.data_base64}`, alt: '領収書' }));
    }).catch((e) => fill(imgBox, h('p', { class: 'msg' }, '領収書を読み込めません: ' + errText(e))));
  }
}

/** 端末に保存済みの未送信入力のカード。無ければ null */
async function pendingCard(body) {
  try {
    const p = activeProfile();
    const q = p ? await pending(p.id) : [];
    if (!q.length) return null;
    const run = async () => {
      const r = await syncOutbox();
      toast(r.sent ? `${r.sent} 件を送信しました` : r.offline ? 'まだ通信できません' : '送信できなかった入力があります');
      paintHome(body);
    };
    return h('div', { class: 'card pending', role: 'status' },
      h('h3', {}, `📤 未送信の入力 ${q.length} 件`),
      h('p', { class: 'muted small-text' }, '通信できなかった入力は、この端末に保存されています。接続すると自動で送信されます。'),
      q.map((x) => h('div', { class: 'row tight hist' },
        h('span', {}, `${x.payload.date.replace(/-/g, '/')}　${yen(x.payload.amount)}`),
        x.failed ? h('span', { class: 'msg small-text' }, '送信できません: ' + x.failed) : h('span', { class: 'muted small-text' }, '送信待ち'),
        x.failed && h('button', { type: 'button', class: 'btn small danger', onclick: async () => { if (confirm('この入力を破棄しますか？')) { await removeItem(x.qid); paintHome(body); } } }, '破棄'))),
      h('button', { type: 'button', class: 'btn small primary', onclick: run }, '今すぐ送信'));
  } catch { return null; }
}

/* ---------- ホーム ---------- */
const goTab = (id) => document.dispatchEvent(new CustomEvent('goto-tab', { detail: id }));

/**
 * ホーム: 1回の通信(dashboard)で全部取得する。前回取得した内容が端末にあれば先に表示し、届き次第、最新に差し替える
 * （GAS の応答待ちで真っ白な時間を作らない）。
 */
export async function paintHome(body) {
  fill(body, h('h2', {}, 'ホーム'), h('p', { class: 'muted' }, '読み込み中…'));
  const pendCard = await pendingCard(body);
  const prof = activeProfile();
  let period;
  try {
    await S.ensureBoot();
    period = getPeriod(today(), S.startDay());
  } catch (e) {
    fill(body, h('h2', {}, 'ホーム'), pendCard, offlineOrError(e));
    return;
  }
  const key = `dash:${prof.id}:${period.key}`;
  const cached = await cacheGet(key).catch(() => null);
  if (cached) renderHome(body, cached, period, pendCard, '更新中…');
  try {
    const d = await call('dashboard', { from: period.from, to: period.to }, { user_id: S.currentUserId() });
    cachePut(key, d).catch(() => {});
    renderHome(body, d, period, pendCard, '');
  } catch (e) {
    if (cached) renderHome(body, cached, period, pendCard, e.code === 'NETWORK' ? 'オフラインのため、最後に取得した内容を表示しています' : errText(e));
    else fill(body, h('h2', {}, 'ホーム'), pendCard, offlineOrError(e));
  }
}

const offlineOrError = (e) => h('p', { class: e.code === 'NETWORK' ? 'muted' : 'msg' },
  e.code === 'NETWORK' ? 'オフラインのため、集計を表示できません。入力は保存でき、接続後に送信されます。' : errText(e));

function renderHome(body, d, period, pendCard, note) {
  const { income, expense } = d.totals;
  const { top: spentTop } = spentMaps(d.by_category);
  const tops = S.topCategories('expense');

  // 支出の大カテゴリ別内訳（上位5）
  const topRows = tops.map((c) => ({ name: c.name, icon: c.icon || '', amt: spentTop.get(c.id) || 0 })).filter((r) => r.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 5);
  const max = topRows[0]?.amt || 1;

  // 予算の進捗: 予算のある大カテゴリを、使用率の高い順に
  const rows = tops.map((c) => ({ c, b: resolveBudget(d.budgets, c.id, period.key), used: spentTop.get(c.id) || 0 }))
    .filter((r) => r.b).sort((x, y) => y.used / y.b.amount - x.used / x.b.amount);
  const totalBudget = rows.reduce((a, r) => a + r.b.amount, 0);
  const totalUsed = rows.reduce((a, r) => a + r.used, 0);
  const pct = goalPctSafe(totalUsed, totalBudget);
  const lv = level(totalUsed, totalBudget);
  const al = alerts(tops, d.budgets, spentTop, period.key);

  const budgetCard = rows.length
    ? h('div', { class: 'card' },
      h('div', { class: 'row tight' }, h('h3', {}, '今月の予算'), h('button', { type: 'button', class: 'btn small ghost', onclick: () => goTab('budget') }, 'くわしく ›')),
      h('div', { class: 'budget-hero' },
        ring(pct, { size: 96, label: '予算の使用率', tone: lv }),
        h('div', { class: 'budget-hero-text' },
          h('div', { class: 'goal-amt' }, `${yen(totalUsed)} / ${yen(totalBudget)}`),
          h('div', { class: 'small-text ' + (lv === 'over' ? 'expense' : 'muted') }, remainText(totalUsed, totalBudget)))),
      rows.slice(0, 6).map(({ c, b, used }) => h('div', { class: 'home-bud' },
        h('div', { class: 'row tight' }, h('span', {}, `${c.icon || ''} ${c.name}`), h('span', { class: 'bud-amt' }, `${yen(used)} / ${yen(b.amount)}`)),
        bar(used, b.amount))),
      rows.length > 6 && h('p', { class: 'note' }, `ほか ${rows.length - 6} 件は「予算」画面で見られます`))
    : h('div', { class: 'card' }, h('h3', {}, '今月の予算'),
      h('p', { class: 'muted' }, 'まだ予算が設定されていません。カテゴリごとに月の予算を決めると、ここで使いすぎを一目で確認できます。'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => goTab('budget') }, '予算を設定する'));

  fill(body,
    h('h2', {}, 'ホーム'),
    h('p', { class: 'muted' }, `今月（${periodLabel(period)}）`, note && h('span', { class: 'stale-note' }, '　' + note)),
    pendCard,
    al.length > 0 && h('div', { class: 'card alert', role: 'status' }, al.map((a) =>
      h('p', {}, (a.level === 'over' ? '⚠️ ' : '🔔 ') + `${a.category.name}：` +
        (a.level === 'over' ? `予算を ${yen(a.used - a.budget)} 超えています` : `予算の ${Math.round((a.used / a.budget) * 100)}% に達しました`)))),
    h('div', { class: 'summary' },
      h('div', { class: 'card stat' }, h('span', { class: 'muted' }, '収入'), h('strong', { class: 'income' }, yen(income))),
      h('div', { class: 'card stat' }, h('span', { class: 'muted' }, '支出'), h('strong', { class: 'expense' }, yen(expense))),
      h('div', { class: 'card stat' }, h('span', { class: 'muted' }, '収支'), h('strong', { class: income - expense >= 0 ? 'income' : 'expense' }, (income - expense < 0 ? '−' : '') + yen(Math.abs(income - expense))))),
    budgetCard,
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, '支出の内訳'),
        topRows.length ? topRows.map((c) => h('div', { class: 'bar-row' },
          h('span', { class: 'bar-label' }, `${c.icon} ${c.name}`),
          h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: `width:${Math.max(4, Math.round((c.amt / max) * 100))}%` })),
          h('span', { class: 'bar-val' }, yen(c.amt)))) : h('p', { class: 'muted' }, 'まだ支出がありません。右下の「＋ 入力」から入力できます。')),
      h('div', { class: 'card' }, h('h3', {}, '最近の入力'),
        d.recent.length ? h('div', { class: 'tx-list' }, d.recent.map((t) => txRow(t, (x) => openDetail(x, () => paintHome(body)))))
          : h('p', { class: 'muted' }, 'まだ入力がありません。'))));
}

const goalPctSafe = (used, budget) => (budget > 0 ? Math.round((used / budget) * 100) : 0);

/* ---------- 履歴 ---------- */
const hist = { key: null, keyword: '', type: '', category: '', tag: '' };

export async function paintHistory(body) {
  await S.ensureBoot().catch(() => {});
  if (!hist.key) hist.key = getPeriod(today(), S.startDay()).key;
  const period = periodOfKey(hist.key, S.startDay());

  const list = h('div', { class: 'tx-groups' }, h('p', { class: 'muted' }, '読み込み中…'));
  const summary = h('p', { class: 'muted' });
  const reload = () => paintHistory(body);

  const kw = h('input', { type: 'search', placeholder: '備考で検索', value: hist.keyword, 'aria-label': '備考で検索',
    onkeydown: (e) => { if (e.key === 'Enter') { hist.keyword = e.target.value.trim(); reload(); } },
    onchange: (e) => { hist.keyword = e.target.value.trim(); reload(); } });
  const catSel = h('select', { 'aria-label': 'カテゴリで絞り込み', onchange: (e) => { hist.category = e.target.value; reload(); } },
    h('option', { value: '' }, 'すべてのカテゴリ'),
    [...S.topCategories('expense'), ...S.topCategories('income')].map((c) => h('option', { value: c.id, selected: hist.category === c.id }, c.name)));
  const tagSel = h('select', { 'aria-label': 'タグで絞り込み', onchange: (e) => { hist.tag = e.target.value; reload(); } },
    h('option', { value: '' }, 'すべてのタグ'),
    S.tags().map((t) => h('option', { value: t.id, selected: hist.tag === t.id }, '#' + t.name)));

  fill(body, 
    h('h2', {}, '履歴'),
    h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn small', 'aria-label': '前の月', onclick: () => { hist.key = shiftPeriod(hist.key, -1, S.startDay()).key; reload(); } }, '‹'),
      h('strong', {}, `${hist.key.replace('-', '年')}月`),
      h('button', { type: 'button', class: 'btn small', 'aria-label': '次の月', onclick: () => { hist.key = shiftPeriod(hist.key, 1, S.startDay()).key; reload(); } }, '›')),
    h('p', { class: 'muted center-text' }, periodLabel(period)),
    h('div', { class: 'seg small', role: 'group', 'aria-label': '収支で絞り込み' },
      [['', 'すべて'], ['expense', '支出'], ['income', '収入']].map(([k, l]) =>
        h('button', { type: 'button', class: 'seg-btn' + (hist.type === k ? ' on' : ''), 'aria-pressed': String(hist.type === k), onclick: () => { hist.type = k; reload(); } }, l))),
    h('div', { class: 'filters' }, kw, catSel, tagSel),
    summary, list);

  try {
    const q = { from: period.from, to: period.to, limit: 1000 };
    if (hist.type) q.type = hist.type;
    if (hist.keyword) q.keyword = hist.keyword;
    let { items } = await call('tx.list', q, { user_id: S.currentUserId() });
    // カテゴリ・タグは端末側で絞り込み（取引の category_id は大カテゴリ、サブは subcategory_id に入る）
    if (hist.category) items = items.filter((t) => t.category_id === hist.category);
    if (hist.tag) items = items.filter((t) => String(t.tags).split(';').includes(hist.tag));

    summary.textContent = `${items.length}件　収入 ${yen(sum(items, 'income'))} ／ 支出 ${yen(sum(items, 'expense'))}`;
    if (!items.length) { fill(list, h('p', { class: 'muted' }, '該当する記録はありません')); return; }
    const groups = new Map();
    items.forEach((t) => groups.set(t.date, [...(groups.get(t.date) || []), t]));
    fill(list, ...[...groups].map(([date, arr]) =>
      h('section', { class: 'card' },
        h('h3', { class: 'day' }, dateLabel(date)),
        h('div', { class: 'tx-list' }, arr.map((t) => txRow(t, (x) => openDetail(x, reload)))))));
  } catch (e) {
    fill(list, h('p', { class: 'msg' }, errText(e)));
  }
}
