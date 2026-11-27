// Metro-North service notices from MTA's public alerts feed (JSON form of GTFS-realtime alerts).
// Only notices for the lines that serve this station are returned, and only while they are in effect.
const ALERTS_URL = process.env.MNR_ALERTS_URL || 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fmnr-alerts.json';
const TTL_MS = 2 * 60 * 1000;
const cache = new Map();

const english = (t) => {
  const list = (t && t.translation) || [];
  const hit = list.find((x) => x.language === 'en') || list.find((x) => !/html/i.test(x.language || '')) || list[0];
  return hit ? String(hit.text || '').replace(/\s+/g, ' ').trim() : '';
};

async function getAlerts(routeIds, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const routes = new Set((routeIds || []).map(String));
  const key = [...routes].sort().join(',');
  const hit = cache.get(key);
  if (!opts.noCache && hit && now - hit.at < TTL_MS) return hit.body;

  const res = await fetchImpl(ALERTS_URL);
  if (!res.ok) throw new Error('Alerts feed failed: HTTP ' + res.status);
  const feed = await res.json();
  const nowSec = now / 1000;
  const alerts = [];
  for (const entity of feed.entity || []) {
    const a = entity.alert;
    if (!a) continue;
    const informed = a.informed_entity || [];
    if (!informed.some((e) => e.agency_id === 'MNR' && routes.has(String(e.route_id)))) continue;
    const periods = a.active_period || [];
    const active = !periods.length || periods.some((p) => (!p.start || Number(p.start) <= nowSec) && (!p.end || Number(p.end) > nowSec));
    if (!active) continue;
    const text = english(a.header_text);
    if (!text) continue;
    const extra = a['transit_realtime.mercury_alert'] || {};
    const type = String(extra.alert_type || '');
    if (/extra service/i.test(type)) continue;                      // good news is not a warning
    // A notice about one specific train is already visible as that train's delay, so line-wide notices go first.
    const oneTrain = informed.some((e) => e.trip);
    const planned = /planned_work/.test(String(entity.id));
    alerts.push({ id: String(entity.id), type, text, planned, oneTrain, rank: (oneTrain ? 2 : 0) + (planned ? 1 : 0) });
  }
  alerts.sort((x, y) => x.rank - y.rank);
  const body = { source: 'MTA Metro-North service alerts', generatedAt: new Date(now).toISOString(), alerts: alerts.slice(0, 4).map(({ rank, ...rest }) => rest) };
  cache.set(key, { at: now, body });
  return body;
}

module.exports = { getAlerts, _reset: () => cache.clear() };
