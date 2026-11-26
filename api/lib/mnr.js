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

const toNumber = (v) => (v == null ? null : typeof v === 'number' ? v : Number(v.toString()));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

async function getDepartures(stationName, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const limit = opts.limit || 4;
  const key = norm(stationName);
  const hit = departuresCache.get(key);
  if (!opts.noCache && hit && now - hit.at < DEPARTURES_TTL_MS) return hit.body;

  const stops = await loadStops(fetchImpl);
  const stationIds = new Set([...stops].filter(([, name]) => norm(name) === key).map(([id]) => id));
  if (!stationIds.size) throw new Error('Station not found in Metro-North stops: ' + stationName);

  const res = await fetchImpl(REALTIME_URL);
  if (!res.ok) throw new Error('Realtime feed failed: HTTP ' + res.status);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));

  const departures = [];
  for (const entity of feed.entity) {
    const updates = entity.tripUpdate && entity.tripUpdate.stopTimeUpdate;
    if (!updates || !updates.length) continue;
    const here = updates.find((u) => stationIds.has(String(u.stopId)));
    if (!here) continue;
    const last = updates[updates.length - 1];
    if (stationIds.has(String(last.stopId))) continue;           // train ends here: nobody boards it
    const ev = here.departure || here.arrival;
    const seconds = ev && toNumber(ev.time);
    if (!seconds) continue;
    const timeMs = seconds * 1000;
    if (timeMs < now - 60 * 1000) continue;                      // already gone
    const delayMin = Math.max(0, Math.round((toNumber(ev.delay) || 0) / 60));
    departures.push({
      time: new Date(timeMs).toISOString(),
      inMin: Math.max(0, Math.round((timeMs - now) / 60000)),
      destination: stops.get(String(last.stopId)) || 'Unknown',
      delayMin,
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
    departures: departures.slice(0, limit)
  };
  departuresCache.set(key, { at: now, body });
  return body;
}

module.exports = { getDepartures, parseCsv, _reset: () => { stopsCache = null; departuresCache.clear(); } };
