// GAS Web アプリとの通信。Content-Type: text/plain で CORS プリフライトを回避。
import { activeProfile } from './store.js';
import { getToken, lock } from './auth.js';

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const TIMEOUT_MS = 30000;

async function post(url, token, action, payload, client) {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
    throw new ApiError('INVALID_URL', 'GAS の Web アプリ URL（https://script.google.com/...）を入力してください');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, payload: payload || {}, client: client || {} }),
      signal: ctrl.signal,
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError('NETWORK', e.name === 'AbortError' ? '通信がタイムアウトしました' : '通信できません。接続とURLを確認してください');
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await res.json(); } catch { throw new ApiError('BAD_RESPONSE', 'GASから想定外の応答です（URL・公開設定を確認）'); }
  if (!body.ok) throw new ApiError(body.error, body.message);
  return body.data;
}

/** 登録済みプロファイルで呼び出す（トークンはメモリから） */
export async function call(action, payload, client) {
  const p = activeProfile();
  const token = getToken();
  if (!p || !token) throw new ApiError('LOCKED', 'ロックされています');
  try {
    return await post(p.url, token, action, payload, client);
  } catch (e) {
    // GAS 側の合言葉が変更された等 → 再入力のためロック
    if (e.code === 'UNAUTHORIZED') lock();
    throw e;
  }
}

/** セットアップ/合言葉更新時: プロファイル未保存の状態で URL+合言葉を検証 */
export function callWith(url, token, action, payload, client) {
  return post(url, token, action, payload, client);
}
