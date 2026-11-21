// 端末内ストレージ(IndexedDB): ①オフライン時の未送信入力キュー ②マスタ(カテゴリ等)のキャッシュ。
// 合言葉/トークンは一切保存しない。未送信の入力内容(金額・備考・領収書画像)は、送信完了まで端末内に平文で残る。
import { call, ApiError } from './api.js';
import { activeProfile } from './store.js';

const DB_NAME = 'kakeibo-local';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('outbox', { keyPath: 'qid' });
      db.createObjectStore('cache', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    const r = fn(os);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ---------- キャッシュ ---------- */
export const cachePut = (key, value) => run('cache', 'readwrite', (s) => s.put({ key, value, at: Date.now() }));
export const cacheGet = (key) => run('cache', 'readonly', (s) => s.get(key)).then((r) => (r ? r.value : null));

/* ---------- 未送信キュー ---------- */
export async function enqueue(profileId, item) {
  const rec = { qid: crypto.randomUUID(), profileId, createdAt: Date.now(), failed: null, ...item };
  await run('outbox', 'readwrite', (s) => s.put(rec));
  return rec;
}
export async function pending(profileId) {
  const all = (await run('outbox', 'readonly', (s) => s.getAll())) || [];
  return all.filter((r) => r.profileId === profileId).sort((a, b) => a.createdAt - b.createdAt);
}
export const removeItem = (qid) => run('outbox', 'readwrite', (s) => s.delete(qid));
const putItem = (rec) => run('outbox', 'readwrite', (s) => s.put(rec));

let flushing = null;

/**
 * 未送信を古い順に送信。画像は先にアップロード → 取引登録（IDはクライアント発行なので再送しても二重登録されない）。
 * 通信不可なら中断して残す／入力エラー等の恒久的な失敗は failed を付けて残し、ユーザーが破棄できるようにする。
 */
export function syncOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const p = activeProfile();
    const res = { sent: 0, failed: 0, remaining: 0, offline: false };
    if (!p) return res;
    const items = (await pending(p.id)).filter((r) => !r.failed);
    for (const it of items) {
      try {
        const client = it.client || {};
        let payload = { ...it.payload, id: it.txId };
        if (it.image && !payload.receipt_file_id) {
          const up = await call('image.upload', { data_base64: it.image.replace(/^data:image\/jpeg;base64,/, '') }, client);
          payload = { ...payload, receipt_file_id: up.file_id, receipt_url: up.url };
          it.payload = { ...it.payload, receipt_file_id: up.file_id, receipt_url: up.url };
          it.image = null;            // アップロード済み。取引登録だけ失敗しても画像を二重に上げない
          await putItem(it);
        }
        await call('tx.create', payload, client);
        await removeItem(it.qid);
        res.sent++;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NETWORK') { res.offline = true; break; }
        if (e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.code === 'LOCKED' || e.code === 'LOCKED_OUT')) break;
        it.failed = (e && e.message) || 'error';
        await putItem(it);
        res.failed++;
      }
    }
    res.remaining = (await pending(p.id)).length;
    return res;
  })().finally(() => { flushing = null; });
  return flushing;
}
