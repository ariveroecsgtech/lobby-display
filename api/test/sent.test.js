const assert = require('assert');
const A = require('../lib/announcements');
const S = require('../lib/sent');
const M = require('../lib/mail');
const P = require('../lib/push');

function mem() {
  const log = new Map(), rows = new Map();
  return { log,
    async list() { return [...rows.values()]; }, async put(r) { rows.set(r.id, r); }, async remove(s, id) { rows.delete(id); },
    async imageExists() { return true; }, async imageList() { return []; }, async imageRemove() {},
    async logList(screen) { return [...log.values()].filter((r) => r.screen === screen); },
    async logPut(r) { log.set(r.id, { ...r }); }, async logRemove(s, id) { log.delete(id); } };
}
(async () => {
  const s = mem(), now = Date.parse('2026-12-01T15:00:00Z'), ends = '2026-12-05T22:00:00Z';
  // The record keeps counts, never people.
  const card = { id: 'c1', kind: 'card', title: 'Coffee Social', text: 'Saturday at 10' };
  const r1 = await S.record(s, 'confluence', card, { push: { sent: 12, devices: 14 }, mail: { queued: false, daily: true, recipients: 0 } }, 'm@x.com', now);
  await S.record(s, 'confluence', { id: 'n1', kind: 'notice', title: 'Water shut-off' }, { push: { sent: 3, devices: 3 }, mail: { queued: true, recipients: 240 } }, 'm@x.com', now + 1000);
  let log = await S.list(s, 'confluence');
  assert.deepStrictEqual(log.map((x) => [x.kind, x.title, x.pushSent, x.mail, x.mailRecipients]), [['notice', 'Water shut-off', 3, 'now', 240], ['card', 'Coffee Social', 12, 'daily', 0]]);
  assert.deepStrictEqual(Object.keys(log[0]).sort(), ['at', 'by', 'id', 'kind', 'mail', 'mailRecipients', 'pushDevices', 'pushSent', 'ref', 'text', 'title']);

  // A correction needs text, goes out by both channels and is recorded.
  const calls = [];
  const deps = { push: async (st, sc, item) => { calls.push(['push', item.kind, item.title, item.optional]); return { sent: 12, devices: 14 }; }, mail: async (st, sc, item) => { calls.push(['mail', item.kind, item.optional]); return { queued: true, recipients: 200 }; } };
  await assert.rejects(() => S.correction(s, 'confluence', { title: '', text: 'x' }, 'm', now, deps), /what is being corrected/);
  await assert.rejects(() => S.correction(s, 'confluence', { title: 'T', text: 'no' }, 'm', now, deps), /Write the correction/);
  await assert.rejects(() => S.correction(s, 'confluence', { title: 'T', text: 'The time is wrong', ref: 'nope' }, 'm', now, deps), /no longer in the list/);
  const out = await S.correction(s, 'confluence', { title: 'Coffee Social', text: 'It is at 11 AM, not 10 AM.', ref: r1.id }, 'm@x.com', now + 5000, deps);
  assert.deepStrictEqual(calls, [['push', 'correction', 'Coffee Social', true], ['mail', 'correction', true]]);
  assert.deepStrictEqual([out.sent.kind, out.sent.ref, out.sent.mail, out.sent.mailRecipients, out.sent.pushSent], ['correction', r1.id, 'now', 200, 12]);
  log = await S.list(s, 'confluence');
  assert.strictEqual(log[0].kind, 'correction');
  // correcting a notice goes to everyone, including people who stopped event emails
  calls.length = 0; await S.correction(s, 'confluence', { title: 'Water shut-off', text: 'Floors 6 to 8, not 3 to 5.', ref: log.find((x) => x.kind === 'notice').id }, 'm', now + 6000, deps);
  assert.strictEqual(calls[1][2], false);
  // a failing channel does not stop the other, and it is still recorded
  const bad = await S.correction(s, 'confluence', { title: 'General', text: 'Please ignore the last message.' }, 'm', now + 7000, { push: async () => { throw new Error('down'); }, mail: deps.mail });
  assert.deepStrictEqual([bad.push.reason, bad.sent.mail, bad.sent.pushSent], ['error', 'now', 0]);
  // wording of the email and the notification
  const item = { id: 'x1', kind: 'correction', title: 'Coffee Social', text: 'It is at 11 AM, not 10 AM.', optional: true };
  const m = M.compose(item, 'confluence');
  assert.deepStrictEqual([m.subject, m.heading, m.lines, m.optional], ['Confluence correction: Coffee Social', 'Correction: Coffee Social', ['It is at 11 AM, not 10 AM.'], true]);
  const n = P.compose(item, 'confluence');
  assert.deepStrictEqual([n.title, n.body, n.urgent], ['Confluence correction: Coffee Social', 'It is at 11 AM, not 10 AM.', false]);
  // old lines are dropped past the limit
  for (let i = 0; i < S.KEEP + 5; i++) await S.record(s, 'confluence', { id: 'k' + i, kind: 'card', title: 'T' + i }, {}, 'm', now + 10000 + i * 1000);
  assert.strictEqual((await s.logList('confluence')).length, S.KEEP);

  // Sponsored messages: administrators only, labelled, never featured or emailed, limited, shown last.
  const s2 = mem(), base = { kind: 'card', title: 'Maple & Rye Bakery', text: '10% off for residents', endsAt: ends };
  await assert.rejects(() => A.create(s2, 'confluence', { ...base, sponsored: true }, 'mgr', now), /Only an ECSG administrator/);
  await assert.rejects(() => A.create(s2, 'confluence', { ...base, sponsored: true }, 'mgr', now, { admin: false }), /Only an ECSG administrator/);
  const sp = await A.create(s2, 'confluence', { ...base, sponsored: true, featured: true, email: true }, 'admin', now, { admin: true });
  assert.deepStrictEqual([sp.sponsored, sp.featured, sp.mailPending], [true, false, false]);
  await A.create(s2, 'confluence', { kind: 'card', title: 'Yoga', endsAt: '2026-12-09T22:00:00Z' }, 'mgr', now + 1);
  const view = A.publicView(await s2.list('confluence'), now + 10, 'confluence');
  assert.deepStrictEqual(view.items.map((x) => [x.title, x.sponsored, x.eyebrow]), [['Yoga', false, 'From the management office'], ['Maple & Rye Bakery', true, 'Sponsored']]);
  await A.create(s2, 'confluence', { ...base, title: 'B2', sponsored: true }, 'admin', now + 2, { admin: true });
  await A.create(s2, 'confluence', { ...base, title: 'B3', sponsored: true }, 'admin', now + 3, { admin: true });
  await assert.rejects(() => A.create(s2, 'confluence', { ...base, title: 'B4', sponsored: true }, 'admin', now + 4, { admin: true }), /3 sponsored messages/);
  assert.strictEqual((await A.create(s2, 'confluence', { kind: 'notice', type: 'water', title: 'W', endsAt: ends, sponsored: true }, 'admin', now + 5, { admin: true })).sponsored, false, 'an alert is never sponsored');
  console.log('sent tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
