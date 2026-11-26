// Drive times with live traffic from Azure Maps Route Directions.
// Destinations are fixed per screen on the server so the endpoint cannot be used to run arbitrary routes.
const SCREENS = {
  confluence: {
    origin: [41.119, -73.416], // 26 Belden Ave, Norwalk, CT
    timeZone: 'America/New_York',
    quietHours: [23, 5],       // no Azure Maps calls from 11 PM to 5 AM local time
    destinations: [
      { name: 'Stamford', via: 'via I-95 South', at: [41.0534, -73.5387] },
      { name: 'New Haven', via: 'via I-95 North', at: [41.3083, -72.9279] },
      { name: 'Danbury', via: 'via Route 7', at: [41.3948, -73.4540] }
    ]
  }
};
const TTL_MS = 15 * 60 * 1000; // 3 routes every 15 min is about 8,600 Azure Maps transactions a month per screen
const cache = new Map();

function fmtMinutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}
function localHour(ms, timeZone) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms)));
}
function isQuiet(screen, ms) {
  if (!screen.quietHours) return false;
  const [from, to] = screen.quietHours, h = localHour(ms, screen.timeZone || 'UTC');
  return from > to ? (h >= from || h < to) : (h >= from && h < to);
}
function level(travel, noTraffic) {
  const ratio = noTraffic > 0 ? travel / noTraffic : 1;
  return ratio < 1.15 ? 'Light' : ratio < 1.4 ? 'Moderate' : 'Heavy';
}

async function getDriveTimes(screenId, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const key = opts.key !== undefined ? opts.key : process.env.AZURE_MAPS_KEY;
  const screen = SCREENS[screenId];
  if (!screen) { const e = new Error('Unknown screen: ' + screenId); e.code = 'unknown_screen'; throw e; }
  if (!key) { const e = new Error('AZURE_MAPS_KEY is not set'); e.code = 'not_configured'; throw e; }
  // Overnight pause: answer without calling Azure Maps at all, whoever asks.
  if (isQuiet(screen, now)) return { screen: screenId, paused: true, resumesAtHour: screen.quietHours[1], generatedAt: new Date(now).toISOString(), routes: [] };
  const hit = cache.get(screenId);
  if (!opts.noCache && hit && now - hit.at < TTL_MS) return hit.body;

  const routes = await Promise.all(screen.destinations.map(async (d) => {
    const url = 'https://atlas.microsoft.com/route/directions/json?api-version=1.0&traffic=true&computeTravelTimeFor=all' +
      '&query=' + screen.origin.join(',') + ':' + d.at.join(',');
    const res = await fetchImpl(url, { headers: { 'subscription-key': key } });
    if (!res.ok) throw new Error('Azure Maps route failed: HTTP ' + res.status);
    const s = (await res.json()).routes[0].summary;
    const noTraffic = s.noTrafficTravelTimeInSeconds || (s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0));
    return {
      destination: d.name,
      via: d.via,
      minutes: Math.round(s.travelTimeInSeconds / 60),
      text: fmtMinutes(s.travelTimeInSeconds),
      delayMin: Math.max(0, Math.round((s.travelTimeInSeconds - noTraffic) / 60)),
      traffic: level(s.travelTimeInSeconds, noTraffic)
    };
  }));
  const body = { screen: screenId, source: 'Azure Maps', generatedAt: new Date(now).toISOString(), routes };
  cache.set(screenId, { at: now, body });
  return body;
}

module.exports = { getDriveTimes, fmtMinutes, level, isQuiet, _reset: () => cache.clear() };
