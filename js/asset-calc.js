// 資産・目標の計算（DOM非依存の純粋関数）。資産は収支と連動せず、残高の記録(スナップショット)だけで推移を作る。

export const ASSET_KINDS = {
  bank: { label: '銀行', icon: '🏦' },
  securities: { label: '証券', icon: '📈' },
  investment: { label: '投資', icon: '💹' },
  cash: { label: '現金', icon: '💴' },
  other: { label: 'その他', icon: '📦' }
};

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** 口座ごとの最新残高 Map(accountId -> {balance, date}) */
export function latestBalances(snapshots) {
  const m = new Map();
  [...snapshots].sort(byDate).forEach((s) => m.set(s.asset_account_id, { balance: Number(s.balance), date: s.date, id: s.id }));
  return m;
}

/**
 * 総資産の推移。記録のある日付ごとに、各口座の「その日までの最新残高」を合算（記録が無い口座は直前値を引き継ぐ）。
 * accountIds を渡すと、その口座(非表示にしていない口座)だけを集計する。
 */
export function totalsByDate(snapshots, accountIds = null) {
  const allow = accountIds ? new Set(accountIds) : null;
  const rows = snapshots.filter((s) => !allow || allow.has(s.asset_account_id)).sort(byDate);
  const dates = [...new Set(rows.map((s) => s.date))];
  const cur = new Map();
  let i = 0;
  return dates.map((date) => {
    while (i < rows.length && rows[i].date <= date) { cur.set(rows[i].asset_account_id, Number(rows[i].balance)); i++; }
    let total = 0;
    cur.forEach((v) => { total += v; });
    return { date, total };
  });
}

/** 'yyyy-MM-dd' の n か月前 */
export function monthsAgo(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const pad = (x) => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** 範囲絞り込み。months=0 は全期間。範囲の直前の値を先頭に補い、折れ線が途中から始まらないようにする */
export function clipRange(points, today, months) {
  if (!months) return points;
  const from = monthsAgo(today, months);
  const inside = points.filter((p) => p.date >= from);
  const before = points.filter((p) => p.date < from).pop();
  return before ? [{ ...before, date: from }, ...inside] : inside;
}

/** 資産構成比: プラス残高のみ円グラフ対象。マイナス(負債)は別に返す */
export function composition(accounts, latest) {
  const pos = [], neg = [];
  accounts.forEach((a) => {
    const l = latest.get(a.id);
    if (!l || l.balance === 0) return;
    (l.balance > 0 ? pos : neg).push({ account: a, value: Math.abs(l.balance), balance: l.balance });
  });
  pos.sort((x, y) => y.value - x.value);
  return { pos, neg };
}

/** 日付 → 通算日数(線グラフのX軸用) */
export function toDays(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/* ---------- 目標 ---------- */

export function goalPct(current, target) {
  if (!(target > 0)) return 0;
  return Math.max(0, Math.round((current / target) * 100));
}

/** 期限までの残り月数(切り上げ)。期限なし→null、期限切れ→0 */
export function monthsLeft(deadline, today) {
  if (!deadline) return null;
  if (deadline <= today) return 0;
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = deadline.split('-').map(Number);
  let n = (y2 - y1) * 12 + (m2 - m1);
  if (d2 > d1) n += 1;
  return Math.max(1, n);
}

/** 期限までに毎月いくら積み立てれば届くか。達成済み/期限なし/期限切れは null */
export function monthlyNeeded(current, target, deadline, today) {
  const left = monthsLeft(deadline, today);
  const remain = target - current;
  if (left === null || left === 0 || remain <= 0) return null;
  return Math.ceil(remain / left);
}
