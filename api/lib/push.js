// Push notifications to the installed apps (residents' screen app and the manager app).
// Each device that allowed notifications has one row: PartitionKey = screen id, RowKey = hash of its push address.
// No name or email is stored with it: a subscription is an anonymous device, not a resident.
const crypto = require('crypto');
const webpush = require('web-push');
const { assertScreen } = require('./announcements');
const Mail = require('./mail');

const MAX_DEVICES = 5000, CONCURRENCY = 25;
const fail = (message) => { const e = new Error(message); e.code = 'invalid'; return e; };
const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const publicKey = () => process.env.VAPID_PUBLIC_KEY || '';

// Only the real push services of Chrome/Android, Apple, Firefox and Edge/Windows. Anything else is refused,
// so nobody can make this server send requests to an address of their choosing.
const HOSTS = [/^fcm\.googleapis\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
function checkSubscription(sub) {
  let url; try { url = new URL(String(sub && sub.endpoint || '')); } catch (e) { throw fail('Invalid subscription'); }
  if (url.protocol !== 'https:' || url.port || url.username || !HOSTS.some((h) => h.test(url.hostname)) || url.href.length > 1000) throw fail('Invalid subscription');
  const k = (sub && sub.keys) || {}, b64 = /^[A-Za-z0-9_-]{16,200}=*$/;
  if (!b64.test(String(k.p256dh || '')) || !b64.test(String(k.auth || ''))) throw fail('Invalid subscription');
  return { endpoint: url.href, p256dh: String(k.p256dh), auth: String(k.auth) };
}
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);

async function subscribe(store, screen, sub, appName, now = Date.now()) {
  assertScreen(screen);
  const s = checkSubscription(sub), id = idOf(s.endpoint), rows = await store.pushList(screen);
  if (!rows.some((r) => r.id === id) && rows.length >= MAX_DEVICES) throw fail('Too many devices');
  await store.pushPut({ screen, id, ...s, app: appName === 'manager' ? 'manager' : 'resident', updatedAt: new Date(now).toISOString() });
  return { ok: true };
}
async function unsubscribe(store, screen, endpoint) {
  assertScreen(screen);
  await store.pushRemove(screen, idOf(String(endpoint || '')));
  return { ok: true };
}

// What the phone shows. Built from the same wording as the emails so both always say the same thing.
function compose(item, screen, br) {
  const m = Mail.compose(item, screen, br), urgent = item.kind === 'emergency' || item.kind === 'drill' || item.kind === 'notice';
  const body = (item.kind === 'emergency' ? [m.heading, 'In immediate danger, call 911.'] : m.lines.slice(0, 2)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return { title: m.subject.slice(0, 80), body, tag: item.group || item.id, url: '/', urgent, emergency: item.kind === 'emergency' };
}

// Send one notification to every device of the building. Devices whose subscription has ended are forgotten.
async function send(store, screen, item, opts = {}) {
  assertScreen(screen);
  if (!configured() && !opts.sender) return { sent: 0, devices: 0, reason: 'not_configured' };
  const rows = await store.pushList(screen);
  if (!rows.length) return { sent: 0, devices: 0 };
  const msg = compose(item, screen, opts.brand || await Mail.brand(store, screen)), payload = JSON.stringify(msg);
  const sender = opts.sender || ((row, body, options) => webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, options));
  const options = { TTL: msg.emergency ? 3600 : 86400, urgency: msg.urgent ? 'high' : 'normal', topic: undefined,
    vapidDetails: opts.sender ? undefined : { subject: process.env.VAPID_SUBJECT || 'mailto:support@ecsgapps.com', publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } };
  let sent = 0, gone = 0, failed = 0, next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      try { await sender(row, payload, options); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { gone++; await store.pushRemove(screen, row.id).catch(() => {}); } else failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { sent, devices: rows.length, gone, failed };
}

module.exports = { configured, publicKey, subscribe, unsubscribe, compose, send, checkSubscription, MAX_DEVICES };
