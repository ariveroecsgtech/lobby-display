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
  await assert.rejects(() => getDriveTimes('confluence', { key: 'k', now: 1000, fetch: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  // Overnight pause, in New York time: 11 PM to 5 AM makes no Azure Maps calls.
  const at = (h, m) => Date.UTC(2026, 10, 27, h + 5, m || 0); // EST = UTC-5
  let n = 0; const counting = async (u, i) => { n++; return fakeFetch(u, i); };
  for (const [h, paused] of [[23, true], [0, true], [3, true], [4, true], [5, false], [12, false], [22, false]]) {
    _reset(); n = 0;
    const r = await getDriveTimes('confluence', { key: 'k', fetch: counting, now: at(h, 30) });
    assert.strictEqual(!!r.paused, paused, 'hour ' + h);
    assert.strictEqual(n, paused ? 0 : 3, 'calls at hour ' + h);
  }
  console.log('drive tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
