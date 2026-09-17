// ProCoach OS service worker.
//
// Purpose: let the app's own shell (app.html) load when there's genuinely no
// network connection — e.g. mid-session at a ground with no signal — since
// everything else (players, sessions, assessments) already works offline via
// IndexedDB. This only needs to solve "can the page itself load," nothing more.
//
// Strategy: network-first, cache as fallback only. Every load with a real
// connection always fetches the current file fresh from the server; the
// cached copy is only ever used when the network request genuinely fails.
// This is the opposite of cache-first on purpose — cache-first would be
// faster, but risks silently serving a stale version indefinitely, which is
// exactly the staleness problem the app's own in-app refresh button exists
// to fix. A service worker cache doesn't expire on its own the way a normal
// browser HTTP cache does, so getting this direction right matters.
//
// Versioning: CACHE_VERSION is bumped on meaningful releases. On activation,
// any cache from an older version is deleted automatically, so an update
// doesn't leave a stale cache lingering for someone who hasn't opened the
// app in a while.

const CACHE_VERSION = "procoachos-v1";
const PRECACHE_URLS = [
  "./app.html",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Best-effort — a font or the page itself failing to precache
      // shouldn't block installation; the fetch handler still falls back
      // to whatever's genuinely available at request time.
      return Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests for our own app shell and the font assets it
  // needs — never intercept anything else (the booking Worker's API calls,
  // the QR code image, etc.), so those always behave exactly as if no
  // service worker were present at all.
  if (req.method !== "GET") return;
  const isAppShell = req.url.includes("/app.html");
  const isFontAsset = req.url.startsWith("https://fonts.googleapis.com") || req.url.startsWith("https://fonts.gstatic.com");
  if (!isAppShell && !isFontAsset) return;

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Network succeeded — this is always the current, correct version,
        // so use it, and refresh the cache with this latest copy for next
        // time the network genuinely isn't available.
        const copy = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return networkResponse;
      })
      .catch(() => {
        // Network genuinely failed — fall back to whatever's cached. For
        // the app shell specifically, fall back to the plain app.html entry
        // even if this exact URL (with its own cache-busting query string,
        // if the refresh button was used) was never itself cached.
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          if (isAppShell) return caches.match("./app.html");
          return undefined;
        });
      })
  );
});
