const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "unversioned";
const CACHE_VERSION = `crawler-alpha-${BUILD_ID}`;
const scopeUrl = new URL(self.registration.scope);
const scopedUrl = (path) => new URL(path, scopeUrl).toString();
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg"].map(scopedUrl);

self.addEventListener("install", (event) => {
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
    const cache = await caches.open(CACHE_VERSION);
    const requestUrl = new URL(event.request.url);
    const immutableAsset = requestUrl.pathname.includes("/assets/");
    if (immutableAsset) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: event.request.mode === "navigate" });
      if (cached) return cached;
      if (event.request.mode === "navigate") return (await cache.match(scopedUrl("index.html"))) ?? Response.error();
      throw error;
    }
  })());
});
