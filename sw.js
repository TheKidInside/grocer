// Offline support: serve the app shell from cache, refresh it in the background
// (stale-while-revalidate). Anthropic API calls are never cached.

const CACHE = 'larder-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './store.js', './ai.js', './ocr.js', './textprep.js', './barcode.js', './manifest.json', './icon.svg'];
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !CACHEABLE_HOSTS.includes(url.hostname)) return;

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: url.origin === self.location.origin });
    const network = fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
      .catch(() => cached);
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network.then((res) => res || Response.error());
  }));
});
