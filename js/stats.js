// 統計ダッシュボード: 月別収支推移・カテゴリ内訳(ドリルダウン)・タグ別ランキング・収入内訳・ユーザー別
import { call } from './api.js';
import { getPeriod, shiftPeriod, today } from './period.js';
import { h, errText, openSheet, yen } from './ui.js';
import { donut, barChart, colorAt } from './charts.js';
import * as S from './state.js';

const st = { months: 6, drill: '' };   // months: 1(今月) / 3 / 6 / 12
const RANGES = [[1, '今月'], [3, '3か月'], [6, '6か月'], [12, '12か月']];
const TREND_MONTHS = 6;                // 推移グラフは最低でも直近6か月を表示

const monthLabel = (key) => `${Number(key.split('-')[1])}月`;

/** 内訳リスト: 色・名称・金額・割合をテキストでも併記 */
function legend(rows, total, onTap) {
  return h('ul', { class: 'legend' }, rows.map((r) =>
    h('li', {}, h(onTap ? 'button' : 'div', { type: onTap ? 'button' : false, class: 'legend-row', onclick: onTap ? () => onTap(r) : false },
      h('span', { class: 'dot', style: `background:${r.color}`, 'aria-hidden': 'true' }),
      h('span', { class: 'legend-name' }, r.label),
      h('span', { class: 'legend-val' }, yen(r.value)),
      h('span', { class: 'legend-pct muted' }, total ? `${Math.round((r.value / total) * 100)}%` : '')))));
}

function donutCard(title, rows, { centerLabel, onTap, empty = 'データがありません' } = {}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const colored = rows.map((r, i) => ({ ...r, color: colorAt(i) }));
  return h('div', { class: 'card' }, h('h3', {}, title),
    total > 0
      ? h('div', { class: 'donut-wrap' },
        donut(colored, { center: yen(total), sub: centerLabel || '', label: `${title}（合計${yen(total)}）` }),
        legend(colored, total, onTap))
      : h('p', { class: 'muted' }, empty));
}

export async function paintStats(body) {
  await S.ensureBoot().catch(() => {});
  const reload = () => paintStats(body);
  const cur = getPeriod(today(), S.startDay());
  const nTrend = Math.max(st.months, TREND_MONTHS);
  const trendFrom = shiftPeriod(cur.key, -(nTrend - 1), S.startDay()).from;
  const rangeFrom = shiftPeriod(cur.key, -(st.months - 1), S.startDay()).from;
  const content = h('div', {}, h('p', { class: 'muted' }, '読み込み中…'));

  body.replaceChildren(
    h('h2', {}, '統計'),
    h('div', { class: 'seg small', role: 'group', 'aria-label': '期間' },
      RANGES.map(([m, l]) => h('button', { type: 'button', class: 'seg-btn' + (st.months === m ? ' on' : ''), 'aria-pressed': String(st.months === m),
        onclick: () => { st.months = m; st.drill = ''; reload(); } }, l))),
    content);

  try {
    const client = { user_id: S.currentUserId() };
    const [trend, detail] = await Promise.all([
      call('tx.stats', { from: trendFrom, to: cur.to }, client),
      nTrend === st.months ? null : call('tx.stats', { from: rangeFrom, to: cur.to }, client)
    ]);
    const d = detail || trend;

    // --- 月別収支推移 ---
    const map = new Map(trend.by_month.map((m) => [m.key, m]));
    const months = [];
    for (let i = nTrend - 1; i >= 0; i--) months.push(shiftPeriod(cur.key, -i, S.startDay()).key);
    const series = months.map((k) => ({ label: monthLabel(k), income: map.get(k)?.income || 0, expense: map.get(k)?.expense || 0 }));
    const rangeMonths = months.slice(-st.months);
    const inc = rangeMonths.reduce((a, k) => a + (map.get(k)?.income || 0), 0);
    const exp = rangeMonths.reduce((a, k) => a + (map.get(k)?.expense || 0), 0);

    const trendCard = h('div', { class: 'card' }, h('h3', {}, '月別の収支'),
      barChart(series, { label: `月別の収入と支出（直近${nTrend}か月）` }),
      h('div', { class: 'chart-legend' },
        h('span', {}, h('i', { class: 'sw income-sw' }), '収入'), h('span', {}, h('i', { class: 'sw expense-sw' }), '支出')),
      h('div', { class: 'summary' },
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, '収入'), h('strong', { class: 'income' }, yen(inc))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, '支出'), h('strong', { class: 'expense' }, yen(exp))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, '収支'), h('strong', { class: inc - exp >= 0 ? 'income' : 'expense' }, (inc - exp < 0 ? '−' : '') + yen(Math.abs(inc - exp))))));

    // --- 支出内訳（大カテゴリ → タップでサブへ） ---
    const expRows = d.by_category.filter((r) => r.type === 'expense');
    let catCard;
    if (!st.drill) {
      const sums = new Map();
      expRows.forEach((r) => sums.set(r.category_id, (sums.get(r.category_id) || 0) + r.amount));
      const rows = [...sums].map(([id, value]) => ({ id, value, label: `${S.catById(id)?.icon || ''} ${S.catById(id)?.name || '不明'}` })).sort((a, b) => b.value - a.value);
      catCard = donutCard('支出の内訳', rows, { centerLabel: '支出合計', onTap: (r) => { st.drill = r.id; reload(); } });
      catCard.append(h('p', { class: 'note' }, 'カテゴリをタップするとサブカテゴリの内訳が見られます'));
    } else {
      const top = S.catById(st.drill);
      const sums = new Map();
      expRows.filter((r) => r.category_id === st.drill).forEach((r) => sums.set(r.subcategory_id || '', (sums.get(r.subcategory_id || '') || 0) + r.amount));
      const rows = [...sums].map(([id, value]) => ({ id, value, label: id ? S.catById(id)?.name || '不明' : '（サブ未選択）' })).sort((a, b) => b.value - a.value);
      catCard = donutCard(`${top?.name || ''} の内訳`, rows, { centerLabel: 'このカテゴリ' });
      catCard.prepend(h('button', { type: 'button', class: 'btn small', onclick: () => { st.drill = ''; reload(); } }, '‹ カテゴリ一覧へ戻る'));
    }

    // --- タグ別ランキング（支出） ---
    const tagRows = d.by_tag.filter((r) => r.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
    const tmax = tagRows[0]?.amount || 1;
    const tagCard = h('div', { class: 'card' }, h('h3', {}, 'タグ別ランキング（支出）'),
      tagRows.length ? tagRows.map((r, i) => h('button', { type: 'button', class: 'rank-row', onclick: () => openTagDetail(r, d, months, rangeMonths) },
        h('span', { class: 'rank-no' }, i + 1),
        h('span', { class: 'rank-name' }, '#' + (S.tagById(r.tag_id)?.name || '不明')),
        h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: `width:${Math.max(4, Math.round((r.amount / tmax) * 100))}%` })),
        h('span', { class: 'bar-val' }, `${yen(r.amount)}（${r.count}件）`)))
        : h('p', { class: 'muted' }, 'タグを付けた支出がまだありません'),
      tagRows.length > 0 && h('p', { class: 'note' }, 'タグをタップすると月別の推移が見られます'));

    // --- 収入内訳 ---
    const incSums = new Map();
    d.by_category.filter((r) => r.type === 'income').forEach((r) => incSums.set(r.category_id, (incSums.get(r.category_id) || 0) + r.amount));
    const incRows = [...incSums].map(([id, value]) => ({ id, value, label: S.catById(id)?.name || '不明' })).sort((a, b) => b.value - a.value);
    const incCard = donutCard('収入の内訳', incRows, { centerLabel: '収入合計', empty: '収入の記録がありません' });

    // --- ユーザー別（複数ユーザーのときのみ） ---
    const users = S.getBoot().users || [];
    const userCard = users.length > 1 && (() => {
      const rows = users.map((u) => ({ label: u.name, value: d.by_user.filter((r) => r.type === 'expense' && r.user_id === u.id).reduce((a, r) => a + r.amount, 0) })).filter((r) => r.value > 0);
      return donutCard('支出：ユーザー別', rows, { centerLabel: '支出合計' });
    })();

    content.replaceChildren(trendCard, h('div', { class: 'grid2' }, catCard, incCard), tagCard, userCard || '');
  } catch (e) {
    content.replaceChildren(h('p', { class: 'msg' }, errText(e)));
  }
}

function openTagDetail(row, d, months, rangeMonths) {
  const name = S.tagById(row.tag_id)?.name || '不明';
  const byKey = new Map(d.by_tag_month.filter((r) => r.type === 'expense' && r.tag_id === row.tag_id).map((r) => [r.key, r.amount]));
  const data = rangeMonths.map((k) => ({ label: monthLabel(k), income: 0, expense: byKey.get(k) || 0 }));
  const close = openSheet(h('div', {},
    h('div', { class: 'sheet-head' }, h('h2', {}, `#${name} の月別支出`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕')),
    h('p', { class: 'muted' }, `累計 ${yen(row.amount)}（${row.count}件）`),
    barChart(data, { label: `#${name} の月別支出` }),
    h('ul', { class: 'legend' }, data.map((x) => h('li', {}, h('div', { class: 'legend-row' }, h('span', { class: 'legend-name' }, x.label), h('span', { class: 'legend-val' }, yen(x.expense))))))),
  { label: 'タグの月別支出' });
}
