// RCI Productions — service worker.
// Keeps a copy of the app so it opens offline and can be installed, but always
// asks the server for the newest version first, so updates show up right away.
// Schedule data and sign-in always go to Microsoft live; they are never cached.
const CACHE = "rci-productions-v32";
const SHELL = ["./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon.png",
  "icons/wordmark.png", "icons/wordmark-dark.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Ask the server for the newest copy, skipping the browser's own short-term cache
// (GitHub Pages lets browsers reuse a page for 10 minutes). Offline, use the saved copy.
function newestFirst(request, cacheKey){
  return fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
    .then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(cacheKey || request, copy)); }
      return res;
    })
    .catch(() => caches.match(cacheKey || request).then(hit => hit || caches.match("index.html")));
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // The app itself: always newest first.
  if (e.request.mode === "navigate"){ e.respondWith(newestFirst(e.request, "index.html")); return; }
  if (/\/(index\.html)?$/.test(url.pathname)){ e.respondWith(newestFirst(e.request, "index.html")); return; }
  if (url.pathname.endsWith("manifest.webmanifest")){ e.respondWith(newestFirst(e.request, "manifest.webmanifest")); return; }
  // Icons and logos: saved copy first (they rarely change; a new CACHE version refreshes them).
  // (Image addresses carry the app version, e.g. wordmark.png?v=27, so a new logo is never mistaken for the old one.)
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
