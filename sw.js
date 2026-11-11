// Offline support. Serves the cached copy at once and refreshes the cache in the
// background, so the app opens instantly on a weak signal and picks up an update on
// the next open. Bump CACHE when you want every device to drop its old copy.

const CACHE = 'rvu-tracker-v1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'js/app.js', 'js/calc.js', 'js/state.js',
  'data/rvu.json', 'manifest.webmanifest', 'icon.svg', 'icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});
