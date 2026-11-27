const assert = require('assert');
process.env.MAIL_TEST_SECRET = 'test'; delete process.env.STORAGE_CONNECTION;
const M = require('../lib/mail');
const mem = () => { const res = new Map(), out = new Map(); let tag = 0; return { res, out,
  residentList: async (s) => [...res.values()].filter((r) => r.screen === s).map((r) => ({ ...r })),
  residentPutMany: async (s, list) => { for (const r of list) res.set(s + '/' + r.id, { ...r, screen: s }); },
  ann: new Map(),
  list: async function (sc) { return [...this.ann.values()].filter((r) => r.screen === sc).map((r) => ({ ...r })); },
  put: async function (item) { this.ann.set(item.screen + '/' + item.id, { ...item }); },
  outboxList: async (s) => [...out.values()].filter((r) => r.screen === s).map((r) => ({ ...r })),
  outboxPut: async (row) => { out.set(row.screen + '/' + row.id, { ...row, etag: 'e' + (++tag) }); },
  outboxRemove: async (s, id) => { out.delete(s + '/' + id); },
  outboxClaim: async (s, row, prev) => { const k = s + '/' + row.id, cur = out.get(k); if ((cur && cur.etag !== prev) || (!cur && prev)) return false; out.set(k, { ...row, etag: 'e' + (++tag) }); return true; } }; };
(async () => {
  const now = Date.UTC(2026, 11, 1, 15, 0, 0), id = (n) => String(n).padStart(32, '0').replace(/[^a-f0-9]/g, '0');
  const s = mem();
  for (let i = 1; i <= 20; i++) await s.residentPutMany('confluence', [{ id: id(i), firstName: 'R' + i, lastName: 'Test', email: 'r' + i + '@example.com', unsub: i === 3 }]);
  const card = { id: 'a1', kind: 'card', title: 'Coffee <Social>', text: 'Meet your neighbors & friends.', whenText: 'Sat, Dec 12', timeText: '9 to 11 AM', whereText: 'Party Room', endsAt: new Date(now + 864e5).toISOString() };

  // Wording.
  const c = M.compose(card, 'confluence');
  assert.strictEqual(c.subject, 'Confluence: Coffee <Social>, Sat, Dec 12');
  assert.deepStrictEqual(c.lines, ['Sat, Dec 12, 9 to 11 AM · Party Room.', 'Meet your neighbors & friends.']);
  const r = M.render(c, 'confluence', { id: id(1) });
  assert.ok(r.html.includes('Coffee &lt;Social&gt;') && r.html.includes('neighbors &amp; friends') && !r.html.includes('<Social>'), 'text is escaped in the html part');
  assert.ok(r.text.includes('https://display.ecsgapps.com/api/unsubscribe?s=confluence&r=' + id(1) + '&t='));
  const em = M.compose({ id: 'e1', kind: 'emergency', type: 'fire', title: 'Fire in the building', text: 'Leave now.', endsAt: card.endsAt }, 'confluence');
  assert.ok(em.subject.startsWith('EMERGENCY at Confluence') && em.heading.startsWith('EVACUATE NOW') && em.lines.some((l) => /call 911/.test(l)) && em.lines.some((l) => /may arrive late/.test(l)));
  const dr = M.compose({ id: 'd1', kind: 'drill', title: 'Fire alarm test', text: 'Only a test.', startsAt: '2026-12-12T17:00:00.000Z', endsAt: '2026-12-12T18:00:00.000Z' }, 'confluence');
  assert.strictEqual(dr.lines[0], 'Saturday, December 12, 12:00 PM to 1:00 PM.', 'building time, not server time');
  assert.strictEqual(dr.optional, false);

  // Email off: nothing is queued.
  delete process.env.ACS_CONNECTION;
  assert.deepStrictEqual(await M.queue(s, 'confluence', card, now), { queued: false, recipients: 0, reason: 'not_configured' });
  process.env.ACS_CONNECTION = 'x';
  // Announcements skip people who unsubscribed; alerts do not.
  assert.strictEqual((await M.queue(s, 'confluence', card, now)).recipients, 19);
  assert.strictEqual((await M.queue(s, 'confluence', { ...card, id: 'n1', kind: 'notice', title: 'Water shut-off' }, now + 1)).recipients, 20);
  assert.deepStrictEqual(await M.queue(mem(), 'confluence', card, now), { queued: false, recipients: 0, reason: 'no_residents' });

  // Paced sending: a few per turn, a pause between turns, everyone exactly once, urgent messages first.
  const got = []; const send = async (m) => { got.push(m.subject + ' -> ' + m.to.email); };
  let t = now + 100;
  assert.strictEqual((await M.drain(s, 'confluence', { now: t, send })).sent, M.PER_TURN);
  assert.strictEqual((await M.drain(s, 'confluence', { now: t + 1000, send })).waiting, 'turn', 'too soon');
  await M.queue(s, 'confluence', { id: 'e9', kind: 'emergency', type: 'fire', title: 'Fire', endsAt: card.endsAt }, t + 2000);
  t += 20000; await M.drain(s, 'confluence', { now: t, send });
  assert.ok(got.slice(M.PER_TURN).every((x) => x.startsWith('EMERGENCY')), 'the emergency jumps the queue');
  for (let i = 0; i < 40; i++) { t += 20000; await M.drain(s, 'confluence', { now: t, send }); }
  assert.strictEqual(got.length, 19 + 20 + 20);
  assert.strictEqual(new Set(got).size, got.length, 'nobody gets the same message twice');
  assert.ok(!got.includes('Confluence: Coffee <Social>, Sat, Dec 12 -> r3@example.com') && got.includes('Confluence notice: Water shut-off -> r3@example.com'));
  assert.deepStrictEqual([...s.out.keys()].filter((k) => !k.endsWith('_digest')), ['confluence/_rate'], 'the outbox is empty when done');

  // Hourly cap, and two callers at the same instant.
  const s2 = mem(); for (let i = 1; i <= 200; i++) await s2.residentPutMany('confluence', [{ id: id(i), firstName: 'R', lastName: '', email: 'p' + i + '@example.com' }]);
  await M.queue(s2, 'confluence', card, now);
  let n = 0, tt = now; const count = async () => { n++; };
  for (let i = 0; i < 60; i++) { tt += 15000; await M.drain(s2, 'confluence', { now: tt, send: count }); }
  assert.strictEqual(n, M.PER_HOUR, 'stops at the hourly cap');
  assert.strictEqual((await M.drain(s2, 'confluence', { now: tt + 15000, send: count })).waiting, 'hour');
  tt = now + 3600000 + 20000; const both = await Promise.all([M.drain(s2, 'confluence', { now: tt, send: count }), M.drain(s2, 'confluence', { now: tt, send: count })]);
  assert.strictEqual(both.reduce((a, b) => a + b.sent, 0), M.PER_TURN, 'only one of two simultaneous callers sends');
  // A throttled send stops the turn and that person is retried, not skipped.
  const s3 = mem(); for (let i = 1; i <= 4; i++) await s3.residentPutMany('confluence', [{ id: id(i), firstName: 'R', lastName: '', email: 'q' + i + '@example.com' }]);
  await M.queue(s3, 'confluence', card, now); const seen = []; let calls = 0;
  await M.drain(s3, 'confluence', { now: now + 20000, send: async (m) => { if (++calls === 2) { const e = new Error('slow down'); e.statusCode = 429; throw e; } seen.push(m.to.email); } });
  await M.drain(s3, 'confluence', { now: now + 40000, send: async (m) => { seen.push(m.to.email); } });
  assert.deepStrictEqual(seen.sort(), ['q1@example.com', 'q2@example.com', 'q3@example.com', 'q4@example.com']);

  // Daily email: announcements wait for the building's digest hour and go out together, once.
  const s4 = mem(); for (let i = 1; i <= 3; i++) await s4.residentPutMany('confluence', [{ id: id(i), firstName: 'R', lastName: '', email: 'd' + i + '@example.com', unsub: i === 2 }]);
  const ny = (h, m = 0, day = 1) => Date.UTC(2026, 11, day, h + 5, m);                       // New York is UTC-5 in December
  const ann = (n, extra) => ({ screen: 'confluence', id: 'x' + n, kind: 'card', title: 'Event ' + n, text: 'Details ' + n + '.', whenText: 'Sat, Dec 12', timeText: '', whereText: 'Lobby', endsAt: new Date(ny(23, 0, 20)).toISOString(), createdAt: new Date(ny(9, n)).toISOString(), mailPending: true, ...extra });
  await s4.put(ann(1)); await s4.put(ann(2)); await s4.put(ann(3, { mailPending: false })); await s4.put(ann(4, { endsAt: new Date(ny(12)).toISOString() }));
  await s4.put({ ...ann(5), kind: 'notice' });
  assert.strictEqual(await M.digest(s4, 'confluence', ny(17, 59)), 0, 'not before 6 PM building time');
  assert.strictEqual(await M.digest(s4, 'confluence', ny(18, 1)), 2, 'two waiting; one was unticked, one already ended, one is not an announcement');
  const job = (await s4.outboxList('confluence')).find((r) => r.id.startsWith('g')), dm = JSON.parse(job.msg);
  assert.deepStrictEqual([dm.subject, dm.heading, dm.list.map((x) => x.title).join('|'), job.total], ['Confluence: 2 new announcements', 'New at Confluence', 'Event 1|Event 2', 2]);
  assert.ok(M.render(dm, 'confluence', { id: id(1) }).text.includes('Event 1\nSat, Dec 12 · Lobby. Details 1.'));
  assert.strictEqual(await M.digest(s4, 'confluence', ny(19)), 0, 'only one a day');
  assert.ok((await s4.list('confluence')).filter((a) => a.id === 'x1' || a.id === 'x2').every((a) => a.mailPending === false && a.mailedAt));
  await s4.put(ann(6));
  assert.strictEqual(await M.digest(s4, 'confluence', ny(20)), 0, 'published after today\'s email: waits for tomorrow');
  assert.strictEqual(await M.digest(s4, 'confluence', ny(18, 5, 2)), 1);
  assert.strictEqual(JSON.parse((await s4.outboxList('confluence')).find((r) => r.id === 'g2026-12-02').msg).subject, 'Confluence: Event 6, Sat, Dec 12', 'a single announcement reads like its own email');
  const s5 = mem(); await s5.residentPutMany('confluence', [{ id: id(1), firstName: 'R', lastName: '', email: 'e@example.com' }]); await s5.put(ann(1));
  const two = await Promise.all([M.digest(s5, 'confluence', ny(18, 30)), M.digest(s5, 'confluence', ny(18, 30))]);
  assert.deepStrictEqual(two.sort(), [0, 1], 'two screens checking in at once make one email, not two');
  const sent5 = []; await M.drain(s5, 'confluence', { now: ny(18, 31), send: async (m) => sent5.push(m.subject) });
  assert.deepStrictEqual(sent5, ['Confluence: Event 1, Sat, Dec 12']);

  // The building's own name and office email, once the administrator has set them, are used in the emails.
  const s7 = mem(); await s7.residentPutMany('confluence', [{ id: id(1), firstName: 'R', lastName: '', email: 'b@example.com' }]);
  await s7.put({ screen: 'confluence', id: '_settings', kind: '_meta', name: 'Harbor Point', email: 'office@harbor.example' });
  await M.queue(s7, 'confluence', { id: 'n7', kind: 'notice', title: 'Water shut-off', endsAt: card.endsAt }, now);
  const m7 = JSON.parse((await s7.outboxList('confluence'))[0].msg);
  assert.deepStrictEqual([m7.subject, m7.from.name, m7.from.replyTo, m7.from.from], ['Harbor Point notice: Water shut-off', 'Harbor Point Management Office', 'office@harbor.example', 'confluence@notices.ecsgapps.com']);

  // Unsubscribe needs the signed link.
  assert.strictEqual(await M.unsubscribe(s, 'confluence', id(5), 'wrong'), false);
  assert.strictEqual(await M.unsubscribe(s, 'confluence', id(5), M.sign('confluence', id(6))), false, 'a link for someone else does not work');
  assert.strictEqual(await M.unsubscribe(s, 'confluence', id(5), M.sign('confluence', id(5))), true);
  assert.strictEqual((await s.residentList('confluence')).find((x) => x.id === id(5)).unsub, true);
  assert.strictEqual((await M.queue(s, 'confluence', { ...card, id: 'a2' }, now)).recipients, 18);
  console.log('mail tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
