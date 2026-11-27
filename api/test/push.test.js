const assert = require('assert');
const P = require('../lib/push');

function mem() {
  const rows = new Map(), k = (s, i) => s + '|' + i;
  return { rows,
    async list() { return []; },
    async pushList(screen) { return [...rows.values()].filter((r) => r.screen === screen); },
    async pushPut(r) { rows.set(k(r.screen, r.id), { ...r }); },
    async pushRemove(screen, id) { rows.delete(k(screen, id)); } };
}
const sub = (n, host = 'fcm.googleapis.com') => ({ endpoint: 'https://' + host + '/fcm/send/device' + n, keys: { p256dh: 'B' + 'a'.repeat(86), auth: 'c'.repeat(22) } });

(async () => {
  const s = mem(), now = Date.parse('2026-12-01T15:00:00Z');
  // Only real push services are accepted; nothing personal is stored.
  for (const bad of [{}, { endpoint: 'http://fcm.googleapis.com/x', keys: sub(1).keys }, { endpoint: 'https://evil.example/x', keys: sub(1).keys }, { endpoint: 'https://fcm.googleapis.com.evil.example/x', keys: sub(1).keys },
    { endpoint: 'https://fcm.googleapis.com:8443/x', keys: sub(1).keys }, { endpoint: 'https://169.254.169.254/x', keys: sub(1).keys }, { endpoint: sub(1).endpoint, keys: { p256dh: 'x', auth: 'y' } }])
    await assert.rejects(() => P.subscribe(s, 'confluence', bad, 'resident', now), /Invalid subscription/);
  await assert.rejects(() => P.subscribe(s, 'nowhere', sub(1), 'resident', now), (e) => e.code === 'unknown_screen');
  await P.subscribe(s, 'confluence', sub(1), 'resident', now);
  await P.subscribe(s, 'confluence', sub(1), 'resident', now);                 // same device again: still one row
  await P.subscribe(s, 'confluence', sub(2, 'web.push.apple.com'), 'manager', now);
  await P.subscribe(s, 'confluence', sub(3, 'wns2-by3p.notify.windows.com'), 'whatever', now);
  const rows = await s.pushList('confluence');
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map((r) => r.app).sort(), ['manager', 'resident', 'resident']);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['app', 'auth', 'endpoint', 'id', 'p256dh', 'screen', 'updatedAt']);

  // What the phone shows.
  const ends = '2026-12-01T22:00:00Z';
  const n = P.compose({ id: 'n1', kind: 'notice', title: 'Water shut-off', text: 'Floors 3 to 5.', endsAt: ends }, 'confluence');
  assert.deepStrictEqual([n.title, n.urgent, n.emergency, n.url, n.tag], ['Confluence notice: Water shut-off', true, false, '/', 'n1']);
  assert.ok(n.body.startsWith('Floors 3 to 5. In effect until'));
  const e = P.compose({ id: 'e1', kind: 'emergency', type: 'fire', title: 'Fire reported', endsAt: ends }, 'confluence');
  assert.ok(e.emergency && /^EMERGENCY at Confluence/.test(e.title) && /call 911/.test(e.body));
  const c = P.compose({ id: 'c1', kind: 'card', title: 'Coffee Social', whenText: 'Sat, Dec 5', timeText: '10 AM', whereText: 'Lobby', text: 'x'.repeat(400), endsAt: ends }, 'confluence');
  assert.ok(!c.urgent && c.body.length <= 180 && c.title === 'Confluence: Coffee Social, Sat, Dec 5');

  // Sending: everyone gets it once; ended subscriptions are forgotten; other failures do not stop the rest.
  const got = [];
  const sender = async (row, body, options) => {
    if (row.endpoint.includes('device2')) { const err = new Error('gone'); err.statusCode = 410; throw err; }
    if (row.endpoint.includes('device3')) throw new Error('network');
    got.push([row.endpoint, JSON.parse(body).title, options.urgency, options.TTL]);
  };
  const out = await P.send(s, 'confluence', { id: 'e1', kind: 'emergency', type: 'fire', title: 'Fire reported', endsAt: ends }, { sender, brand: null });
  assert.deepStrictEqual(out, { sent: 1, devices: 3, gone: 1, failed: 1 });
  assert.deepStrictEqual(got, [[sub(1).endpoint, 'EMERGENCY at Confluence: Fire reported', 'high', 3600]]);
  assert.strictEqual((await s.pushList('confluence')).length, 2, 'the ended subscription was removed');
  await P.unsubscribe(s, 'confluence', sub(1).endpoint);
  assert.strictEqual((await s.pushList('confluence')).length, 1);
  // Without keys nothing is sent and nothing breaks.
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  assert.deepStrictEqual(await P.send(s, 'confluence', { id: 'x', kind: 'notice', title: 'T', endsAt: ends }), { sent: 0, devices: 0, reason: 'not_configured' });
  assert.deepStrictEqual(await P.send(mem(), 'confluence', { id: 'x', kind: 'notice', title: 'T', endsAt: ends }, { sender }), { sent: 0, devices: 0 });
  console.log('push tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
