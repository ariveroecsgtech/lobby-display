// Announcements published by the building's community manager and shown in the screen's Community panel.
// All rules live here (what is valid, how many can be on air, what the screen receives) so they can be tested without Azure.
const crypto = require('crypto');

// "places" is the starting list for the Where field; managers can add their own, which are saved per screen.
const SCREENS = { confluence: { name: 'Confluence', timeZone: 'America/New_York',
  places: ['Party Room', 'Lobby', 'Leasing Office', 'Fitness Center', 'Rooftop Terrace', 'Courtyard'] } };
const PLACES_ROW = '_places', MAX_SAVED_PLACES = 20;
const LIMITS = { card: 5, poster: 3, emergency: 1 };
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
  if (!LIMITS[kind]) throw fail('Choose card, poster or emergency');
  const title = clean(input.title, MAX.title);
  if (!title) throw fail('A title is required');
  const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : now;
  const endsAt = new Date(input.endsAt).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw fail('Dates are not valid');
  if (endsAt <= now) throw fail('The end time has already passed');
  if (endsAt <= startsAt) throw fail('The end must be after the start');
  if (kind === 'emergency' && endsAt - now > EMERGENCY_MAX_MS) throw fail('An emergency alert can stay up for 24 hours at most');
  if (endsAt - now > MAX_DAYS * 86400000) throw fail('Announcements can be scheduled up to ' + MAX_DAYS + ' days ahead');
  const design = kind === 'poster' ? String(input.design || '') : '';
  if (kind === 'poster' && !DESIGNS[design]) throw fail('Choose a poster design');
  return {
    id: now.toString(36) + crypto.randomBytes(4).toString('hex'),
    kind, title,
    text: clean(input.text, MAX.text),
    whenText: kind === 'emergency' ? '' : clean(input.whenText, MAX.when),
    timeText: kind === 'emergency' ? '' : clean(input.timeText, MAX.time),
    whereText: kind === 'emergency' ? '' : clean(input.whereText, MAX.where),
    design,
    featured: kind === 'card' && input.featured === true,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdBy: clean(user, 120),
    createdAt: new Date(now).toISOString()
  };
}

async function create(store, screen, input, user, now = Date.now()) {
  assertScreen(screen);
  const item = { ...build(input || {}, user, now), screen };
  const open = (await store.list(screen)).filter((a) => a.kind === item.kind && isOpen(a, now));
  if (open.length >= LIMITS[item.kind]) {
    throw fail(item.kind === 'emergency' ? 'An emergency alert is already on screen. Clear it first.'
      : 'The limit is ' + LIMITS[item.kind] + ' ' + item.kind + 's at a time. End one before adding another.', 'limit');
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
  return all.filter((a) => isOpen(a, now)).sort((a, b) => a.endsAt.localeCompare(b.endsAt))
    .map((a) => ({ ...a, live: isLive(a, now) }));
}

async function end(store, screen, id) {
  assertScreen(screen);
  if (!/^[a-z0-9]{6,40}$/.test(String(id))) throw fail('Unknown announcement');
  await store.remove(screen, id);
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
        design: a.kind === 'poster' ? (DESIGNS[a.design] ? a.design : 'notice') : '', theme: 'navy', icon: 'note',
        eyebrow: a.kind === 'poster' && (DESIGNS[a.design] || {}).cat !== 'Building' ? 'You are invited' : 'From the management office',
        title: a.title, text: a.text, tags: [a.whenText, a.timeText, a.whereText].filter(Boolean), when: a.whenText || a.timeText || ''
      };
    });
  return { emergency: emergency ? { title: emergency.title, text: emergency.text, until: emergency.endsAt } : null, items };
}

// The signed-in person, as Azure Static Web Apps passes it to the API.
function principal(headerValue) {
  try {
    const p = JSON.parse(Buffer.from(String(headerValue || ''), 'base64').toString('utf8'));
    const roles = Array.isArray(p.userRoles) ? p.userRoles : [];
    return { user: String(p.userDetails || ''), roles, allowed: roles.includes('manager') || roles.includes('admin') };
  } catch (e) { return { user: '', roles: [], allowed: false }; }
}

module.exports = { SCREENS, LIMITS, DESIGNS, MAX, create, listOpen, end, publicView, principal, assertScreen, getPlaces };
