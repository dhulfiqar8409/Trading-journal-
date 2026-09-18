/*
 * Darkpools service worker: caches the app shell for instant opens and shows /offline
 * without a connection. Pages are never cached (they belong to whoever is signed in);
 * see sw-policy.js for the caching decision. Bump VERSION to drop every old cache.
 */
importScripts("/sw-policy.js");

const VERSION = "dp-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL = ["/offline", "/icon.svg", "/manifest.webmanifest", "/icons/icon-192.png", "/sw-policy.js"];
const { shouldCache } = self.swPolicy;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

// A new version drops every cache of the previous one, the runtime cache included.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app posts { type: "logout" } when signing out; nothing from the session survives it.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "logout") {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});

function describe(request, response) {
  return {
    ok: response.ok,
    redirected: response.redirected,
    type: response.type,
    cacheControl: response.headers.get("cache-control"),
    mode: request.mode,
    pathname: new URL(request.url).pathname,
  };
}

function store(request, response) {
  if (shouldCache(describe(request, response))) {
    const copy = response.clone();
    caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/share-target") return;

  // Hashed build assets and icons never change: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => store(request, response))));
    return;
  }

  // Pages: always from the network; without a connection, the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => store(request, response))
        .catch(async () => (await caches.match("/offline")) || Response.error()),
    );
  }
});
