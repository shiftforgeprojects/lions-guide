/* Cleanup worker. This guide no longer caches itself: every visit loads the latest files.
   If an older version left a cached copy on this device, this removes it and reloads the page. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (x) {}
    try { await self.registration.unregister(); } catch (x) {}
    try { for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url); } catch (x) {}
  })());
});
