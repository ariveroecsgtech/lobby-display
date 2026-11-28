/* Service worker. It makes the page installable as an app and receives push notifications.
   It does not cache anything: the screen must always show live data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only */ });

// The last few messages are kept on the device, so the app can show the one that was tapped (and the earlier ones)
// however it is opened: from the notification, or later from its icon.
const INBOX = 'lobby-inbox', INBOX_KEY = '/__inbox';
async function inboxAdd(msg) {
  try {
    const c = await caches.open(INBOX), r = await c.match(INBOX_KEY); let list = [];
    try { list = r ? await r.json() : []; } catch (e) { list = []; }
    list = [msg].concat(Array.isArray(list) ? list : []).slice(0, 10);
    await c.put(INBOX_KEY, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* storage unavailable: the notification itself still shows */ }
}
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 120) : 'Message from your building';
  const body = typeof d.body === 'string' ? d.body.slice(0, 300) : '';
  const msg = { t: title, b: body, e: d.emergency === true, ts: Date.now(), m: d.url === '/manage/' };
  event.waitUntil(Promise.all([inboxAdd(msg), self.registration.showNotification(title, {
    body,
    tag: typeof d.tag === 'string' ? d.tag.slice(0, 60) : undefined,
    renotify: !!d.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    requireInteraction: d.emergency === true,
    data: { manager: msg.m, msg }
  })]));
});
// Tapping the notification opens the app (or brings it to the front) on the message itself.
// Only this site's own two pages are ever opened.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {}, path = d.manager ? '/manage/' : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isManager = (c) => new URL(c.url).pathname.startsWith('/manage');
    const open = all.find((c) => new URL(c.url).origin === self.location.origin && isManager(c) === !!d.manager);
    if (open) { open.postMessage({ type: 'lobby-msg', msg: d.msg }); return open.focus(); }
    return self.clients.openWindow(path + '#msg=' + encodeURIComponent(JSON.stringify(d.msg || {})));
  })());
});
