/* MIFASARW service worker (v3)
   - Push: the OneSignal worker is loaded here, so ONE worker does both push and offline (a scope can only have one worker).
   - Offline: pages + news data = network first (always fresh news, cache only when offline); css/js/images = stale-while-revalidate.
   - Install never fails because one file is missing (the old worker used /styles.css, but the site uses style.css, so addAll() failed).
   Change VERSION to force every phone to refresh its cache. */
try { importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); } catch (e) {}

const VERSION = "v8";
const SHELL = "mifasarw-shell-" + VERSION;
const RUNTIME = "mifasarw-runtime-" + VERSION;
const RUNTIME_MAX = 120;
const IMAGES = "mifasarw-images-" + VERSION, IMAGES_MAX = 250;
const SAVED = "mifasarw-saved";   // stories the person saved offline: never trimmed, never deleted by an update
const PRECACHE = ["/", "/index.html", "/story.html", "/404.html", "/style.css", "/script.js", "/manifest.json", "/offline.html", "/install.html", "/mifasa-app.js", "/mifasa-plus.js", "/mifasa-offline.js", "/mifasa-i18n.js", "/favicon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map(u => cache.add(new Request(u, { cache: "reload" }))));   // one missing file never breaks the install
    await self.skipWaiting();
  })());
});

self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL, RUNTIME, IMAGES, SAVED];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("mifasarw") && !keep.includes(n)).map(n => caches.delete(n)));   // removes the old "mifasarw-cache"
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
async function put(cacheName, req, res) {
  if (!res || res.status !== 200 || res.type === "opaque") return;
  const c = await caches.open(cacheName);
  await c.put(req, res.clone());
  if (cacheName === RUNTIME) trim(RUNTIME, RUNTIME_MAX);
}

/* network first: fresh when online, last copy when offline */
async function networkFirst(req, cacheName, fallbackUrl) {
  try {
    const res = await fetch(req, /\.(json|xml)$/i.test(new URL(req.url).pathname) ? { cache: "no-cache" } : undefined);   // json: skip the browser HTTP cache too
    put(cacheName, req, res);
    return res;
  } catch (e) {
    const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (fallbackUrl) { const fb = await caches.match(fallbackUrl); if (fb) return fb; }
    if (req.mode === "navigate") { const off = await caches.match("/offline.html"); if (off) return off; }
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

/* stale-while-revalidate: instant from cache, refreshed in the background */
async function staleWhileRevalidate(req, cacheName) {
  const cached = await caches.match(req);
  const net = fetch(req).then(res => { put(cacheName, req, res); return res; }).catch(() => null);
  return cached || (await net) || new Response("", { status: 504 });
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (req.destination === "image" && url.origin !== location.origin && /^https:/.test(url.protocol)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(async res => {
        if (res && (res.status === 200 || res.type === "opaque")) { const c = await caches.open(IMAGES); await c.put(req, res.clone()); trim(IMAGES, IMAGES_MAX); }
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  if (url.origin !== location.origin) return;                       // YouTube, fonts, OneSignal, news images: the browser handles them
  if (/OneSignal/i.test(url.pathname)) return;

  // pages (index, story.html?news=..., s/<id>.html): network first; offline -> the page, else the home page
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, RUNTIME, "/index.html"));
    return;
  }
  // news data: always try fresh first
  if (/\.(json|xml)$/i.test(url.pathname) || /^\/(news-archive|videos)\//.test(url.pathname)) {
    event.respondWith(networkFirst(req, RUNTIME));
    return;
  }
  // css / js / images / fonts of the site
  event.respondWith(staleWhileRevalidate(req, SHELL));
});
