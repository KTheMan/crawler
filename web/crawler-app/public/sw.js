const CACHE_VERSION = "crawler-alpha-v2";
const scopeUrl = new URL(self.registration.scope);
const scopedUrl = (path) => new URL(path, scopeUrl).toString();
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg"].map(scopedUrl);

self.addEventListener("install", (event) => {
  // No skipWaiting: an update never replaces a running design session.
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("crawler-alpha-") && key !== CACHE_VERSION).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await (await caches.open(CACHE_VERSION)).put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === "navigate") return (await caches.match(scopedUrl("index.html"))) ?? Response.error();
      throw error;
    }
  })());
});
