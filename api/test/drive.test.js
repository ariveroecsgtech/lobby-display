const assert = require('assert');
const { getDriveTimes, fmtMinutes, level, _reset } = require('../lib/drive');
(async () => {
  assert.strictEqual(fmtMinutes(18 * 60), '18 min');
  assert.strictEqual(fmtMinutes(74 * 60), '1 h 14');
  assert.strictEqual(fmtMinutes(125 * 60), '2 h 05');
  assert.deepStrictEqual([level(1000, 1000), level(1250, 1000), level(1600, 1000)], ['Light', 'Moderate', 'Heavy']);
  await assert.rejects(() => getDriveTimes('confluence', { key: '' }), (e) => e.code === 'not_configured');
  await assert.rejects(() => getDriveTimes('nope', { key: 'k' }), (e) => e.code === 'unknown_screen');
  const calls = [];
  const times = { '41.0534,-73.5387': [1080, 1020], '41.3083,-72.9279': [3120, 2100], '41.3948,-73.454': [2400, 1900] };
  const fakeFetch = async (url, init) => {
    calls.push([url, init.headers['subscription-key']]);
    const dest = url.split(':').pop();
    const [t, n] = times[dest];
    return { ok: true, json: async () => ({ routes: [{ summary: { travelTimeInSeconds: t, noTrafficTravelTimeInSeconds: n, trafficDelayInSeconds: t - n } }] }) };
  };
  _reset();
  const out = await getDriveTimes('confluence', { key: 'k', fetch: fakeFetch, now: 1000 });
  assert.deepStrictEqual(out.routes.map((r) => [r.destination, r.text, r.traffic, r.delayMin]),
    [['Stamford', '18 min', 'Light', 1], ['New Haven', '52 min', 'Heavy', 17], ['Danbury', '40 min', 'Moderate', 8]]);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every(([u, k]) => k === 'k' && !u.includes('subscription-key') && u.includes('query=41.119,-73.416:')));
  await getDriveTimes('confluence', { key: 'k', fetch: fakeFetch, now: 1000 + 60000 });
  assert.strictEqual(calls.length, 3, 'cached within 15 minutes');
  _reset();
  await assert.rejects(() => getDriveTimes('confluence', { key: 'k', fetch: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  console.log('drive tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
