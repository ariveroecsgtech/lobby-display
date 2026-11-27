const assert = require('assert');
const { getDriveTimes, fmtMinutes, level, highwayOf, _reset } = require('../lib/drive');
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
    const route = (tt, nn, road) => ({ summary: { travelTimeInSeconds: tt, noTrafficTravelTimeInSeconds: nn, trafficDelayInSeconds: tt - nn }, guidance: { instructions: [{ street: 'Belden Ave' }, { roadNumbers: [road], message: 'Take ' + road }] } });
    // Stamford: I-95 is fastest, the Merritt (CT-15) is an alternative. New Haven: slow I-95, faster Merritt, plus a second slower I-95 variant.
    const routes = dest.startsWith('41.0534') ? [route(t, n, 'I-95'), route(1320, 1200, 'CT-15')]
      : dest.startsWith('41.3083') ? [route(t, n, 'I-95'), route(2640, 2500, 'CT-15'), route(3300, 2100, 'I-95')]
      : [route(t, n, 'US-7')];
    return { ok: true, json: async () => ({ routes }) };
  };
  _reset();
  const out = await getDriveTimes('confluence', { key: 'k', fetch: fakeFetch, now: 1000 });
  assert.deepStrictEqual(out.routes.map((r) => [r.destination, r.text, r.traffic, r.delayMin]),
    [['Stamford', '18 min', 'Light', 1], ['New Haven', '44 min', 'Light', 2], ['Danbury', '40 min', 'Moderate', 8]]);
  // Each destination lists its highways, fastest first, labeled from the route's own guidance.
  assert.deepStrictEqual(out.routes.map((r) => r.options.map((o) => [o.label, o.text, o.fastest])), [
    [['I-95', '18 min', true], ['Merritt', '22 min', false]],
    [['Merritt', '44 min', true], ['I-95', '52 min', false]],
    [['Route 7', '40 min', true]]]);
  assert.deepStrictEqual(out.routes.map((r) => r.via), ['via I-95', 'via Merritt', 'via Route 7']);
  assert.ok(calls.every(([u]) => u.includes('maxAlternatives=3') && u.includes('instructionsType=text')));
  assert.strictEqual(highwayOf({ guidance: { instructions: [{ message: 'Keep left onto Wilbur Cross Pkwy' }] } }), 'Merritt');
  assert.strictEqual(highwayOf({}), null);
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
