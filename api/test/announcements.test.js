const assert = require('assert');
const A = require('../lib/announcements');
const memStore = () => { const rows = new Map(); return {
  rows,
  list: async (s) => [...rows.values()].filter((r) => r.screen === s).map((r) => ({ ...r })),
  put: async (i) => { rows.set(i.screen + '/' + i.id, { ...i }); },
  remove: async (s, id) => { rows.delete(s + '/' + id); } }; };
(async () => {
  const now = Date.UTC(2026, 10, 27, 17, 0, 0), H = 3600000, D = 24 * H;
  const at = (ms) => new Date(now + ms).toISOString();
  const store = memStore();
  const card = (o) => ({ kind: 'card', title: 'Rooftop Yoga', text: 'Bring your own mat', whenText: 'Sat, Nov 28', timeText: '10 AM', whereText: 'Rooftop', endsAt: at(2 * D), ...o });

  // Validation
  await assert.rejects(() => A.create(store, 'nowhere', card(), 'm@x.com', now), (e) => e.code === 'unknown_screen');
  await assert.rejects(() => A.create(store, 'confluence', card({ title: '   ' }), 'm', now), /title/);
  await assert.rejects(() => A.create(store, 'confluence', card({ endsAt: at(-H) }), 'm', now), /passed/);
  await assert.rejects(() => A.create(store, 'confluence', card({ endsAt: at(90 * D) }), 'm', now), /60 days/);
  await assert.rejects(() => A.create(store, 'confluence', card({ kind: 'banner' }), 'm', now), /Choose/);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'poster', title: 'x', endsAt: at(D), design: 'nope' }, 'm', now), /design/);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'emergency', title: 'x', endsAt: at(2 * D) }, 'm', now), /24 hours/);
  assert.strictEqual(store.rows.size, 0, 'nothing invalid is stored');

  // Text is trimmed, flattened and cut to length; html stays plain text (the screen escapes it).
  const a1 = await A.create(store, 'confluence', card({ title: '  Rooftop\n Yoga ' + 'x'.repeat(80), featured: true }), 'm@x.com', now);
  assert.strictEqual(a1.title.length, 40);
  assert.ok(a1.title.startsWith('Rooftop Yoga'));
  assert.strictEqual(a1.createdBy, 'm@x.com');

  // Limits: 5 cards, 3 posters, 1 emergency. Scheduled ones count; expired ones do not.
  for (let i = 0; i < 3; i++) await A.create(store, 'confluence', card({ title: 'Card ' + i, endsAt: at((3 + i) * D) }), 'm', now + i);
  await A.create(store, 'confluence', card({ title: 'Later', startsAt: at(D), endsAt: at(9 * D) }), 'm', now + 9);
  await assert.rejects(() => A.create(store, 'confluence', card({ title: 'Sixth' }), 'm', now + 10), (e) => e.code === 'limit');
  for (let i = 0; i < 3; i++) await A.create(store, 'confluence', { kind: 'poster', design: 'coffee', title: 'Coffee ' + i, endsAt: at(D) }, 'm', now + 20 + i);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'poster', design: 'movie', title: 'Fourth', endsAt: at(D) }, 'm', now + 30), (e) => e.code === 'limit');
  await A.create(store, 'confluence', { kind: 'emergency', title: 'Fire alarm test', text: 'No action needed', endsAt: at(H) }, 'm', now + 40);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'emergency', title: 'Another', endsAt: at(H) }, 'm', now + 41), /already on screen/);

  // Screen view: only live items, featured first, no author, emergency separate.
  const view = A.publicView(await store.list('confluence'), now + 100);
  assert.strictEqual(view.emergency.title, 'Fire alarm test');
  assert.strictEqual(view.items.length, 7, '4 live cards + 3 posters; the scheduled card is not live yet');
  assert.strictEqual(view.items[0].id, a1.id, 'featured first');
  assert.ok(view.items.every((i) => !('createdBy' in i)));
  assert.deepStrictEqual(view.items[0].tags, ['Sat, Nov 28', '10 AM', 'Rooftop']);
  assert.strictEqual(view.items[0].when, 'Sat, Nov 28');
  const poster = view.items.find((i) => i.kind === 'poster');
  assert.deepStrictEqual([poster.theme, poster.icon, poster.eyebrow], ['coffee', 'cup', 'You are invited']);
  // After the emergency and posters end, they leave the screen by themselves.
  const later = A.publicView(await store.list('confluence'), now + D + H);
  assert.strictEqual(later.emergency, null);
  assert.ok(later.items.every((i) => i.kind === 'card'));
  assert.ok(later.items.some((i) => i.title === 'Later'), 'scheduled card is now live');

  // Manager list and ending one.
  const open = await A.listOpen(store, 'confluence', now + 100);
  assert.strictEqual(open.length, 9);
  assert.strictEqual(open.find((a) => a.title === 'Later').live, false);
  await A.end(store, 'confluence', a1.id);
  assert.strictEqual((await A.listOpen(store, 'confluence', now + 100)).length, 8);
  await assert.rejects(() => A.end(store, 'confluence', "x' or 1"), /Unknown announcement/);
  await A.create(store, 'confluence', card({ title: 'Room again' }), 'm', now + 200);   // a slot was freed
  // Places: the screen's starting list, plus ones a manager chose to save. No duplicates, never shown as announcements.
  assert.deepStrictEqual((await A.getPlaces(store, 'confluence')).slice(0, 2), ['Party Room', 'Lobby']);
  const before = (await A.getPlaces(store, 'confluence')).length;
  const endCard = async () => A.end(store, 'confluence', (await A.listOpen(store, 'confluence', now + 100)).find((a) => a.kind === 'card').id);
  await endCard();
  await A.create(store, 'confluence', card({ title: 'Wine night', whereText: 'Pool Deck', savePlace: true }), 'm', now + 300);
  await endCard();
  await A.create(store, 'confluence', card({ title: 'Again', whereText: 'pool deck', savePlace: true }), 'm', now + 301);
  await endCard();
  await A.create(store, 'confluence', card({ title: 'Not saved', whereText: 'Garage' }), 'm', now + 302);
  const places = await A.getPlaces(store, 'confluence');
  assert.strictEqual(places.length, before + 1);
  assert.strictEqual(places[places.length - 1], 'Pool Deck');
  assert.ok((await A.listOpen(store, 'confluence', now + 400)).every((a) => a.kind !== '_meta'));
  assert.ok(A.publicView(await store.list('confluence'), now + 400).items.every((i) => i.title));
  // Rows that ended more than a week ago are cleaned up; the saved places stay.
  await A.listOpen(store, 'confluence', now + 30 * D);
  assert.deepStrictEqual([...store.rows.keys()], ['confluence/_places']);

  // Sign-in header from Azure Static Web Apps.
  const hdr = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.deepStrictEqual(A.principal(hdr({ userDetails: 'm@x.com', userRoles: ['anonymous', 'authenticated', 'manager'] })).allowed, true);
  assert.strictEqual(A.principal(hdr({ userDetails: 'm@x.com', userRoles: ['anonymous', 'authenticated'] })).allowed, false);
  assert.strictEqual(A.principal('').allowed, false);
  assert.strictEqual(A.principal('not-base64-json').allowed, false);
  console.log('announcements tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
