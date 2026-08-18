/*
 * Disposable capability probe for Ruutin.
 *
 * Deliberately no fetch handler and no Cache Storage calls: authenticated HTML,
 * private API responses, TAC/pairing responses, and mutations always use the
 * browser's normal network path.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
