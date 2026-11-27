// Residents of a building: first name, last name and email, kept so announcements and alerts can be emailed to them.
// This is personal data. It is only reachable through the manager endpoints, never through the public screen API,
// and only these three fields are kept.
const crypto = require('crypto');
const { assertScreen } = require('./announcements');

const MAX = { name: 60, email: 120, residents: 3000, importRows: 3000 };
const EMAIL = /^[^\s@<>(),;:"']+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const fail = (message, code = 'invalid') => { const e = new Error(message); e.code = code; return e; };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const idFor = (email) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);   // one row per email address

// One person from a form or a file row. Returns { ok, resident } or { ok: false, reason }.
function parse(input) {
  const email = clean(input && input.email, MAX.email + 1).toLowerCase();
  const firstName = clean(input && input.firstName, MAX.name), lastName = clean(input && input.lastName, MAX.name);
  if (!email) return { ok: false, reason: 'no email' };
  if (email.length > MAX.email || !EMAIL.test(email)) return { ok: false, reason: 'email is not valid' };
  if (!firstName && !lastName) return { ok: false, reason: 'no name' };
  return { ok: true, resident: { id: idFor(email), firstName, lastName, email } };
}
const sorted = (rows) => rows.slice().sort((a, b) => (a.lastName || a.firstName).localeCompare(b.lastName || b.firstName, 'en', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }) || a.email.localeCompare(b.email));
const view = (r) => ({ id: r.id, firstName: r.firstName || '', lastName: r.lastName || '', email: r.email || '', addedAt: r.addedAt || '' });

async function list(store, screen) {
  assertScreen(screen);
  return sorted((await store.residentList(screen)).map(view));
}
async function add(store, screen, input, user, now = Date.now()) {
  assertScreen(screen);
  const p = parse(input);
  if (!p.ok) throw fail(p.reason === 'no name' ? 'Enter a first or last name.' : p.reason === 'no email' ? 'Enter an email address.' : 'That email address is not valid.');
  const all = await store.residentList(screen);
  if (all.some((r) => r.id === p.resident.id)) throw fail('That email address is already on the list.');
  if (all.length >= MAX.residents) throw fail('The list is full (' + MAX.residents + ' residents).', 'limit');
  await store.residentPutMany(screen, [{ ...p.resident, addedAt: new Date(now).toISOString(), addedBy: clean(user, 120) }]);
  return list(store, screen);
}
async function remove(store, screen, id) {
  assertScreen(screen);
  if (!/^[a-f0-9]{32}$/.test(String(id))) throw fail('Unknown resident');
  await store.residentRemoveMany(screen, [id]);
  return list(store, screen);
}
// Import from a file. mode "add" keeps the current list and adds or updates by email; mode "replace" makes the file the whole list.
// With dryRun nothing is saved: the result tells the manager what would happen.
async function importRows(store, screen, rows, { mode = 'add', dryRun = false, user = '', now = Date.now() } = {}) {
  assertScreen(screen);
  if (!Array.isArray(rows) || !rows.length) throw fail('The file has no residents.');
  if (rows.length > MAX.importRows) throw fail('The file has more than ' + MAX.importRows + ' rows.');
  if (mode !== 'add' && mode !== 'replace') throw fail('Choose add or replace.');
  const good = new Map(), skipped = [];
  rows.forEach((row, i) => {
    const p = parse(row);
    if (!p.ok) skipped.push({ row: i + 2, reason: p.reason });                 // +2: row 1 of the file is the header
    else if (good.has(p.resident.id)) skipped.push({ row: i + 2, reason: 'same email as an earlier row' });
    else good.set(p.resident.id, p.resident);
  });
  if (!good.size) throw fail('No row has a valid email and a name. Check that the columns are First name, Last name and Email.');
  const current = await store.residentList(screen), have = new Map(current.map((r) => [r.id, r]));
  const added = [...good.values()].filter((r) => !have.has(r.id));
  const updated = [...good.values()].filter((r) => have.has(r.id) && (have.get(r.id).firstName !== r.firstName || have.get(r.id).lastName !== r.lastName));
  const removed = mode === 'replace' ? current.filter((r) => !good.has(r.id)) : [];
  const total = current.length + added.length - removed.length;
  if (total > MAX.residents) throw fail('That would make ' + total + ' residents. The limit is ' + MAX.residents + '.', 'limit');
  const summary = { mode, rows: rows.length, added: added.length, updated: updated.length, unchanged: good.size - added.length - updated.length, removed: removed.length, skipped: skipped.slice(0, 50), skippedCount: skipped.length, total };
  if (dryRun) return { summary };
  const stamp = { addedAt: new Date(now).toISOString(), addedBy: clean(user, 120) };
  await store.residentPutMany(screen, [...added.map((r) => ({ ...r, ...stamp })), ...updated.map((r) => ({ ...have.get(r.id), ...r }))]);
  if (removed.length) await store.residentRemoveMany(screen, removed.map((r) => r.id));
  return { summary, residents: await list(store, screen) };
}

module.exports = { MAX, parse, list, add, remove, importRows };
