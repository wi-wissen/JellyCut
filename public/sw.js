// Service worker. The build fills in BUILD_ID and PRECACHE (see vite.config.ts).
const BUILD_ID = '__BUILD_ID__'
const PRECACHE = __PRECACHE__
const CACHE_PREFIX = 'jellycut-'
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`
const SCOPE = new URL('./', self.location.href)
const MEDIA = /\.(mp4|webm|mov|m4v|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i

self.addEventListener('install', (event) => {
  // cache 'reload' bypasses the HTTP cache, so the precache holds exactly this build's files.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((path) => new Request(new URL(path, SCOPE), { cache: 'reload' })))
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Sent by the page when the user accepts the "Update available" toast.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Blob URLs, other origins, byte-range requests (media seeking) and media files are never cached.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  if (url.origin !== self.location.origin || request.headers.has('range') || MEDIA.test(url.pathname)) return
  if (!url.href.startsWith(SCOPE.href)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(url))
  } else if (url.pathname.startsWith(new URL('assets/', SCOPE).pathname)) {
    event.respondWith(cacheFirst(request, true))
  } else {
    event.respondWith(cacheFirst(request, false))
  }
})

// Vary: Origin from the host would make module scripts (crossorigin) miss the cache, so entries match by URL only.
async function cacheFirst(request, store) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request.url, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (store && response.ok) void cache.put(request.url, response.clone())
  return response
}

// Pages are stored without query string and with a trailing slash instead of index.html, so /app/ and /app/?demo=1 both hit.
function pageKey(url) {
  const key = new URL(url.pathname, url.origin)
  if (key.pathname.endsWith('/index.html')) key.pathname = key.pathname.slice(0, -'index.html'.length)
  return key.href
}

async function networkFirst(url) {
  const cache = await caches.open(CACHE)
  const key = pageKey(url)
  try {
    const response = await fetch(url.href)
    // A real 404 is shown as it is and never replaces a cached page.
    if (response.ok) void cache.put(key, response.clone())
    return response
  } catch {
    const cached = await cache.match(key, { ignoreVary: true })
    if (cached) return cached
    // Offline and not cached: the precached 404 page, still with status 404.
    const notFound = await cache.match(new URL('404.html', SCOPE).href, { ignoreVary: true })
    if (!notFound) return Response.error()
    return new Response(await notFound.blob(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}
