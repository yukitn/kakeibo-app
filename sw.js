// アプリシェルのキャッシュ（キャッシュ優先・起動が速い）。
// - 新バージョンは install 時に全ファイルを「ネットワークから取り直して(reload)」一式まとめて保存し、揃ってから切り替える
//   （ファイルの新旧が混ざらない）。更新を配るときは、必ず CACHE 名を変えること。
// - GAS への通信（別オリジンの POST）には一切介入しない＝データ/合言葉をキャッシュしない。
const CACHE = 'kakeibo-shell-v11';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/api.js', 'js/asset-calc.js', 'js/assets.js', 'js/auth.js', 'js/budget-calc.js', 'js/budget.js',
  'js/charts.js', 'js/csv.js', 'js/entry.js', 'js/goals.js', 'js/history.js', 'js/image.js', 'js/keypad.js',
  'js/memo.js', 'js/period.js', 'js/queue.js', 'js/state.js', 'js/stats.js', 'js/store.js', 'js/ui.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const url = new URL(path, self.registration.scope);
      const res = await fetch(new Request(url, { cache: 'reload' }));   // HTTPキャッシュを使わず最新を取得
      if (!res.ok) throw new Error('precache failed: ' + path);          // 1つでも欠けたら新版をインストールしない
      await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });   // ?v=… や ?new=1 が付いていても同じファイル
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return (await caches.match(new URL('index.html', self.registration.scope))) || Response.error(); }
  })());
});
