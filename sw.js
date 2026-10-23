// RCI Productions — service worker.
// Caches the app's own files so it opens instantly and can be installed.
// Schedule data and sign-in always go to Microsoft live; they are never cached.
const CACHE = "rci-productions-v24";
const SHELL = ["./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon.png",
  "icons/wordmark.png", "icons/wordmark-dark.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Pages: try the network first so updates show up right away; fall back to the cached copy offline.
  if (e.request.mode === "navigate"){
    e.respondWith(fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // Icons and manifest: cache first.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
