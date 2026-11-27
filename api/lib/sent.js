// The record of what was sent to residents, and corrections ("errata") sent to everyone.
const crypto = require('crypto');
const { assertScreen } = require('./announcements');
const Mail = require('./mail');
const Push = require('./push');

const KEEP = 150;
const fail = (message) => { const e = new Error(message); e.code = 'invalid'; return e; };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const mailState = (mail) => !mail ? 'off' : mail.queued ? 'now' : mail.daily ? 'daily' : 'off';

// One line per thing sent: what, when, who published it and how many devices and residents it went to. Never who they are.
async function record(store, screen, item, result, user, now = Date.now()) {
  assertScreen(screen);
  const push = (result && result.push) || {}, mail = (result && result.mail) || null;
  const row = { screen, id: now.toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex'), itemId: String(item.id || ''), kind: String(item.kind || ''), title: clean(item.title, 120), text: clean(item.text, 500),
    ref: clean(item.ref, 40), by: clean(user, 120), at: new Date(now).toISOString(), pushSent: Number(push.sent) || 0, pushDevices: Number(push.devices) || 0, mail: mailState(mail), mailRecipients: Number(mail && mail.recipients) || 0 };
  await store.logPut(row);
  const all = (await store.logList(screen)).sort((a, b) => b.id.localeCompare(a.id));
  for (const old of all.slice(KEEP)) await store.logRemove(screen, old.id).catch(() => {});
  return row;
}
async function list(store, screen) {
  assertScreen(screen);
  return (await store.logList(screen)).sort((a, b) => b.id.localeCompare(a.id)).slice(0, KEEP)
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, text: r.text, ref: r.ref || '', by: r.by, at: r.at, pushSent: r.pushSent || 0, pushDevices: r.pushDevices || 0, mail: r.mail || 'off', mailRecipients: r.mailRecipients || 0 }));
}
// A correction goes out at once, by notification and (when email is set up) by email, and is added to the record.
// When it corrects an event announcement, residents who stopped event emails are left out, as with the original.
async function correction(store, screen, input, user, now = Date.now(), deps = {}) {
  assertScreen(screen);
  const title = clean(input && input.title, 80), text = clean(input && input.text, 500), ref = clean(input && input.ref, 40);
  if (!title) throw fail('Say what is being corrected');
  if (text.length < 5) throw fail('Write the correction');
  const original = ref ? (await store.logList(screen)).find((r) => r.id === ref) : null;
  if (ref && !original) throw fail('That message is no longer in the list');
  const item = { id: 'x' + now.toString(36) + crypto.randomBytes(3).toString('hex'), kind: 'correction', title, text, ref, optional: !!original && (original.kind === 'card' || original.kind === 'poster') };
  let push, mail;
  try { push = await (deps.push || Push.send)(store, screen, item); } catch (e) { push = { sent: 0, devices: 0, reason: 'error' }; }
  try { mail = await (deps.mail || Mail.queue)(store, screen, item, now); } catch (e) { mail = { queued: false, recipients: 0, reason: 'error' }; }
  const row = await record(store, screen, item, { push, mail }, user, now);
  return { sent: row, push, mail };
}
module.exports = { record, list, correction, KEEP };
