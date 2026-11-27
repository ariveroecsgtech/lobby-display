// Metro-North departures for one station, from MTA's public GTFS feeds.
// Static feed gives station names; the realtime feed gives predicted times and delays.
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { unzipSync, strFromU8 } = require('fflate');

const STATIC_URL = process.env.MNR_STATIC_URL || 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip';
const REALTIME_URL = process.env.MNR_REALTIME_URL || 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr';
const STOPS_TTL_MS = 24 * 60 * 60 * 1000;   // station list changes rarely
const DEPARTURES_TTL_MS = 30 * 1000;        // MTA refreshes the realtime feed about every 30 s

let stopsCache = null;            // { at, byId: Map<id, name> }
const departuresCache = new Map(); // station -> { at, body }

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function loadStops(fetchImpl) {
  if (stopsCache && Date.now() - stopsCache.at < STOPS_TTL_MS) return stopsCache.byId;
  const res = await fetchImpl(STATIC_URL);
  if (!res.ok) throw new Error('Static GTFS download failed: HTTP ' + res.status);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => f.name === 'stops.txt' });
  if (!files['stops.txt']) throw new Error('stops.txt not found in static GTFS');
  const rows = parseCsv(strFromU8(files['stops.txt']).replace(/^﻿/, ''));
  const header = rows[0].map((h) => h.trim());
  const idCol = header.indexOf('stop_id'), nameCol = header.indexOf('stop_name');
  if (idCol < 0 || nameCol < 0) throw new Error('stops.txt is missing stop_id or stop_name');
  const byId = new Map();
  for (const r of rows.slice(1)) if (r[idCol]) byId.set(String(r[idCol]).trim(), String(r[nameCol]).trim());
  stopsCache = { at: Date.now(), byId };
  return byId;
}

// --- Track numbers -------------------------------------------------------------------------
// Metro-North publishes the track in a GTFS-realtime extension (field 1005 on StopTimeUpdate,
// message { track = 1; trainStatus = 2 }) that the standard decoder drops, so it is read
// straight from the protobuf wire format here.
function readFields(buf, start, end, onField) {
  let pos = start;
  const varint = () => { let r = 0, shift = 0, b; do { b = buf[pos++]; if (shift < 28) r |= (b & 0x7f) << shift; else r += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80 && pos <= end); return r >>> 0; };
  while (pos < end) {
    const tag = varint(), field = tag >>> 3, wire = tag & 7;
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) { const len = varint(); onField(field, pos, pos + len); pos += len; }
    else return; // groups are not used by GTFS-realtime
  }
}
function extractTracks(buf) {
  const text = (s, e) => Buffer.from(buf.subarray(s, e)).toString('utf8');
  const tracks = new Map(); // entity id -> Map(stop id -> track)
  try {
    readFields(buf, 0, buf.length, (f, s, e) => {
      if (f !== 2) return;                                   // FeedMessage.entity
      let id = '', perStop = null;
      readFields(buf, s, e, (f2, s2, e2) => {
        if (f2 === 1) id = text(s2, e2);                     // FeedEntity.id
        if (f2 !== 3) return;                                // FeedEntity.trip_update
        readFields(buf, s2, e2, (f3, s3, e3) => {
          if (f3 !== 2) return;                              // TripUpdate.stop_time_update
          let stopId = '', track = '';
          readFields(buf, s3, e3, (f4, s4, e4) => {
            if (f4 === 4) stopId = text(s4, e4);             // StopTimeUpdate.stop_id
            if (f4 === 1005) readFields(buf, s4, e4, (f5, s5, e5) => { if (f5 === 1 && e5 > s5) track = text(s5, e5).trim(); });
          });
          if (stopId && track) (perStop = perStop || new Map()).set(stopId, track);
        });
      });
      if (id && perStop) tracks.set(id, perStop);
    });
  } catch (e) { /* track is optional: never fail the request over it */ }
  return tracks;
}

const toNumber = (v) => (v == null ? null : typeof v === 'number' ? v : Number(v.toString()));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

async function getDepartures(stationName, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const limit = opts.limit || 4;
  const toNames = (opts.to || []).filter(Boolean);
  const key = norm(stationName) + '>' + toNames.map(norm).join(',');
  const hit = departuresCache.get(key);
  if (!opts.noCache && hit && now - hit.at < DEPARTURES_TTL_MS) return hit.body;

  const stops = await loadStops(fetchImpl);
  const stationKey = norm(stationName);
  const stationIds = new Set([...stops].filter(([, name]) => norm(name) === stationKey).map(([id]) => id));
  if (!stationIds.size) throw new Error('Station not found in Metro-North stops: ' + stationName);

  const res = await fetchImpl(REALTIME_URL);
  if (!res.ok) throw new Error('Realtime feed failed: HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const tracks = extractTracks(bytes);

  // Optional: the next train from this station that also stops at each requested destination.
  const idsFor = (name) => new Set([...stops].filter(([, n]) => norm(n) === norm(name)).map(([id]) => id));
  const wanted = toNames.map((name) => ({ name, ids: idsFor(name), trains: [] }));

  const departures = [];
  for (const entity of feed.entity) {
    const updates = entity.tripUpdate && entity.tripUpdate.stopTimeUpdate;
    if (!updates || !updates.length) continue;
    const hereIdx = updates.findIndex((u) => stationIds.has(String(u.stopId)));
    if (hereIdx < 0) continue;
    const here = updates[hereIdx];
    const last = updates[updates.length - 1];
    if (stationIds.has(String(last.stopId))) continue;           // train ends here: nobody boards it
    const ev = here.departure || here.arrival;
    const seconds = ev && toNumber(ev.time);
    if (!seconds) continue;
    const timeMs = seconds * 1000;
    if (timeMs < now - 60 * 1000) continue;                      // already gone
    const delayMin = Math.max(0, Math.round((toNumber(ev.delay) || 0) / 60));
    const track = (tracks.get(String(entity.id)) || new Map()).get(String(here.stopId)) || null;
    for (const w of wanted) {
      const stop = updates.slice(hereIdx + 1).find((u) => w.ids.has(String(u.stopId)));
      const arr = stop && toNumber((stop.arrival || stop.departure || {}).time);
      if (arr) w.trains.push({ timeMs, arriveMs: arr * 1000, delayMin, track });
    }
    departures.push({
      time: new Date(timeMs).toISOString(),
      inMin: Math.max(0, Math.round((timeMs - now) / 60000)),
      destination: stops.get(String(last.stopId)) || 'Unknown',
      delayMin,
      track,
      status: delayMin >= 1 ? delayMin + ' min late' : 'On time'
    });
  }
  departures.sort((a, b) => a.time.localeCompare(b.time));

  const feedTime = toNumber(feed.header && feed.header.timestamp);
  const body = {
    station: stationName,
    source: 'MTA Metro-North GTFS-realtime',
    feedTime: feedTime ? new Date(feedTime * 1000).toISOString() : null,
    generatedAt: new Date(now).toISOString(),
    departures: departures.slice(0, limit),
    // "next" is the first train to board; "then" is the one after it, for people who will miss the first.
    destinations: wanted.map((w) => {
      const [first, second] = w.trains.sort((a, b) => a.timeMs - b.timeMs);
      const shape = (t) => t && {
        time: new Date(t.timeMs).toISOString(),
        inMin: Math.max(0, Math.round((t.timeMs - now) / 60000)),
        arrive: new Date(t.arriveMs).toISOString(),
        tripMin: Math.max(0, Math.round((t.arriveMs - t.timeMs) / 60000)),
        delayMin: t.delayMin,
        track: t.track,
        status: t.delayMin >= 1 ? t.delayMin + ' min late' : 'On time'
      };
      return { destination: w.name, known: w.ids.size > 0, next: shape(first) || null, then: shape(second) || null };
    })
  };
  departuresCache.set(key, { at: now, body });
  return body;
}

module.exports = { getDepartures, parseCsv, extractTracks, _reset: () => { stopsCache = null; departuresCache.clear(); } };
