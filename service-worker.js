/* OP-B Web edition — offline service worker.
 *
 * The whole app is static: index.html + the esbuild bundle + the offline Web MIDI capture.
 * Every asset is precached on install, then served cache-first with a background revalidate so a
 * redeploy is picked up on the next load. Navigations always fall back to the cached shell, which
 * is what makes the installed app work with the OP-Z unplugged / with no network.
 *
 * Bump CACHE_VERSION whenever dist/app.js or the precache list changes.
 * v6 = Stage 6 write editor (write toolbar in index.html + write layer inside dist/app.js).
 * v7 = Stage 7 BLE-MIDI transport + Gamepad navigation + Gaming Mode launcher. No new
 *      external static assets: everything is bundled into dist/app.js / shipped in tools/.
 * v8 = Stage 8.1 permission-aware boot + CONNECT OP-Z button. Chrome records a gesture-less
 *      SysEx request as a permanent per-origin "denied"; boot() now only auto-connects when
 *      the permission is already granted, otherwise it waits for the real user gesture.
 *      index.html and dist/app.js both changed, so the cache must be invalidated.
 */
const CACHE_VERSION = 'web-z-v0.1.2-tempo-bpm';
const CACHE_NAME = `${CACHE_VERSION}-static`;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icons/opb-192.png',
  './icons/opb-512.png',
  './icons/opb-512-maskable.png',
  './dist/app.js',
  './captures/demo.txt',
  './credits.html',
];

const scope = self.registration.scope;
const precacheUrls = PRECACHE.map((p) => new URL(p, scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll is atomic -> use allSettled so one optional asset cannot block the install.
    const results = await Promise.allSettled(
      precacheUrls.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
    );
    const missing = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (missing.length) console.warn('[opb-sw] not precached:', missing.join(', '));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('web-z-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const shell = new URL('./index.html', scope).href;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) await cache.put(shell, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(shell)) || (await cache.match(new URL('./', scope).href)) ||
          new Response('Offline and no cached shell available.', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    // One network request only; it both revalidates the cache and serves an uncached asset.
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') event.waitUntil(cache.put(req, res.clone()));
      return res;
    });
    if (cached) {
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    try {
      return await network;
    } catch {
      // Unknown asset while offline: nothing sensible to serve for JS/CSS.
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
