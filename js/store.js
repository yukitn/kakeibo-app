// 端末ローカル設定（localStorage）。合言葉/トークン本体は絶対に保存しない（ハッシュのみ）。
const KEY = 'kakeibo.v1';

const DEFAULTS = {
  profiles: [],          // [{id, name, url, salt, hash, iter}]
  activeId: null,
  lockMinutes: 5,
  defaultUserId: {},     // {profileId: userId} 端末ごとの既定ユーザー
  authMode: 'unified'    // 'unified' | 'dual'（dual は将来拡張）
};

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* 保存不可環境では黙って継続 */ }
}

export function activeProfile() {
  const s = load();
  return s.profiles.find((p) => p.id === s.activeId) || null;
}
