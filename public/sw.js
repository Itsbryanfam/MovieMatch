// sw.js — conservative first service worker for a LIVE real-time site.
// WHY network-first (not cache-first): a stale cached app shell on a
// real-time game is far worse than a slightly slower load — deploys must be
// picked up immediately. The cache is purely an offline fallback. No
// skipWaiting(): never hot-swap JS/CSS under a player mid-game.
importScripts('/sw-routing.js');

// Versioned cache name — bump the suffix to force the activate handler to
// evict every prior cache (the only cache-invalidation lever this SW has).
var CACHE = 'mm-cache-v1';

self.addEventListener('install', function (e) {
  // Pre-cache only the shell so a cold offline open still renders something.
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(['/']); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  // Drop caches from older SW versions, then take control of open clients.
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var decision = self.swDecision({
    method: e.request.method,
    url: e.request.url,
    mode: e.request.mode,
    origin: self.location.origin,
  });
  if (decision === 'bypass') return; // untouched — hits the network normally
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        // Only cache genuinely-good responses. fetch() resolves (does not
        // reject) for 4xx/5xx; caching those under network-first would let a
        // transient server error poison the OFFLINE fallback for that asset
        // until the user is next online. res.ok (200–299) gates that out.
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        // Offline: serve the cached response, or the shell for navigations.
        return caches.match(e.request).then(function (cached) { return cached || caches.match('/'); });
      })
  );
});
