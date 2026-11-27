// Announcements published by the building's community manager and shown in the screen's Community panel.
// All rules live here (what is valid, how many can be on air, what the screen receives) so they can be tested without Azure.
const crypto = require('crypto');

// "places" is the starting list for the Where field; managers can add their own, which are saved per screen.
// "safety" holds the building's own evacuation details, shown on real emergency screens. They must come from the
// building's emergency plan: leave a field empty rather than guess. Only ECSG edits this.
const SCREENS = { confluence: { name: 'Confluence', timeZone: 'America/New_York',
  places: ['Party Room', 'Lobby', 'Leasing Office', 'Fitness Center', 'Rooftop Terrace', 'Courtyard'],
  safety: { route: '', assembly: '' },
  // Who emails to residents come from. "from" must be an address on a domain verified in Azure Communication Services.
  // replyTo is where a resident's reply goes (the building's office); empty means replies are not expected.
  mail: { from: 'notices@ecsgapps.com', name: 'Confluence Management Office', replyTo: '', site: 'https://display.ecsgapps.com' } } };
const PLACES_ROW = '_places', MAX_SAVED_PLACES = 20;
// How many announcements can be on air or scheduled at once: cards and posters share one total, so the manager
// decides the mix. A screen can set its own total with maxAnnouncements (only ECSG changes it).
const LIMITS = { total: 10, emergency: 1, notice: 3, drill: 5 };
// card, poster: Community panel. notice: a service notice in the strip under the clock, never blocks the screen.
// drill: a scheduled test that covers the screen for a set time. emergency: a real emergency, covers the screen in red.
const KINDS = ['card', 'poster', 'notice', 'drill', 'emergency'];
const ALERT_KINDS = ['notice', 'drill', 'emergency'];
const NOTICES = {
  water: { label: 'Water shut-off', title: 'Water shut-off', text: 'Water is off for repairs. We will update this screen when it is back.' },
  elevator: { label: 'Elevator out of service', title: 'Elevator out of service', text: 'Please use the other elevator or the stairs.' },
  weather: { label: 'Severe weather', title: 'Severe weather', text: 'Take care outside and allow extra travel time.' },
  power: { label: 'Power outage', title: 'Power outage', text: 'We are working to restore power.' },
  heat: { label: 'Heat or hot water', title: 'No hot water', text: 'Repairs are under way. We will update this screen when service is back.' },
  parking: { label: 'Garage or parking', title: 'Garage closed', text: 'Please use street parking until the garage reopens.' },
  internet: { label: 'Internet outage', title: 'Internet outage', text: 'The provider is working on it.' },
  other: { label: 'Other notice', title: '', text: '' }
};
// Real emergencies. "action" decides the screen: evacuate or shelter. The wording is a starting point the manager can edit,
// and should match the building's own emergency plan.
const EMERGENCIES = {
  fire: { label: 'Fire', action: 'evacuate', headline: 'EVACUATE NOW', title: 'Fire in the building', text: 'Leave now by the nearest stairs. Do not use the elevators.' },
  gas: { label: 'Gas leak', action: 'evacuate', headline: 'EVACUATE NOW', title: 'Gas leak', text: 'Leave now. Do not use elevators, light switches or open flames.' },
  bomb: { label: 'Bomb threat', action: 'evacuate', headline: 'EVACUATE NOW', title: 'Security threat', text: 'Leave the building now and move well away from it. Follow instructions from police.' },
  evacuate: { label: 'Evacuate (other)', action: 'evacuate', headline: 'EVACUATE NOW', title: 'Leave the building', text: 'Leave now by the nearest stairs. Do not use the elevators.' },
  threat: { label: 'Building under threat', action: 'shelter', headline: 'TAKE SHELTER', title: 'Danger in the building', text: 'Stay inside your apartment. Lock the door. Stay away from doors and windows.' },
  earthquake: { label: 'Earthquake', action: 'shelter', headline: 'DROP, COVER, HOLD ON', title: 'Earthquake', text: 'Get under sturdy furniture and hold on. Stay away from windows. Do not use the elevators.' },
  tornado: { label: 'Tornado', action: 'shelter', headline: 'TAKE SHELTER', title: 'Tornado warning', text: 'Go to an inside room on the lowest floor you can reach, away from windows.' },
  hurricane: { label: 'Hurricane or cyclone', action: 'shelter', headline: 'STAY INDOORS', title: 'Hurricane warning', text: 'Stay inside and away from windows. Follow official instructions.' },
  shelter: { label: 'Shelter in place (other)', action: 'shelter', headline: 'STAY INSIDE', title: 'Shelter in place', text: 'Stay inside until this screen says it is safe.' }
};
const DRILL_MAX_MS = 4 * 3600 * 1000;
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
  if (!KINDS.includes(kind)) throw fail('Unknown kind of announcement');
  const title = clean(input.title, MAX.title);
  if (!title) throw fail('A title is required');
  const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : now;
  const endsAt = new Date(input.endsAt).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw fail('Dates are not valid');
  if (endsAt <= now) throw fail('The end time has already passed');
  if (endsAt <= startsAt) throw fail('The end must be after the start');
  if (kind === 'emergency' && endsAt - now > EMERGENCY_MAX_MS) throw fail('An emergency alert can stay up for 24 hours at most');
  if (kind === 'emergency' && startsAt > now + 60000) throw fail('An emergency alert starts right away and cannot be scheduled');
  if (kind === 'drill' && endsAt - startsAt > DRILL_MAX_MS) throw fail('A test can cover the screen for 4 hours at most');
  const alert = ALERT_KINDS.includes(kind);
  // An emergency must say what it is: there is no default, so a mistake can never put "evacuate" on the screen.
  const type = kind === 'emergency' ? String(input.type || '') : kind === 'notice' ? String(input.type || 'other') : '';
  if (kind === 'emergency' && !EMERGENCIES[type]) throw fail('Choose the type of emergency');
  if (kind === 'notice' && !NOTICES[type]) throw fail('Choose the type of notice');
  if (endsAt - now > MAX_DAYS * 86400000) throw fail('Announcements can be scheduled up to ' + MAX_DAYS + ' days ahead');
  const imageId = kind === 'poster' && input.imageId ? String(input.imageId) : '';
  if (imageId && !IMAGE_ID.test(imageId)) throw fail('The image is not valid. Upload it again.');
  const design = kind === 'poster' && !imageId ? String(input.design || '') : '';
  if (kind === 'poster' && !imageId && !DESIGNS[design]) throw fail('Choose a poster design or upload an image');
  return {
    id: now.toString(36) + crypto.randomBytes(4).toString('hex'),
    kind, title,
    text: clean(input.text, MAX.text),
    whenText: alert ? '' : clean(input.whenText, MAX.when),
    timeText: alert ? '' : clean(input.timeText, MAX.time),
    whereText: alert ? '' : clean(input.whereText, MAX.where),
    design, imageId, type,
    featured: !alert && input.featured === true,
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
  const count = (k) => open.filter((a) => a.kind === k).length, regular = open.filter((a) => !ALERT_KINDS.includes(a.kind)).length;
  if (item.kind === 'emergency') {
    if (count('emergency') >= LIMITS.emergency) throw fail('An emergency alert is already on screen. Clear it first.', 'limit');
  } else if (item.kind === 'notice') {
    if (count('notice') >= LIMITS.notice) throw fail('The limit is ' + LIMITS.notice + ' service notices at a time. End one before adding another.', 'limit');
  } else if (item.kind === 'drill') {
    if (count('drill') >= LIMITS.drill) throw fail('The limit is ' + LIMITS.drill + ' scheduled tests. Cancel one before adding another.', 'limit');
    const s0 = new Date(item.startsAt).getTime(), e0 = new Date(item.endsAt).getTime();
    if (open.some((a) => a.kind === 'drill' && new Date(a.startsAt).getTime() < e0 && new Date(a.endsAt).getTime() > s0)) throw fail('Another test is already scheduled at that time.', 'limit');
    // The card that tells residents about the test ahead of time. It shares a group with the test, so cancelling one cancels both.
    if (input.announce === true && s0 > now + 5 * 60000) {
      if (regular >= totalFor(screen)) throw fail('The Community panel is full (' + totalFor(screen) + ' announcements). End one, or schedule the test without the announcement.', 'limit');
      item.group = item.id;
      await store.put({ ...build({ kind: 'card', title: item.title, text: clean(input.announceText, MAX.text) || item.text,
        whenText: input.whenText, timeText: input.timeText, endsAt: item.startsAt, featured: false }, user, now), screen, id: item.id + 'c', group: item.id });
    }
  } else if (regular >= totalFor(screen)) {
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
  const all = await store.list(screen), row = all.find((a) => a.id === id);
  // A scheduled test and the card announcing it go together.
  const together = row && row.group ? all.filter((a) => a.group === row.group) : row ? [row] : [];
  await store.remove(screen, id);
  for (const a of together) {
    if (a.id !== id) await store.remove(screen, a.id);
    if (a.imageId) await store.imageRemove(a.imageId).catch(() => {});
  }
}

// What the lobby screen receives: only what is live right now, with no author details.
function publicView(list, now = Date.now(), screen = '') {
  const live = list.filter((a) => isLive(a, now));
  const em = live.find((a) => a.kind === 'emergency'), dr = live.find((a) => a.kind === 'drill');
  const safety = (SCREENS[screen] && SCREENS[screen].safety) || {};
  const items = live.filter((a) => a.kind === 'card' || a.kind === 'poster')
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
  const type = em && (EMERGENCIES[em.type] || EMERGENCIES.evacuate);
  return {
    // a real emergency: red screen. Rows saved before emergency types existed are treated as a scheduled-style notice screen.
    emergency: em ? { id: em.id, type: em.type || '', action: em.type ? type.action : 'info', headline: em.type ? type.headline : '', title: em.title, text: em.text, until: em.endsAt,
      route: em.type && type.action === 'evacuate' ? String(safety.route || '') : '', assembly: em.type && type.action === 'evacuate' ? String(safety.assembly || '') : '' } : null,
    // a scheduled test: calm full-screen notice for its set time
    drill: dr ? { id: dr.id, title: dr.title, text: dr.text, until: dr.endsAt } : null,
    // service notices: shown in the strip under the clock, the rest of the screen stays visible
    notices: live.filter((a) => a.kind === 'notice').sort((a, b) => a.endsAt.localeCompare(b.endsAt)).map((a) => ({ id: a.id, type: a.type || 'other', title: a.title, text: a.text, until: a.endsAt })),
    items
  };
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

module.exports = { NOTICES, EMERGENCIES, ALERT_KINDS, totalFor, IMAGE, IMAGE_ID, sniffImage, saveImage, SCREENS, LIMITS, DESIGNS, MAX, create, listOpen, end, publicView, principal, assertScreen, getPlaces };
