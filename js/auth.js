// 認証モジュール（初期モード: unified = 1つの合言葉でロック解除とGAS認証を兼用）
// 呼び出し側は getToken()/unlock()/lock() だけに依存する。将来 'dual'（端末内PIN＋暗号化保存のGASトークン）
// に拡張する際は、このファイル内だけを差し替える。
//
// - 端末には PBKDF2 ハッシュ(ソルト付き)のみ保存。合言葉本体=トークンはメモリ上のみ。

import { load, save } from './store.js';

export const MIN_LENGTH = 8;
const ITER = 200000;
const enc = new TextEncoder();

let token = null;           // メモリのみ
let lockListeners = [];
let armIdle = null;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pass, saltB64, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, key, 256);
  return b64(bits);
}

export function validatePassphrase(pass) {
  if (typeof pass !== 'string' || pass.length < MIN_LENGTH) return `合言葉は${MIN_LENGTH}文字以上にしてください`;
  return null;
}

/** 新しい合言葉の検証用ハッシュを作る（プロファイルに保存する値） */
export async function makeVerifier(pass) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: ITER, hash: await derive(pass, salt, ITER) };
}

/** ロック解除。成功時のみトークンをメモリへ保持 */
export async function unlock(profile, pass) {
  if (typeof pass !== 'string' || !pass) return false;
  const h = await derive(pass, profile.salt, profile.iter);
  if (h !== profile.hash) return false;
  setToken(pass);
  return true;
}

/** セットアップ直後など、検証済みの合言葉をそのままメモリへ（自動ロックのタイマーも開始） */
export function setToken(pass) { token = pass; if (armIdle) armIdle(); }

export function getToken() { return token; }
export function isUnlocked() { return token !== null; }

export function lock() {
  token = null;
  lockListeners.forEach((fn) => fn());
}

export function onLock(fn) { lockListeners.push(fn); }

/** 無操作/バックグラウンド滞在による自動ロック */
export function startIdleLock() {
  let timer = null;
  let hiddenAt = null;
  const limit = () => Math.max(1, Number(load().lockMinutes) || 5) * 60 * 1000;
  const arm = () => {
    clearTimeout(timer);
    if (isUnlocked()) timer = setTimeout(lock, limit());
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, arm, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && isUnlocked() && Date.now() - hiddenAt > limit()) lock();
    hiddenAt = null;
    arm();
  });
  armIdle = arm;
}

export { save };
