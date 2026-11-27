/* Service worker. It makes the page installable as an app and is where push notifications will be received.
   It does not cache anything: the screen must always show live data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only */ });
