/* Service worker. It makes the page installable as an app and receives push notifications.
   It does not cache anything: the screen must always show live data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only */ });

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 120) : 'Message from your building';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === 'string' ? d.body.slice(0, 300) : '',
    tag: typeof d.tag === 'string' ? d.tag.slice(0, 60) : undefined,
    renotify: !!d.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    requireInteraction: d.emergency === true,
    data: { url: '/' }
  }));
});
// Tapping the notification opens the app (or brings it to the front). Only this site's own pages are ever opened.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow('/');
  })());
});
