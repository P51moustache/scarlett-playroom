/* Cache only this playroom. Family entries remain encrypted on disk. */
const VERSION = '5619d078356ff8b4';
const ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = 'scarlett-playroom-' + encodeURIComponent(ROOT.pathname) + '-';
const CORE_CACHE = CACHE_PREFIX + 'core-' + VERSION;
const FAMILY_CACHE = CACHE_PREFIX + 'family-v1';
const CORE_FILES = ['index.html', 'icon.png', 'offline.js', 'fullscreen.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(CORE_FILES.map(path => new Request(new URL(path, ROOT), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX + 'core-') && name !== CORE_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function familyUrl(path) {
  const url = new URL(path, ROOT);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname + 'family/') || url.search || url.hash) {
    throw new Error('Invalid offline family file');
  }
  return url.href;
}

async function cachedOrFetch(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function freshFamilyFile(request) {
  const cache = await caches.open(FAMILY_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return await cache.match(request) || new Response('', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return;
  if (request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === ROOT.pathname + 'index.html')) {
    event.respondWith(cachedOrFetch(CORE_CACHE, new Request(new URL('index.html', ROOT))));
    return;
  }
  if (CORE_FILES.some(path => url.pathname === new URL(path, ROOT).pathname)) {
    event.respondWith(cachedOrFetch(CORE_CACHE, request));
    return;
  }
  if (url.pathname.startsWith(ROOT.pathname + 'family/') && !url.search) {
    const fresh = url.pathname.endsWith('/info.json') || url.pathname.endsWith('/family.bin');
    event.respondWith(fresh ? freshFamilyFile(request) : cachedOrFetch(FAMILY_CACHE, request));
  }
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SAVE_OFFLINE' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      const core = await caches.open(CORE_CACHE);
      for (const path of CORE_FILES) {
        if (!await core.match(new URL(path, ROOT))) throw new Error('Offline game files missing');
      }
      const urls = [...new Set((event.data.paths || []).map(familyUrl))];
      const family = await caches.open(FAMILY_CACHE);
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!await family.match(url)) {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Family file unavailable');
          await family.put(url, response);
        }
        port.postMessage({ saved: i + 1, total: urls.length });
      }
      port.postMessage({ done: true });
    } catch (error) {
      port.postMessage({ error: error.message });
    }
  })());
});
