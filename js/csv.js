// CSV 書き出し（純粋関数）。Excel/Numbers で文字化けしないよう BOM 付き UTF-8、数式として解釈されないよう先頭記号を無害化する。

/** セル値 → CSV 文字列。文字列の先頭が = + - @ タブ/CR のときは ' を付与（数式インジェクション対策）。数値はそのまま */
export function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** data.export の結果 → 収支CSVの行（名前を解決して人が読める形に） */
export function transactionsCsv(data) {
  const cats = new Map(data.Categories.map((c) => [c.id, c.name]));
  const accs = new Map(data.Accounts.map((a) => [a.id, a.name]));
  const tags = new Map(data.Tags.map((t) => [t.id, t.name]));
  const users = new Map(data.Users.map((u) => [u.id, u.name]));
  const header = ['日付', '収支', '金額', 'カテゴリ', 'サブカテゴリ', '支払い方法/入金先', 'タグ', '備考', '入力者', '領収書URL'];
  const rows = [...data.Transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((t) => [
    t.date, t.type === 'income' ? '収入' : '支出', Number(t.amount),
    cats.get(t.category_id) || '', cats.get(t.subcategory_id) || '', accs.get(t.account_id) || '',
    String(t.tags || '').split(';').filter(Boolean).map((id) => tags.get(id) || '').filter(Boolean).join(' / '),
    t.memo || '', users.get(t.user_id) || '', t.receipt_url || ''
  ]);
  return toCsv(header, rows);
}

/** 資産残高の履歴CSV */
export function assetsCsv(data) {
  const accs = new Map(data.AssetAccounts.map((a) => [a.id, a.name]));
  const rows = [...data.AssetSnapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((s) => [s.date, accs.get(s.asset_account_id) || '', Number(s.balance), s.note || '']);
  return toCsv(['日付', '口座', '残高', 'メモ'], rows);
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
