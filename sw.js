// アプリシェルのキャッシュ。通信は network-first（更新を即反映）、失敗時のみキャッシュ。
// GAS への通信（別オリジンの POST）には一切介入しない＝データ/合言葉をキャッシュしない。
const CACHE = 'kakeibo-shell-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css', 'icons/icon.svg',
  'js/app.js', 'js/auth.js', 'js/api.js', 'js/store.js', 'js/period.js',
  'js/budget-calc.js', 'js/charts.js', 'js/budget.js', 'js/stats.js',
  'js/ui.js', 'js/state.js', 'js/keypad.js', 'js/image.js', 'js/entry.js', 'js/history.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
