const assert = require('assert');
const A = require('../lib/announcements');
const clock = { now: 0 };
const memStore = () => { const rows = new Map(), images = new Map(); return {
  rows,
  list: async (s) => [...rows.values()].filter((r) => r.screen === s).map((r) => ({ ...r })),
  put: async (i) => { rows.set(i.screen + '/' + i.id, { ...i }); },
  images,
  imagePut: async (id, bytes, type) => { images.set(id, { type, createdAt: clock.now }); },
  imageExists: async (id) => images.has(id),
  imageRemove: async (id) => { images.delete(id); },
  imageList: async () => [...images].map(([id, v]) => ({ id, createdAt: v.createdAt })),
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
  await assert.rejects(() => A.create(store, 'confluence', card({ kind: 'banner' }), 'm', now), /Unknown kind/);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'poster', title: 'x', endsAt: at(D), design: 'nope' }, 'm', now), /design/);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'emergency', title: 'x', endsAt: at(2 * D) }, 'm', now), /24 hours/);
  assert.strictEqual(store.rows.size, 0, 'nothing invalid is stored');

  // Text is trimmed, flattened and cut to length; html stays plain text (the screen escapes it).
  const a1 = await A.create(store, 'confluence', card({ title: '  Rooftop\n Yoga ' + 'x'.repeat(80), featured: true }), 'm@x.com', now);
  assert.strictEqual(a1.title.length, 40);
  assert.ok(a1.title.startsWith('Rooftop Yoga'));
  assert.strictEqual(a1.createdBy, 'm@x.com');

  // One emergency at a time. (The shared limit of 10 announcements is checked further down, on its own store.)
  for (let i = 0; i < 3; i++) await A.create(store, 'confluence', card({ title: 'Card ' + i, endsAt: at((3 + i) * D) }), 'm', now + i);
  await A.create(store, 'confluence', card({ title: 'Later', startsAt: at(D), endsAt: at(9 * D) }), 'm', now + 9);
  for (let i = 0; i < 3; i++) await A.create(store, 'confluence', { kind: 'poster', design: 'coffee', title: 'Coffee ' + i, endsAt: at(D) }, 'm', now + 20 + i);
  await A.create(store, 'confluence', { kind: 'emergency', type: 'shelter', title: 'Fire alarm test', text: 'No action needed', endsAt: at(H) }, 'm', now + 40);
  await assert.rejects(() => A.create(store, 'confluence', { kind: 'emergency', type: 'fire', title: 'Another', endsAt: at(H) }, 'm', now + 41), /already on screen/);

  // Screen view: only live items, featured first, no author, emergency separate.
  const view = A.publicView(await store.list('confluence'), now + 100);
  assert.strictEqual(view.emergency.title, 'Fire alarm test');
  assert.strictEqual(view.items.length, 7, '4 live cards + 3 posters; the scheduled card is not live yet');
  assert.strictEqual(view.items[0].id, a1.id, 'featured first');
  assert.ok(view.items.every((i) => !('createdBy' in i)));
  assert.deepStrictEqual(view.items[0].tags, ['Sat, Nov 28', '10 AM', 'Rooftop']);
  assert.strictEqual(view.items[0].when, 'Sat, Nov 28');
  const poster = view.items.find((i) => i.kind === 'poster');
  assert.deepStrictEqual([poster.design, poster.eyebrow], ['coffee', 'You are invited']);
  assert.strictEqual(view.items.find((i) => i.kind === 'card').design, '');
  assert.strictEqual(A.publicView([{ id: 'x', kind: 'poster', design: 'maintenance', title: 'Water shut-off', startsAt: at(-H), endsAt: at(H) }], now).items[0].eyebrow, 'From the management office');
  // Every template the API accepts has artwork in /templates.js, and the other way round.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'templates.js'), 'utf8');
  const win = {}; new Function('window', src)(win);
  assert.deepStrictEqual(Object.keys(win.LOBBY_TEMPLATES).sort(), Object.keys(A.DESIGNS).sort());
  for (const [k, t] of Object.entries(win.LOBBY_TEMPLATES)) {
    assert.strictEqual(t.label, A.DESIGNS[k].label, k);
    assert.ok(!/[{}]/.test(win.lobbyArt(t)), k + ' art has every color filled in');
  }
  // After the emergency and posters end, they leave the screen by themselves.
  const later = A.publicView(await store.list('confluence'), now + D + H);
  assert.strictEqual(later.emergency, null);
  assert.ok(later.items.every((i) => i.kind === 'card'));
  assert.ok(later.items.some((i) => i.title === 'Later'), 'scheduled card is now live');

  // Manager list and ending one.
  const open = await A.listOpen(store, 'confluence', now + 100);
  assert.strictEqual(open.length, 9);   // 5 cards, 3 posters, 1 emergency
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

  // Limit: 10 announcements in total, cards and posters in any mix. Scheduled ones count, expired ones and the emergency do not.
  const s3 = memStore();
  for (let i = 0; i < 6; i++) await A.create(s3, 'confluence', card({ title: 'Card ' + i, startsAt: i === 0 ? at(D) : undefined }), 'm', now + i);
  for (let i = 0; i < 4; i++) await A.create(s3, 'confluence', { kind: 'poster', design: 'pizza', title: 'Poster ' + i, endsAt: at(H), featured: i === 0 }, 'm', now + 10 + i);
  await assert.rejects(() => A.create(s3, 'confluence', card({ title: 'Eleventh' }), 'm', now + 20), /limit is 10 announcements/);
  await assert.rejects(() => A.create(s3, 'confluence', { kind: 'poster', design: 'pizza', title: 'Eleventh', endsAt: at(D) }, 'm', now + 20), (e) => e.code === 'limit');
  await A.create(s3, 'confluence', { kind: 'emergency', type: 'fire', title: 'Still allowed', endsAt: at(H) }, 'm', now + 21);
  assert.strictEqual(A.publicView(await s3.list('confluence'), now + 30).items[0].title, 'Poster 0', 'a featured poster goes first');
  await A.create(s3, 'confluence', card({ title: 'After posters ended' }), 'm', now + 2 * H);
  assert.strictEqual(A.totalFor('confluence'), 10);

  // Alerts in three levels.
  const s4 = memStore();
  // 1. Service notices never block the screen and do not use Community slots. Three at most.
  await A.create(s4, 'confluence', { kind: 'notice', type: 'water', title: 'Water shut-off', text: 'Back by 2 PM', endsAt: at(4 * H) }, 'm', now);
  await A.create(s4, 'confluence', { kind: 'notice', type: 'elevator', title: 'Elevator out of service', endsAt: at(2 * H) }, 'm', now + 1);
  await A.create(s4, 'confluence', { kind: 'notice', title: 'Lobby doors', endsAt: at(8 * H) }, 'm', now + 2);
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'notice', type: 'power', title: 'x', endsAt: at(H) }, 'm', now + 3), /3 service notices/);
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'notice', type: 'nope', title: 'x', endsAt: at(H) }, 'm', now + 3), /type of notice/);
  let v = A.publicView(await s4.list('confluence'), now + 10, 'confluence');
  assert.deepStrictEqual(v.notices.map((n) => [n.type, n.title]), [['elevator', 'Elevator out of service'], ['water', 'Water shut-off'], ['other', 'Lobby doors']]);
  assert.deepStrictEqual([v.emergency, v.drill, v.items.length], [null, null, 0]);
  // 2. A scheduled test covers the screen only between its start and end, and brings its own announcement card.
  const drill = await A.create(s4, 'confluence', { kind: 'drill', title: 'Fire alarm test', text: 'This is only a test.', startsAt: at(15 * D), endsAt: at(15 * D + H),
    announce: true, whenText: 'Sat, Dec 12', timeText: '12 to 1 PM' }, 'm', now + 20);
  v = A.publicView(await s4.list('confluence'), now + 30, 'confluence');
  assert.strictEqual(v.drill, null, 'not on screen before its time');
  assert.deepStrictEqual(v.items.map((i) => [i.kind, i.title, i.tags.join('|')]), [['card', 'Fire alarm test', 'Sat, Dec 12|12 to 1 PM']]);
  v = A.publicView(await s4.list('confluence'), now + 15 * D + 60000, 'confluence');
  assert.deepStrictEqual([v.drill.title, v.drill.until, v.items.length], ['Fire alarm test', at(15 * D + H), 0], 'during the test: takeover on, card gone');
  assert.strictEqual(A.publicView(await s4.list('confluence'), now + 15 * D + H + 1000, 'confluence').drill, null, 'it ends by itself');
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'drill', title: 'x', startsAt: at(15 * D + 1800000), endsAt: at(15 * D + 2 * H) }, 'm', now + 40), /already scheduled at that time/);
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'drill', title: 'x', startsAt: at(D), endsAt: at(D + 5 * H) }, 'm', now + 40), /4 hours/);
  // Cancelling the test also removes its card, whichever of the two is cancelled.
  assert.strictEqual((await A.listOpen(s4, 'confluence', now + 50)).filter((a) => a.group === drill.id).length, 2);
  await A.end(s4, 'confluence', drill.id + 'c');
  assert.ok((await A.listOpen(s4, 'confluence', now + 50)).every((a) => a.kind === 'notice'));
  // A test that starts right away has no announcement card.
  const nowDrill = await A.create(s4, 'confluence', { kind: 'drill', title: 'Alarm test', endsAt: at(1800000), announce: true }, 'm', now + 60);
  assert.strictEqual(nowDrill.group, undefined);
  // 3. A real emergency: typed, immediate, with the building's own route details only when they are on file.
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'emergency', title: 'x', endsAt: at(H) }, 'm', now + 70), /type of emergency/, 'no type, no emergency');
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'emergency', type: 'meteor', title: 'x', endsAt: at(H) }, 'm', now + 70), /type of emergency/);
  await assert.rejects(() => A.create(s4, 'confluence', { kind: 'emergency', type: 'fire', title: 'x', startsAt: at(H), endsAt: at(2 * H) }, 'm', now + 70), /cannot be scheduled/);
  await A.create(s4, 'confluence', { kind: 'emergency', type: 'fire', title: 'Fire in the building', text: 'Leave now.', endsAt: at(H) }, 'm', now + 70);
  v = A.publicView(await s4.list('confluence'), now + 80, 'confluence');
  assert.deepStrictEqual([v.emergency.action, v.emergency.headline, v.emergency.route, v.emergency.assembly], ['evacuate', 'EVACUATE NOW', '', '']);
  assert.ok(v.drill && v.notices.length === 3, 'the screen decides what to show on top; nothing is lost');
  A.SCREENS.confluence.safety = { route: 'Stairs A and B', assembly: 'Parking lot' };
  assert.deepStrictEqual(Object.values(A.publicView(await s4.list('confluence'), now + 80, 'confluence').emergency).slice(-2), ['Stairs A and B', 'Parking lot']);
  A.SCREENS.confluence.safety = { route: '', assembly: '' };
  const s5 = memStore();
  await A.create(s5, 'confluence', { kind: 'emergency', type: 'threat', title: 'Danger in the building', endsAt: at(H) }, 'm', now);
  v = A.publicView(await s5.list('confluence'), now + 1, 'confluence').emergency;
  assert.deepStrictEqual([v.action, v.headline, v.route], ['shelter', 'TAKE SHELTER', ''], 'no evacuation route on a shelter screen');
  for (const t of Object.values(A.EMERGENCIES)) assert.ok(['evacuate', 'shelter'].includes(t.action) && t.headline && t.title && t.text);

  // Uploaded images: real JPG, PNG or WebP only, size capped, and removed with their announcement.
  const s2 = memStore(); clock.now = now;
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]), png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.deepStrictEqual([A.sniffImage(jpg), A.sniffImage(png), A.sniffImage(webp)], ['image/jpeg', 'image/png', 'image/webp']);
  assert.strictEqual(A.sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  await assert.rejects(() => A.saveImage(s2, 'confluence', new TextEncoder().encode('<svg></svg>'), now), /JPG, PNG or WebP/);
  await assert.rejects(() => A.saveImage(s2, 'confluence', new Uint8Array(0), now), /No image/);
  const big = new Uint8Array(A.IMAGE.maxBytes + 1); big.set(jpg);
  await assert.rejects(() => A.saveImage(s2, 'confluence', big, now), /too large/);
  const img = await A.saveImage(s2, 'confluence', jpg, now);
  assert.ok(A.IMAGE_ID.test(img.id));
  await assert.rejects(() => A.create(s2, 'confluence', { kind: 'poster', title: 'x', endsAt: at(D), imageId: 'nope' }, 'm', now), /not valid/);
  await assert.rejects(() => A.create(s2, 'confluence', { kind: 'poster', title: 'x', endsAt: at(D), imageId: 'abcdefabcdef12345678' }, 'm', now), /not found/);
  await assert.rejects(() => A.create(s2, 'confluence', { kind: 'poster', title: 'x', endsAt: at(D) }, 'm', now), /design or upload/);
  const own = await A.create(s2, 'confluence', { kind: 'poster', title: 'Art show', endsAt: at(D), imageId: img.id, design: 'coffee' }, 'm', now);
  assert.deepStrictEqual([own.imageId, own.design], [img.id, '']);
  const shown = A.publicView(await s2.list('confluence'), now + 1).items[0];
  assert.deepStrictEqual([shown.image, shown.design], ['/api/image/' + img.id, '']);
  assert.strictEqual((await A.create(s2, 'confluence', { kind: 'card', title: 'c', endsAt: at(D), imageId: img.id }, 'm', now)).imageId, '', 'cards never carry images');
  // An upload that was never published is removed after a day; one in use stays.
  const orphan = await A.saveImage(s2, 'confluence', png, now);
  await A.listOpen(s2, 'confluence', now + 2 * H);
  assert.ok(s2.images.has(orphan.id), 'kept during the first day');
  await A.listOpen(s2, 'confluence', now + 25 * H);
  assert.ok(!s2.images.has(orphan.id) && s2.images.has(img.id));
  await A.end(s2, 'confluence', own.id);
  assert.ok(!s2.images.has(img.id), 'ending the announcement deletes its image');

  // Building settings: defaults, validation, logo handling, and what the screen receives.
  const s6 = memStore(); clock.now = now;
  assert.deepStrictEqual(await A.getSettings(s6, 'confluence'), { name: 'Confluence', address: '', email: '', logo: '', logoOnLight: false, logoHatX: 0.5 });
  await assert.rejects(() => A.saveSettings(s6, 'confluence', { name: ' ' }, 'a'), /name is required/);
  await assert.rejects(() => A.saveSettings(s6, 'confluence', { name: 'X', email: 'nope' }, 'a'), /not valid/);
  await assert.rejects(() => A.saveSettings(s6, 'confluence', { name: 'X', logoId: 'abcdefabcdef12345678' }, 'a'), /logo was not found/);
  const logo1 = await A.saveImage(s6, 'confluence', png, now), logo2 = await A.saveImage(s6, 'confluence', jpg, now);
  let st = await A.saveSettings(s6, 'confluence', { name: '  The  Confluence ', address: '26 Belden Ave, Norwalk, CT', email: 'Office@Example.com', logoId: logo1.id, logoOnLight: true, logoHatX: 0.4567 }, 'admin@x.com', now);
  assert.deepStrictEqual(st, { name: 'The Confluence', address: '26 Belden Ave, Norwalk, CT', email: 'office@example.com', logo: '/api/image/' + logo1.id, logoOnLight: true, logoHatX: 0.46 });
  assert.deepStrictEqual(A.publicView(await s6.list('confluence'), now, 'confluence').building, st);
  assert.ok(!JSON.stringify(A.publicView(await s6.list('confluence'), now, 'confluence')).includes('admin@x.com'), 'who saved it is not public');
  st = await A.saveSettings(s6, 'confluence', { name: 'The Confluence', logoId: logo2.id }, 'a', now);
  assert.strictEqual(st.logoHatX, 0.5, 'a new logo without a measured top gets the middle');
  assert.ok(!s6.images.has(logo1.id) && s6.images.has(logo2.id), 'replacing the logo deletes the old file');
  await A.listOpen(s6, 'confluence', now + 30 * D);
  assert.ok(s6.images.has(logo2.id), 'the logo in use is never cleaned up as an unused upload');
  assert.strictEqual((await A.listOpen(s6, 'confluence', now)).length, 0, 'settings are not an announcement');
  st = await A.saveSettings(s6, 'confluence', { name: 'The Confluence', removeLogo: true }, 'a', now);
  assert.ok(st.logo === '' && !s6.images.has(logo2.id));
  assert.strictEqual(A.principal(Buffer.from(JSON.stringify({ userDetails: 'a', userRoles: ['admin'] })).toString('base64')).admin, true);
  assert.strictEqual(A.principal(Buffer.from(JSON.stringify({ userDetails: 'm', userRoles: ['manager'] })).toString('base64')).admin, false);

  // Sign-in header from Azure Static Web Apps.
  const hdr = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.deepStrictEqual(A.principal(hdr({ userDetails: 'm@x.com', userRoles: ['anonymous', 'authenticated', 'manager'] })).allowed, true);
  assert.strictEqual(A.principal(hdr({ userDetails: 'm@x.com', userRoles: ['anonymous', 'authenticated'] })).allowed, false);
  assert.strictEqual(A.principal('').allowed, false);
  assert.strictEqual(A.principal('not-base64-json').allowed, false);
  console.log('announcements tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
