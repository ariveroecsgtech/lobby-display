// Announcements published by the building's community manager and shown in the screen's Community panel.
// All rules live here (what is valid, how many can be on air, what the screen receives) so they can be tested without Azure.
const crypto = require('crypto');

const SCREENS = { confluence: { name: 'Confluence', timeZone: 'America/New_York' } };
const LIMITS = { card: 5, poster: 3, emergency: 1 };
const DESIGNS = {              // poster designs the manager can pick
  coffee: { theme: 'coffee', icon: 'cup', label: 'Coffee social' },
  celebration: { theme: 'teal', icon: 'burst', label: 'Celebration' },
  movie: { theme: 'plum', icon: 'film', label: 'Movie night' },
  wellness: { theme: 'green', icon: 'leaf', label: 'Wellness' },
  notice: { theme: 'navy', icon: 'note', label: 'Notice' }
};
const MAX = { title: 40, text: 140, when: 32, where: 32 };
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
  return item;
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
      const d = DESIGNS[a.design] || DESIGNS.notice;
      return {
        id: a.id, kind: a.kind, featured: a.featured === true,
        theme: a.kind === 'poster' ? d.theme : 'navy', icon: a.kind === 'poster' ? d.icon : 'note',
        eyebrow: a.kind === 'poster' ? 'You are invited' : 'From the management office',
        title: a.title, text: a.text, tags: [a.whenText, a.whereText].filter(Boolean), when: a.whenText
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

module.exports = { SCREENS, LIMITS, DESIGNS, MAX, create, listOpen, end, publicView, principal, assertScreen };
