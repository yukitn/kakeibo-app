// アプリ共有状態（bootstrap マスタ）。ロック時に破棄する。
// 通信できないときは、端末内にキャッシュした直近のマスタで入力・閲覧を続けられる（オフライン）。
import { load, activeProfile } from './store.js';
import { call } from './api.js';
import { cachePut, cacheGet } from './queue.js';

let boot = null;
let offline = false;

let gen = 0;   // ロックのたびに増やし、古い応答が解除後/ロック中に反映されないようにする
export function resetBoot() { boot = null; offline = false; gen++; }
export function getBoot() { return boot; }
export function isOffline() { return offline; }

let refreshing = null;

async function fetchBoot(key) {
  const g = gen;
  try {
    const fresh = await call('bootstrap', {}, { user_id: currentUserId() });
    if (g !== gen) return boot;          // 取得中にロックされた: 反映しない
    boot = fresh;
    offline = false;
    if (key) cachePut(key, fresh).catch(() => {});
    return boot;
  } catch (e) {
    if (e && e.code === 'NETWORK') offline = true;
    throw e;
  }
}

/**
 * マスタ(カテゴリ・支払い方法・タグ等)を返す。端末内に前回の分があればそれを即座に返し、裏で最新化する
 * （通信待ちなしで画面を出すため）。前回分が無い初回だけ通信を待つ。
 */
export async function ensureBoot(force = false) {
  if (boot && !force) return boot;
  const p = activeProfile();
  const key = p ? 'boot:' + p.id : null;
  if (key && !force) {
    const cached = await cacheGet(key).catch(() => null);
    if (cached) {
      boot = cached;
      if (!refreshing) refreshing = fetchBoot(key).catch(() => {}).finally(() => { refreshing = null; });
      return boot;
    }
  }
  return fetchBoot(key);
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
