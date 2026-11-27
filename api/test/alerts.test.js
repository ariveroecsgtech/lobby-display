const assert = require('assert');
const { getAlerts, _reset } = require('../lib/alerts');
(async () => {
  const now = Date.UTC(2026, 10, 27, 17, 0, 0), sec = (min) => Math.floor(now / 1000) + min * 60;
  const head = (text) => ({ translation: [{ text: '<p>' + text + '</p>', language: 'en-html' }, { text, language: 'en' }] });
  const feed = { entity: [
    { id: 'lmm:planned_work:1', alert: { active_period: [{ start: sec(-60), end: sec(600) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }], header_text: head('Weekend track work between Stamford and  South Norwalk'), 'transit_realtime.mercury_alert': { alert_type: 'Planned Work' } } },
    { id: 'lmm:alert:2', alert: { active_period: [{ start: sec(-5), end: sec(30) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }, { agency_id: 'MNR', trip: { trip_id: 'x', route_id: '3' } }], header_text: head('The 12:10pm train is 10 minutes late'), 'transit_realtime.mercury_alert': { alert_type: 'Some Delays' } } },
    { id: 'lmm:alert:3', alert: { active_period: [{ start: sec(-5) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }], header_text: head('New Haven Line delays of up to 20 minutes'), 'transit_realtime.mercury_alert': { alert_type: 'Delays' } } },
    { id: 'lmm:alert:4', alert: { active_period: [{ start: sec(-5), end: sec(30) }], informed_entity: [{ agency_id: 'MNR', route_id: '1' }], header_text: head('Hudson Line delays') } },
    { id: 'lmm:planned_work:5', alert: { active_period: [{ start: sec(600), end: sec(900) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }], header_text: head('Future work') } },
    { id: 'lmm:planned_work:6', alert: { active_period: [{ start: sec(-5), end: sec(30) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }], header_text: head('Added Service'), 'transit_realtime.mercury_alert': { alert_type: 'Extra Service' } } },
    { id: 'lmm:alert:7', alert: { active_period: [{ start: sec(-90), end: sec(-30) }], informed_entity: [{ agency_id: 'MNR', route_id: '3' }], header_text: head('Expired') } }
  ] };
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, json: async () => feed }; };
  _reset();
  const out = await getAlerts(['3', '5'], { fetch: fakeFetch, now });
  // Line-wide live notices first, then planned work, then single-train notices. Other lines, future, expired and "extra service" are left out.
  assert.deepStrictEqual(out.alerts.map((a) => a.id), ['lmm:alert:3', 'lmm:planned_work:1', 'lmm:alert:2']);
  assert.strictEqual(out.alerts[1].text, 'Weekend track work between Stamford and South Norwalk');
  await getAlerts(['5', '3'], { fetch: fakeFetch, now: now + 30000 });
  assert.strictEqual(calls, 1, 'cached for two minutes');
  _reset();
  assert.deepStrictEqual((await getAlerts(['5'], { fetch: fakeFetch, now })).alerts, []);
  _reset();
  await assert.rejects(() => getAlerts(['3'], { fetch: async () => ({ ok: false, status: 500 }), now }), /HTTP 500/);
  console.log('alerts tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
