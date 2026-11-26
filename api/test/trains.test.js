// Offline test: builds a fake Metro-North static zip and realtime feed, then checks the output.
const assert = require('assert');
const { zipSync, strToU8 } = require('fflate');
const { transit_realtime: rt } = require('gtfs-realtime-bindings');
const { getDepartures, _reset } = require('../lib/mnr');

const now = Date.UTC(2026, 10, 27, 13, 42, 0);
const sec = (min) => Math.floor(now / 1000) + min * 60;
const stopsTxt = '﻿stop_id,stop_code,stop_name,stop_lat\r\n1,0NY,Grand Central,40.75\r\n128,1SN,"South Norwalk",41.09\r\n149,1NH,New Haven,41.29\r\n116,1ST,Stamford,41.04\r\n';
const zip = zipSync({ 'stops.txt': strToU8(stopsTxt), 'routes.txt': strToU8('x') });
const trip = (id, stops) => ({ id, tripUpdate: { trip: { tripId: id }, stopTimeUpdate: stops.map(([stopId, min, delay]) => ({ stopId, departure: { time: sec(min), delay: delay || 0 } })) } });
const feed = rt.FeedMessage.encode(rt.FeedMessage.create({
  header: { gtfsRealtimeVersion: '2.0', timestamp: sec(0) },
  entity: [
    trip('late-nh', [['116', 5], ['128', 22, 360], ['149', 70, 360]]),
    trip('gct', [['149', -40], ['128', 9], ['116', 25], ['1', 75]]),
    trip('gone', [['128', -10], ['1', 50]]),
    trip('ends-here', [['1', -60], ['128', 12]]),
    trip('elsewhere', [['116', 3], ['1', 50]]),
    trip('gct2', [['128', 36], ['1', 100]])
  ]
})).finish();
let calls = 0;
const fakeFetch = async (url) => { calls++; return { ok: true, status: 200, arrayBuffer: async () => { const u = url.includes('gtfsmnr.zip') ? zip : feed; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); } }; };

(async () => {
  _reset();
  const out = await getDepartures('south norwalk', { fetch: fakeFetch, now });
  assert.deepStrictEqual(out.departures.map((d) => [d.inMin, d.destination, d.status]), [[9, 'Grand Central', 'On time'], [22, 'New Haven', '6 min late'], [36, 'Grand Central', 'On time']]);
  assert.strictEqual(calls, 2);
  await getDepartures('South Norwalk', { fetch: fakeFetch, now: now + 5000 });
  assert.strictEqual(calls, 2, 'second call within 30 s must come from cache');
  await getDepartures('South Norwalk', { fetch: fakeFetch, now: now + 40000 });
  assert.strictEqual(calls, 3, 'after 30 s only the realtime feed is refetched');
  await assert.rejects(() => getDepartures('Nowhere', { fetch: fakeFetch, now }), /Station not found/);
  _reset();
  await assert.rejects(() => getDepartures('South Norwalk', { fetch: async () => ({ ok: false, status: 403 }), now }), /HTTP 403/);
  console.log('all tests passed');
  console.log(JSON.stringify(out.departures[1]));
})().catch((e) => { console.error(e); process.exit(1); });
