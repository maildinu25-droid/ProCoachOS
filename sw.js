// ProCoach OS service worker.
//
// Purpose: let the app's own shells load when there's genuinely no network
// connection — e.g. mid-session at a ground with no signal. This covers the
// main app plus the three Analysis Tools (Pitch Map, Batting Map, Live
// Session), since a coach is just as likely, maybe more likely, to open one
// of those specifically during a session with patchy signal. Each of these
// already works offline once loaded (local data, no live dependency) — this
// only solves "can the page itself load in the first place."
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

const CACHE_VERSION = "procoachos-v2";

// Every real, installable shell this service worker covers. Each entry's
// filename is also what the fetch handler matches request URLs against, and
// what a failed shell falls back to caching-wise — matched to its OWN
// cached copy, never a different tool's shell.
const SHELL_FILES = ["app.html", "pitchmap.html", "battingmap.html", "livesession.html"];

const PRECACHE_URLS = [
  ...SHELL_FILES.map((f) => `./${f}`),
  // app.html's font stack
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap",
  // the Analysis Tools' shared font stack
  "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Best-effort — a font or a page itself failing to precache shouldn't
      // block installation; the fetch handler still falls back to whatever's
      // genuinely available at request time.
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

  // Only handle GET requests for our own shells and the font assets they
  // need — never intercept anything else (the booking Worker's API calls,
  // the QR code image, etc.), so those always behave exactly as if no
  // service worker were present at all.
  if (req.method !== "GET") return;
  const matchedShell = SHELL_FILES.find((f) => req.url.includes(`/${f}`));
  const isFontAsset = req.url.startsWith("https://fonts.googleapis.com") || req.url.startsWith("https://fonts.gstatic.com");
  if (!matchedShell && !isFontAsset) return;

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
        // Network genuinely failed — fall back to whatever's cached. For a
        // shell page specifically, fall back to THAT SAME shell's own plain
        // entry even if this exact URL (with its own cache-busting query
        // string, if the refresh button was used) was never itself cached —
        // never a different tool's shell.
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          if (matchedShell) return caches.match(`./${matchedShell}`);
          return undefined;
        });
      })
  );
});
