/* Offline support. Shell is cached on install; documents are cached as they are opened. */
const V = "lionsguide-20261119073531";
const SHELL = ["./", "index.html", "style.css", "app.js", "search.js", "config.js", "kb.js", "docindex.json", "bubble.js", "bubble.html", "roles.json", "library.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lionsguide-") && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  // network first so a new upload shows straight away; the cache is only the offline fallback
  e.respondWith(fetch(r, { cache: "no-cache" }).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ch => ch.put(r, c)); } return res; }).catch(() => caches.match(r)));
});
