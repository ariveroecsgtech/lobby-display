const assert = require('assert');
const R = require('../lib/residents');
const mem = () => { const rows = new Map(); return { rows,
  residentList: async (s) => [...rows.values()].filter((r) => r.screen === s).map((r) => ({ ...r })),
  residentPutMany: async (s, list) => { for (const r of list) rows.set(s + '/' + r.id, { ...r, screen: s }); },
  residentRemoveMany: async (s, ids) => { for (const id of ids) rows.delete(s + '/' + id); } }; };
(async () => {
  const s = mem();
  // One person at a time.
  let list = await R.add(s, 'confluence', { firstName: ' Ana ', lastName: 'Lopez', email: ' Ana.Lopez@Example.com ' }, 'm@x.com');
  assert.deepStrictEqual([list[0].firstName, list[0].lastName, list[0].email], ['Ana', 'Lopez', 'ana.lopez@example.com']);
  await assert.rejects(() => R.add(s, 'confluence', { firstName: 'A', lastName: 'B', email: 'ANA.LOPEZ@example.com' }, 'm'), /already on the list/);
  await assert.rejects(() => R.add(s, 'confluence', { firstName: 'A', lastName: 'B', email: 'not-an-email' }, 'm'), /not valid/);
  await assert.rejects(() => R.add(s, 'confluence', { firstName: 'A', lastName: 'B', email: 'a@b' }, 'm'), /not valid/);
  await assert.rejects(() => R.add(s, 'confluence', { firstName: 'A', email: 'x@y.com, z@y.com' }, 'm'), /not valid/, 'one address per person');
  await assert.rejects(() => R.add(s, 'confluence', { email: 'a@b.com' }, 'm'), /first or last name/);
  await assert.rejects(() => R.add(s, 'nowhere', { firstName: 'A', email: 'a@b.com' }, 'm'), (e) => e.code === 'unknown_screen');
  assert.ok(!('addedBy' in list[0]), 'who added a row stays on the server');

  // Import: a dry run changes nothing and says what would happen.
  const rows = [
    { firstName: 'Bruno', lastName: 'Diaz', email: 'bruno@example.com' },
    { firstName: 'Ana Maria', lastName: 'Lopez', email: 'ana.lopez@example.com' },       // already there, name changed
    { firstName: 'Carla', lastName: 'Abreu', email: 'carla@example' },                     // bad email
    { firstName: '', lastName: '', email: 'noname@example.com' },                          // no name
    { firstName: 'Bruno again', lastName: 'Diaz', email: 'BRUNO@example.com' },            // duplicate in the file
    { firstName: 'Zoe', lastName: '', email: 'zoe@example.com' },
    { firstName: 'Line\nbreak', lastName: '<b>Tag</b>', email: 'odd@example.com' }
  ];
  const dry = await R.importRows(s, 'confluence', rows, { dryRun: true });
  assert.deepStrictEqual([dry.summary.added, dry.summary.updated, dry.summary.removed, dry.summary.skippedCount, dry.summary.total], [3, 1, 0, 3, 4]);
  assert.deepStrictEqual(dry.summary.skipped.map((x) => [x.row, x.reason]), [[4, 'email is not valid'], [5, 'no name'], [6, 'same email as an earlier row']]);
  assert.strictEqual(s.rows.size, 1, 'a dry run saves nothing');
  // Add mode keeps people who are not in the file.
  await R.add(s, 'confluence', { firstName: 'Old', lastName: 'Timer', email: 'old@example.com' }, 'm');
  const done = await R.importRows(s, 'confluence', rows, { mode: 'add', user: 'm@x.com' });
  assert.deepStrictEqual(done.residents.map((r) => r.lastName || r.firstName), ['<b>Tag</b>', 'Diaz', 'Lopez', 'Timer', 'Zoe'], 'sorted by last name; text is stored as text');
  assert.strictEqual(done.residents.find((r) => r.email === 'ana.lopez@example.com').firstName, 'Ana Maria');
  assert.strictEqual(done.residents.find((r) => r.email === 'odd@example.com').firstName, 'Line break');
  // Replace mode makes the file the whole list.
  const rep = await R.importRows(s, 'confluence', [{ firstName: 'Bruno', lastName: 'Diaz', email: 'bruno@example.com' }, { firstName: 'New', lastName: 'Person', email: 'new@example.com' }], { mode: 'replace' });
  assert.deepStrictEqual([rep.summary.added, rep.summary.removed, rep.summary.unchanged, rep.residents.length], [1, 4, 1, 2]);
  await assert.rejects(() => R.importRows(s, 'confluence', [], {}), /no residents/);
  await assert.rejects(() => R.importRows(s, 'confluence', [{ firstName: 'x', email: 'bad' }], {}), /No row has a valid email/);
  await assert.rejects(() => R.importRows(s, 'confluence', rows, { mode: 'wipe' }), /add or replace/);
  await assert.rejects(() => R.importRows(s, 'confluence', new Array(R.MAX.importRows + 1).fill({ firstName: 'a', email: 'a@b.com' }), {}), /more than/);
  // Remove one.
  list = await R.remove(s, 'confluence', rep.residents[0].id);
  assert.strictEqual(list.length, 1);
  await assert.rejects(() => R.remove(s, 'confluence', "x' or 1"), /Unknown resident/);
  console.log('residents tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
