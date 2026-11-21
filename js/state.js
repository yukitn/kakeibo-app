// アプリ共有状態（bootstrap マスタ）。ロック時に破棄する。
// 通信できないときは、端末内にキャッシュした直近のマスタで入力・閲覧を続けられる（オフライン）。
import { load, activeProfile } from './store.js';
import { call } from './api.js';
import { cachePut, cacheGet } from './queue.js';

let boot = null;
let offline = false;

export function resetBoot() { boot = null; offline = false; }
export function getBoot() { return boot; }
export function isOffline() { return offline; }

export async function ensureBoot(force = false) {
  if (boot && !force) return boot;
  const p = activeProfile();
  try {
    boot = await call('bootstrap', {}, { user_id: currentUserId() });
    offline = false;
    if (p) cachePut('boot:' + p.id, boot).catch(() => {});
    return boot;
  } catch (e) {
    if (e && e.code === 'NETWORK' && p) {
      const cached = await cacheGet('boot:' + p.id).catch(() => null);
      if (cached) { boot = cached; offline = true; return boot; }
    }
    throw e;
  }
}

export function currentUserId() {
  const s = load();
  return s.defaultUserId[s.activeId] || boot?.users?.[0]?.id || '';
}

export function startDay() {
  return Number(boot?.settings?.month_start_day) || 1;
}

const bySort = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0);
const active = (x) => x.is_active !== false && x.is_active !== 'FALSE';

/** 大カテゴリ一覧（kind: expense|income） */
export function topCategories(kind) {
  return (boot?.categories || []).filter((c) => !c.parent_id && c.kind === kind && active(c)).sort(bySort);
}
export function subCategories(parentId) {
  return (boot?.categories || []).filter((c) => c.parent_id === parentId && active(c)).sort(bySort);
}
export function accounts() { return (boot?.accounts || []).filter(active).sort(bySort); }
export function tags() { return (boot?.tags || []).filter(active).sort(bySort); }

export function catById(id) { return (boot?.categories || []).find((c) => c.id === id) || null; }
export function accById(id) { return (boot?.accounts || []).find((a) => a.id === id) || null; }
export function tagById(id) { return (boot?.tags || []).find((t) => t.id === id) || null; }
