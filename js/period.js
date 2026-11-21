// 期間計算の共通関数。将来「締め日（月の開始日）」を設定可能にするため、
// 月の区切りに関する計算は必ずここを経由する。startDay 既定=1（暦月）。

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** 'yyyy-MM-dd' を含む期間を返す。key は「開始日が属する年月」(yyyy-MM)。 */
export function getPeriod(dateStr, startDay = 1) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let py = y, pm = m;
  if (d < startDay) { pm -= 1; if (pm === 0) { pm = 12; py -= 1; } }
  const start = ymd(py, pm, startDay);
  let ny = py, nm = pm + 1;
  if (nm === 13) { nm = 1; ny += 1; }
  // 終了日 = 次期間開始日の前日
  const end = shiftDay(ymd(ny, nm, startDay), -1);
  return { key: `${py}-${pad(pm)}`, from: start, to: end };
}

/** key(yyyy-MM) から期間を返す */
export function periodOfKey(key, startDay = 1) {
  return getPeriod(`${key}-${pad(startDay)}`, startDay);
}

/** 期間を n か月ずらす */
export function shiftPeriod(key, n, startDay = 1) {
  let [y, m] = key.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return periodOfKey(`${y}-${pad(m)}`, startDay);
}

export function shiftDay(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function today() {
  const t = new Date();
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
