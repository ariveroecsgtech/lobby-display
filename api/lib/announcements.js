// Announcements published by the building's community manager and shown in the screen's Community panel.
// All rules live here (what is valid, how many can be on air, what the screen receives) so they can be tested without Azure.
const crypto = require('crypto');

// "places" is the starting list for the Where field; managers can add their own, which are saved per screen.
const SCREENS = { confluence: { name: 'Confluence', timeZone: 'America/New_York',
  places: ['Party Room', 'Lobby', 'Leasing Office', 'Fitness Center', 'Rooftop Terrace', 'Courtyard'] } };
const PLACES_ROW = '_places', MAX_SAVED_PLACES = 20;
// How many announcements can be on air or scheduled at once: cards and posters share one total, so the manager
// decides the mix. A screen can set its own total with maxAnnouncements (only ECSG changes it).
const LIMITS = { total: 10, emergency: 1 };
const KINDS = ['card', 'poster', 'emergency'];
const totalFor = (screen) => (SCREENS[screen] && SCREENS[screen].maxAnnouncements) || LIMITS.total;
// Poster templates the manager can pick. The artwork and colors live in /templates.js; the keys must match.
const DESIGNS = {
  coffee: { label: 'Coffee social', cat: 'Social' }, pizza: { label: 'Pizza night', cat: 'Social' },
  happyhour: { label: 'Happy hour', cat: 'Social' }, movie: { label: 'Movie night', cat: 'Social' },
  gamenight: { label: 'Game night', cat: 'Social' }, music: { label: 'Live music', cat: 'Social' },
  celebration: { label: 'Celebration', cat: 'Seasonal' }, holiday: { label: 'Winter holiday', cat: 'Seasonal' },
  summer: { label: 'Summer party', cat: 'Seasonal' },
  wellness: { label: 'Yoga & wellness', cat: 'Wellness' }, fitness: { label: 'Fitness class', cat: 'Wellness' },
  kids: { label: 'Kids & family', cat: 'Family & pets' }, pets: { label: 'Pet meetup', cat: 'Family & pets' },
  market: { label: 'Market day', cat: 'Family & pets' },
  notice: { label: 'Notice', cat: 'Building' }, maintenance: { label: 'Maintenance', cat: 'Building' }
};
const MAX = { title: 40, text: 140, when: 24, time: 24, where: 32 };
const MAX_DAYS = 60;
// Uploaded poster images. The manager page shrinks them before sending, so what arrives here is already small.
const IMAGE = { maxBytes: 1.5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'],
  // what the manager is told: checked in the browser before the image is resized
  // below softBelow the image is still accepted and enlarged, with a note that it may look soft
  rules: { formats: 'JPG, PNG or WebP', maxOriginalMB: 8, minWidth: 200, minHeight: 200, softBelow: 600, recommended: '1200 x 1200 px or larger' } };
const IMAGE_ID = /^[a-z0-9]{12,40}$/;
const EMERGENCY_MAX_MS = 24 * 3600 * 1000;

const fail = (message, code = 'invalid') => { const e = new Error(message); e.code = code; return e; };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function assertScreen(screen) {
  if (!Object.prototype.hasOwnProperty.call(SCREENS, screen)) throw fail('Unknown screen: ' + screen, 'unknown_screen');
  return SCREENS[screen];
}
const isLive = (a, now) => new Date(a.startsAt).getTime() <= now && new Date(a.endsAt).getTime() > now;
const isOpen = (a, now) => new Date(a.endsAt).getTime() > now;      // on air now or scheduled for later

function build(input, user, now) {
  const kind = String(input.kind || '');
  if (!KINDS.includes(kind)) throw fail('Choose card, poster or emergency');
  const title = clean(input.title, MAX.title);
  if (!title) throw fail('A title is required');
  const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : now;
  const endsAt = new Date(input.endsAt).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw fail('Dates are not valid');
  if (endsAt <= now) throw fail('The end time has already passed');
  if (endsAt <= startsAt) throw fail('The end must be after the start');
  if (kind === 'emergency' && endsAt - now > EMERGENCY_MAX_MS) throw fail('An emergency alert can stay up for 24 hours at most');
  if (endsAt - now > MAX_DAYS * 86400000) throw fail('Announcements can be scheduled up to ' + MAX_DAYS + ' days ahead');
  const imageId = kind === 'poster' && input.imageId ? String(input.imageId) : '';
  if (imageId && !IMAGE_ID.test(imageId)) throw fail('The image is not valid. Upload it again.');
  const design = kind === 'poster' && !imageId ? String(input.design || '') : '';
  if (kind === 'poster' && !imageId && !DESIGNS[design]) throw fail('Choose a poster design or upload an image');
  return {
    id: now.toString(36) + crypto.randomBytes(4).toString('hex'),
    kind, title,
    text: clean(input.text, MAX.text),
    whenText: kind === 'emergency' ? '' : clean(input.whenText, MAX.when),
    timeText: kind === 'emergency' ? '' : clean(input.timeText, MAX.time),
    whereText: kind === 'emergency' ? '' : clean(input.whereText, MAX.where),
    design, imageId,
    featured: kind !== 'emergency' && input.featured === true,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdBy: clean(user, 120),
    createdAt: new Date(now).toISOString()
  };
}

async function create(store, screen, input, user, now = Date.now()) {
  assertScreen(screen);
  const item = { ...build(input || {}, user, now), screen };
  if (item.imageId && !(await store.imageExists(item.imageId))) throw fail('The image was not found. Upload it again.');
  const open = (await store.list(screen)).filter((a) => KINDS.includes(a.kind) && isOpen(a, now));
  if (item.kind === 'emergency') {
    if (open.filter((a) => a.kind === 'emergency').length >= LIMITS.emergency) throw fail('An emergency alert is already on screen. Clear it first.', 'limit');
  } else if (open.filter((a) => a.kind !== 'emergency').length >= totalFor(screen)) {
    throw fail('The limit is ' + totalFor(screen) + ' announcements at a time. End one before adding another.', 'limit');
  }
  await store.put(item);
  if (input.savePlace === true && item.whereText) await addPlace(store, screen, item.whereText);
  return item;
}

// Places for the Where field: the screen's starting list plus the ones managers added.
async function getPlaces(store, screen) {
  const base = assertScreen(screen).places || [];
  const row = (await store.list(screen)).find((r) => r.id === PLACES_ROW);
  let saved = []; try { saved = JSON.parse((row && row.list) || '[]'); } catch (e) { saved = []; }
  const seen = new Set(), out = [];
  for (const p of [...base, ...saved]) { const k = String(p).toLowerCase(); if (p && !seen.has(k)) { seen.add(k); out.push(String(p)); } }
  return out;
}
async function addPlace(store, screen, place) {
  const name = clean(place, MAX.where);
  const all = await getPlaces(store, screen), base = assertScreen(screen).places || [];
  if (!name || all.some((p) => p.toLowerCase() === name.toLowerCase())) return;
  const saved = all.filter((p) => !base.includes(p)).concat(name).slice(-MAX_SAVED_PLACES);
  await store.put({ screen, id: PLACES_ROW, kind: '_meta', list: JSON.stringify(saved) });
}

// What the manager sees: everything still on air or scheduled, soonest to end first. Expired rows are cleaned up on the way.
async function listOpen(store, screen, now = Date.now()) {
  assertScreen(screen);
  const all = await store.list(screen);
  const stale = all.filter((a) => new Date(a.endsAt).getTime() < now - 7 * 86400000);
  await Promise.all(stale.map((a) => store.remove(screen, a.id).catch(() => {})));
  // Images nobody uses any more: their announcement expired, or they were uploaded a day ago and never published.
  try {
    const used = new Set(all.filter((a) => !stale.includes(a)).map((a) => a.imageId).filter(Boolean));
    const unused = (await store.imageList()).filter((i) => !used.has(i.id) && i.createdAt < now - 86400000);
    await Promise.all(unused.map((i) => store.imageRemove(i.id).catch(() => {})));
  } catch (e) { /* cleanup is best effort */ }
  return all.filter((a) => isOpen(a, now)).sort((a, b) => a.endsAt.localeCompare(b.endsAt))
    .map((a) => ({ ...a, live: isLive(a, now) }));
}

async function end(store, screen, id) {
  assertScreen(screen);
  if (!/^[a-z0-9]{6,40}$/.test(String(id))) throw fail('Unknown announcement');
  const row = (await store.list(screen)).find((a) => a.id === id);
  await store.remove(screen, id);
  if (row && row.imageId) await store.imageRemove(row.imageId).catch(() => {});
}

// What the lobby screen receives: only what is live right now, with no author details.
function publicView(list, now = Date.now()) {
  const live = list.filter((a) => isLive(a, now));
  const emergency = live.find((a) => a.kind === 'emergency');
  const items = live.filter((a) => a.kind !== 'emergency')
    .sort((a, b) => (b.featured === true) - (a.featured === true) || a.endsAt.localeCompare(b.endsAt))
    .map((a) => {
      return {
        id: a.id, kind: a.kind, featured: a.featured === true,
        design: a.kind === 'poster' && !a.imageId ? (DESIGNS[a.design] ? a.design : 'notice') : '', theme: 'navy', icon: 'note',
        image: a.kind === 'poster' && a.imageId ? '/api/image/' + a.imageId : '',
        eyebrow: a.kind === 'poster' && (DESIGNS[a.design] || {}).cat !== 'Building' ? 'You are invited' : 'From the management office',
        title: a.title, text: a.text, tags: [a.whenText, a.timeText, a.whereText].filter(Boolean), when: a.whenText || a.timeText || ''
      };
    });
  return { emergency: emergency ? { title: emergency.title, text: emergency.text, until: emergency.endsAt } : null, items };
}

// An uploaded image is accepted only if its first bytes really are a JPEG, PNG or WebP, whatever the browser claimed.
function sniffImage(bytes) {
  const b = bytes || [];
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
async function saveImage(store, screen, bytes, now = Date.now()) {
  assertScreen(screen);
  if (!bytes || !bytes.length) throw fail('No image was received');
  if (bytes.length > IMAGE.maxBytes) throw fail('The image is too large');
  const type = sniffImage(bytes);
  if (!type) throw fail('Only JPG, PNG or WebP images are accepted');
  const id = now.toString(36) + crypto.randomBytes(8).toString('hex');
  await store.imagePut(id, bytes, type, screen);
  return { id, type, bytes: bytes.length };
}

// The signed-in person, as Azure Static Web Apps passes it to the API.
function principal(headerValue) {
  try {
    const p = JSON.parse(Buffer.from(String(headerValue || ''), 'base64').toString('utf8'));
    const roles = Array.isArray(p.userRoles) ? p.userRoles : [];
    return { user: String(p.userDetails || ''), roles, allowed: roles.includes('manager') || roles.includes('admin') };
  } catch (e) { return { user: '', roles: [], allowed: false }; }
}

module.exports = { totalFor, IMAGE, IMAGE_ID, sniffImage, saveImage, SCREENS, LIMITS, DESIGNS, MAX, create, listOpen, end, publicView, principal, assertScreen, getPlaces };
