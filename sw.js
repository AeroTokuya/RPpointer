// RPpointer Service Worker — オフライン対応
// - アプリ本体 + CDNライブラリ（Leaflet / JSZip / Google Fonts）をプリキャッシュ
// - 国土地理院タイルは「表示したものをキャッシュ→次回はキャッシュ優先＋裏で更新」
//   （一度表示した範囲はオフラインでも地図が出る）
const VERSION = 'rppointer-v1';
const APP_CACHE = 'app-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const TILE_LIMIT = 6000; // タイルキャッシュ上限（超過分は古いものから削除）

const APP_ASSETS = [
  './',
  './index.html',
  './vendor/jszip.min.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(c => c.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > limit) {
    await Promise.all(keys.slice(0, keys.length - limit).map(k => cache.delete(k)));
  }
}

function cacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // OpenAIP APIはキャッシュしない（空域データは常に最新を取得）
  if (url.hostname.endsWith('openaip.net')) return;

  // 地図タイル: キャッシュ優先＋裏でネットワーク更新（stale-while-revalidate）
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req).then(res => {
        if (cacheable(res)) {
          cache.put(req, res.clone()).then(() => trimCache(TILE_CACHE, TILE_LIMIT));
        }
        return res;
      }).catch(() => null);
      if (hit) {
        e.waitUntil(network); // 裏で最新化
        return hit;
      }
      return (await network) || new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }

  // ページ遷移: ネットワーク優先（更新を反映）→ オフライン時はキャッシュ
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(APP_CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(async () =>
        (await caches.match(req)) || (await caches.match('./index.html'))
      )
    );
    return;
  }

  // その他（CDNライブラリ・フォント等）: キャッシュ優先、無ければ取得してキャッシュ
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (cacheable(res)) {
        const copy = res.clone();
        caches.open(APP_CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
