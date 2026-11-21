// 予算の解決・使用率判定（DOM非依存の純粋関数）。
// 予算は「1か月あたりの金額」。解決順: 該当月(month) → 該当年(year) → 基本(default)。

/** 期間キー(yyyy-MM)に適用される予算。無ければ null。source: month|year|default */
export function resolveBudget(budgets, categoryId, periodKey) {
  const mine = budgets.filter((b) => b.category_id === categoryId);
  const year = periodKey.slice(0, 4);
  const pick = (type, key) => mine.find((b) => b.period_type === type && String(b.period_key) === key);
  const hit = pick('month', periodKey) || pick('year', year) || pick('default', '');
  if (!hit) return null;
  return { id: hit.id, amount: Number(hit.amount), source: hit.period_type };
}

/** 使用率の段階: none(予算なし) / ok / warn(80%以上) / over(100%超) */
export function level(used, budget) {
  if (!budget || !(budget > 0)) return 'none';
  const r = used / budget;
  if (r > 1) return 'over';
  if (r >= 0.8) return 'warn';
  return 'ok';
}

/** 使用率(0〜100に丸めたバー幅用) */
export function ratioPct(used, budget) {
  if (!budget || !(budget > 0)) return 0;
  return Math.min(100, Math.round((used / budget) * 100));
}

/** by_category(統計APIの支出行)から、大カテゴリ別・サブ別の使用額を集計 */
export function spentMaps(byCategory) {
  const top = new Map(), sub = new Map();
  byCategory.filter((r) => r.type === 'expense').forEach((r) => {
    top.set(r.category_id, (top.get(r.category_id) || 0) + r.amount);
    if (r.subcategory_id) sub.set(r.subcategory_id, (sub.get(r.subcategory_id) || 0) + r.amount);
  });
  return { top, sub };
}

/** 予算超過・上限間近の大カテゴリ一覧（サブカテゴリ単位のアラートは出さない） */
export function alerts(topCats, budgets, spentTop, periodKey) {
  const out = [];
  topCats.forEach((c) => {
    const b = resolveBudget(budgets, c.id, periodKey);
    if (!b) return;
    const used = spentTop.get(c.id) || 0;
    const lv = level(used, b.amount);
    if (lv === 'over' || lv === 'warn') out.push({ category: c, used, budget: b.amount, level: lv });
  });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'over' ? -1 : 1));
}
