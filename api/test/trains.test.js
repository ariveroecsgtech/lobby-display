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
  // Next train per destination: Stamford is served by Grand Central trains; arrival time comes from the feed.
  _reset();
  const d = await getDepartures('South Norwalk', { fetch: fakeFetch, now, to: ['Grand Central', 'Stamford', 'New Haven', 'Atlantis'] });
  const by = Object.fromEntries(d.destinations.map((x) => [x.destination, x]));
  assert.deepStrictEqual([by['Grand Central'].next.inMin, by['Grand Central'].next.tripMin, by['Grand Central'].next.status], [9, 66, 'On time']);
  assert.deepStrictEqual([by['Stamford'].next.inMin, by['Stamford'].next.tripMin], [9, 16]);
  assert.deepStrictEqual([by['New Haven'].next.inMin, by['New Haven'].next.tripMin, by['New Haven'].next.status], [22, 48, '6 min late']);
  assert.strictEqual(by['Atlantis'].known, false);
  assert.strictEqual(by['Atlantis'].next, null);
  // The train after the next one, for people who will miss the first.
  assert.strictEqual(by['Grand Central'].then.inMin, 36);
  assert.strictEqual(by['Stamford'].then, null);
  assert.strictEqual(by['Atlantis'].then, null);
  // Track numbers come from Metro-North's extension field 1005, which the standard decoder ignores.
  const { Writer } = require('protobufjs/minimal');
  const { extractTracks } = require('../lib/mnr');
  const stu = (stopId, min, track, twice) => {
    const base = rt.TripUpdate.StopTimeUpdate.encode({ stopId, departure: { time: sec(min) } }).finish();
    const w = Writer.create();
    const ext = () => w.uint32((1005 << 3) | 2).bytes(Writer.create().uint32(10).string(track).uint32(18).string('On-Time').finish());
    if (track !== null) { if (twice) w.uint32((1005 << 3) | 2).bytes(Writer.create().uint32(18).string('x').finish()); ext(); }
    return Buffer.concat([base, w.finish()]);
  };
  const tripBytes = (id, stus) => {
    const tu = Writer.create(); tu.uint32(10).bytes(rt.TripDescriptor.encode({ tripId: id }).finish());
    for (const s of stus) tu.uint32(18).bytes(s);
    return Writer.create().uint32(10).string(id).uint32(26).bytes(tu.finish()).finish();
  };
  const fm = Writer.create();
  fm.uint32(10).bytes(rt.FeedHeader.encode({ gtfsRealtimeVersion: '2.0', timestamp: sec(0) }).finish());
  fm.uint32(18).bytes(tripBytes('t-gct', [stu('128', 9, '3', true), stu('116', 25, '5'), stu('1', 75, null)]));
  fm.uint32(18).bytes(tripBytes('t-nh', [stu('128', 22, null), stu('149', 70, '14')]));
  const feed2 = fm.finish();
  assert.strictEqual(rt.FeedMessage.decode(feed2).entity.length, 2, 'hand-built feed is valid GTFS-realtime');
  const tk = extractTracks(feed2);
  assert.strictEqual(tk.get('t-gct').get('128'), '3');
  assert.strictEqual(tk.get('t-gct').get('116'), '5');
  assert.strictEqual(tk.has('t-nh') && tk.get('t-nh').has('128'), false);
  assert.strictEqual(extractTracks(new Uint8Array([255, 255, 255])).size, 0, 'garbage never throws');
  _reset();
  const fetch2 = async (url) => ({ ok: true, arrayBuffer: async () => { const u = url.includes('gtfsmnr.zip') ? zip : feed2; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); } });
  const t = await getDepartures('South Norwalk', { fetch: fetch2, now, to: ['Grand Central', 'New Haven'] });
  assert.strictEqual(t.destinations[0].next.track, '3');
  assert.strictEqual(t.destinations[1].next.track, null);
  assert.deepStrictEqual(t.departures.map((x) => x.track), ['3', null]);
  console.log('all tests passed');
  console.log(JSON.stringify(out.departures[1]));
})().catch((e) => { console.error(e); process.exit(1); });
