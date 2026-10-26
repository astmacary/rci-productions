// RCI Productions — service worker.
// Keeps a copy of the app so it opens offline and can be installed, but always
// asks the server for the newest version first, so updates show up right away.
// Schedule data and sign-in always go to Microsoft live; they are never cached.
const CACHE = "rci-productions-v92";
const SHELL = ["./", "index.html", "manifest.webmanifest", "push-config.js", "push-client.js",
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
    .then(keys => Promise.all(keys.filter(k => k.startsWith("rci-productions-") && k !== CACHE).map(k => caches.delete(k))))
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
    .catch(() => caches.match(cacheKey || request).then(hit => hit || (request.mode === "navigate" ? caches.match("index.html") : Response.error())));
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // The app itself: always newest first.
  if (e.request.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)){ e.respondWith(newestFirst(e.request, "index.html")); return; }
  // Everything else (manifest, icons, logos): also newest first, keyed without the ?v= part,
  // so a replaced file shows right away. The saved copy is only used offline.
  const key = new Request(url.origin + url.pathname);
  e.respondWith(newestFirst(e.request, key));
});


// A push must always show a visible notification, including malformed payloads.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  if (!data || typeof data !== "object") data = {};
  const scope = new URL(self.registration.scope);
  let target = scope.href;
  try {
    const url = new URL(typeof data.url === "string" ? data.url : "./", scope);
    if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) target = url.href;
  } catch (_) {}
  event.waitUntil(self.registration.showNotification(typeof data.title === "string" ? data.title : "RCI Team Update", {
    body: typeof data.body === "string" ? data.body : "Open the app to see your latest updates.",
    icon: new URL("icons/icon-192.png", scope).href,
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: target }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    let url = scope;
    try {
      const candidate = new URL(event.notification.data?.url || "./", scope);
      if (candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname)) url = candidate;
    } catch (_) {}
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === scope.origin && current.pathname.startsWith(scope.pathname)) {
        await client.navigate(url.href); await client.focus(); return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});

