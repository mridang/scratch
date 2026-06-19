// Kill-switch: this service worker now self-destructs.
// Earlier versions cached dead-host responses and broke the page; this one
// clears all caches and unregisters itself so the page always loads from network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
// Pass every request straight through to the network — no caching.
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
