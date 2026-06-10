// ═══════════════════════════════════════════════════
// THE WILD NORTH — Service Worker
// Caches OSM map tiles and app shell for offline use
// ═══════════════════════════════════════════════════

const TILE_CACHE   = 'wild-north-tiles-v1';
const SHELL_CACHE  = 'wild-north-shell-v1';
const SHELL_ASSETS = ['./', './index.html', './The_Wild_North.html'];

// ── Install: cache app shell ──────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // Best-effort — don't fail install if shell files aren't found
      return cache.addAll(SHELL_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== TILE_CACHE && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: serve tiles from cache, fallback to network ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // OSM tile requests — cache-first strategy
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;

          // Not in cache — fetch from network and store
          return fetch(e.request, { mode: 'cors' }).then(res => {
            if (res && res.status === 200) {
              cache.put(e.request, res.clone());
            }
            return res;
          }).catch(() => {
            // Offline and not cached — return transparent 1×1 PNG
            return new Response(
              atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
              { headers: { 'Content-Type': 'image/png' } }
            );
          });
        })
      )
    );
    return;
  }

  // Everything else — network-first, fall back to cache
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Message: handle preload requests from the app ──
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'PRELOAD_TILES') {
    preloadTiles(e.data.tiles, e.ports[0]);
  }
});

async function preloadTiles(urls, port) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = urls.length;

  // Batch in groups of 8 to avoid overwhelming the network
  const BATCH = 8;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async url => {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            const res = await fetch(url, { mode: 'cors' });
            if (res && res.status === 200) await cache.put(url, res);
          }
        } catch (_) {
          // Silently skip failed tiles
        }
        done++;
        if (port) port.postMessage({ done, total });
      })
    );
  }
  if (port) port.postMessage({ done: total, total, complete: true });
}
