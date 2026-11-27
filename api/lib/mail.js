// Emails to residents: every announcement or alert is sent once, to everyone on the building's list.
// Sending is paced, because Azure Communication Services starts every account at 30 emails a minute and 100 an hour:
// a message is queued in the outbox and goes out a few recipients at a time, each time a lobby screen checks in.
const crypto = require('crypto');
const { SCREENS, EMERGENCIES, assertScreen } = require('./announcements');

const PER_TURN = Number(process.env.MAIL_PER_TURN) || 6;        // recipients sent each time a screen checks in
const TURN_GAP_MS = Number(process.env.MAIL_TURN_GAP_MS) || 14000;
const PER_HOUR = Number(process.env.MAIL_PER_HOUR) || 90;       // stays under the default 100 an hour; raise it when Azure raises the quota
const RATE_ROW = '_rate';
const configured = () => !!process.env.ACS_CONNECTION;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Unsubscribe links are signed, so nobody can unsubscribe someone else by guessing a link.
const secret = () => crypto.createHash('sha256').update('unsubscribe:' + (process.env.STORAGE_CONNECTION || process.env.MAIL_TEST_SECRET || '')).digest();
const sign = (screen, residentId) => crypto.createHmac('sha256', secret()).update(screen + '/' + residentId).digest('hex').slice(0, 32);
const verify = (screen, residentId, token) => { const good = sign(screen, residentId), t = String(token || ''); return t.length === good.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good)); };

const fmt = (iso, timeZone, opts) => new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(new Date(iso));
// The words of the email for one announcement. Plain and short; the same for everyone except the unsubscribe link.
function compose(item, screen) {
  const b = assertScreen(screen), tz = b.timeZone || 'UTC', building = b.name;
  const when = [item.whenText, item.timeText].filter(Boolean).join(', '), lines = [];
  let subject, heading = item.title, optional = false;
  if (item.kind === 'emergency') {
    const t = EMERGENCIES[item.type] || {};
    subject = 'EMERGENCY at ' + building + ': ' + item.title; heading = (t.headline ? t.headline + '. ' : '') + item.title;
    if (item.text) lines.push(item.text);
    lines.push('In immediate danger, call 911. Follow instructions from emergency responders.');
    lines.push('This email may arrive late. It does not replace the building alarm.');
  } else if (item.kind === 'drill') {
    const day = fmt(item.startsAt, tz, { weekday: 'long', month: 'long', day: 'numeric' }), from = fmt(item.startsAt, tz, { hour: 'numeric', minute: '2-digit' }), to = fmt(item.endsAt, tz, { hour: 'numeric', minute: '2-digit' });
    subject = building + ': ' + item.title + ' on ' + fmt(item.startsAt, tz, { weekday: 'short', month: 'short', day: 'numeric' });
    lines.push(day + ', ' + from + ' to ' + to + '.'); if (item.text) lines.push(item.text);
  } else if (item.kind === 'notice') {
    subject = building + ' notice: ' + item.title;
    if (item.text) lines.push(item.text);
    lines.push('In effect until ' + fmt(item.endsAt, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.');
  } else {
    optional = true;
    subject = building + ': ' + item.title + (item.whenText ? ', ' + item.whenText : '');
    if (when) lines.push(when + (item.whereText ? ' · ' + item.whereText : '') + '.'); else if (item.whereText) lines.push(item.whereText + '.');
    if (item.text) lines.push(item.text);
  }
  return { subject: subject.slice(0, 150), heading, lines, optional, building, from: b.mail || {} };
}
function render(msg, screen, resident) {
  const site = (msg.from.site || '').replace(/\/$/, '');
  const link = site + '/api/unsubscribe?s=' + encodeURIComponent(screen) + '&r=' + resident.id + '&t=' + sign(screen, resident.id);
  const foot = 'You get this because you are on the resident list of ' + msg.building + '.' + (msg.optional ? '' : ' Safety and service notices go to every resident.');
  const list = msg.list || [];
  const text = [msg.heading, '', ...msg.lines, ...list.flatMap((x) => [x.title, x.body, '']), '', (msg.from.name || msg.building), '', foot, 'Stop event announcements: ' + link].join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">' +
    '<h1 style="font-size:22px;margin:0 0 12px">' + esc(msg.heading) + '</h1>' + msg.lines.map((l) => '<p style="margin:0 0 10px">' + esc(l) + '</p>').join('') +
    list.map((x) => '<p style="margin:0 0 14px"><b>' + esc(x.title) + '</b><br>' + esc(x.body) + '</p>').join('') +
    '<p style="margin:18px 0 0;font-weight:bold">' + esc(msg.from.name || msg.building) + '</p>' +
    '<p style="margin:22px 0 0;font-size:12px;color:#666">' + esc(foot) + ' <a href="' + esc(link) + '" style="color:#666">Stop event announcements</a></p></div>';
  return { text, html };
}

// The daily email: every card and poster published since the last one, in a single message.
function composeDigest(items, screen) {
  const b = assertScreen(screen), lines = [];
  for (const it of items) {
    const where = [[it.whenText, it.timeText].filter(Boolean).join(', '), it.whereText].filter(Boolean).join(' · ');
    lines.push({ title: it.title, body: [where, it.text].filter(Boolean).join('. ').replace(/\.\./g, '.') });
  }
  const subject = items.length === 1 ? b.name + ': ' + items[0].title + (items[0].whenText ? ', ' + items[0].whenText : '') : b.name + ': ' + items.length + ' new announcements';
  return { subject: subject.slice(0, 150), heading: items.length === 1 ? items[0].title : 'New at ' + b.name, lines: items.length === 1 ? [lines[0].body].filter(Boolean) : [], list: items.length === 1 ? [] : lines, optional: true, building: b.name, from: b.mail || {} };
}
const localParts = (now, timeZone) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour) }; };
const DIGEST_ROW = '_digest';
// Once a day, at the building's digest hour, gather what is waiting and queue one email. Returns the number of announcements in it.
async function digest(store, screen, now = Date.now(), rows = null) {
  if (!configured()) return 0;
  const b = assertScreen(screen), cfg = b.mail || {}, at = localParts(now, b.timeZone || 'UTC');
  if (at.hour < (cfg.digestHour == null ? 18 : cfg.digestHour)) return 0;
  rows = rows || await store.outboxList(screen);
  const mark = rows.find((r) => r.id === DIGEST_ROW);
  if (mark && mark.lastDay === at.day) return 0;
  const waiting = (await store.list(screen)).filter((a) => a.mailPending === true && (a.kind === 'card' || a.kind === 'poster') && new Date(a.endsAt).getTime() > now)
    .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  if (!waiting.length) return 0;                        // nothing to say today: no email, and a later announcement today can still go out
  if (!(await store.outboxClaim(screen, { screen, id: DIGEST_ROW, lastDay: at.day }, mark && mark.etag))) return 0;
  const msg = composeDigest(waiting, screen);
  const people = (await store.residentList(screen)).filter((r) => r.email && r.unsub !== true);
  if (people.length) await store.outboxPut({ screen, id: 'g' + at.day, itemId: 'digest-' + at.day, urgent: false, msg: JSON.stringify(msg), cursor: '', sent: 0, total: people.length, createdAt: new Date(now).toISOString() });
  for (const a of waiting) await store.put({ ...a, mailPending: false, mailedAt: new Date(now).toISOString() });
  return waiting.length;
}

// Put a message in the outbox. Returns how many residents it will go to (0 when email is off or the list is empty).
async function queue(store, screen, item, now = Date.now()) {
  if (!configured()) return { queued: false, recipients: 0, reason: 'not_configured' };
  const msg = compose(item, screen);
  const people = (await store.residentList(screen)).filter((r) => r.email && !(msg.optional && r.unsub === true));
  if (!people.length) return { queued: false, recipients: 0, reason: 'no_residents' };
  await store.outboxPut({ screen, id: 'm' + item.id, itemId: item.id, urgent: item.kind === 'emergency', msg: JSON.stringify(msg), cursor: '', sent: 0, total: people.length, createdAt: new Date(now).toISOString() });
  return { queued: true, recipients: people.length };
}

// Send the next few. Called whenever a screen checks in; safe to call from several places at once.
async function drain(store, screen, { now = Date.now(), send } = {}) {
  if (!configured() && !send) return { sent: 0 };
  let rows = await store.outboxList(screen);
  if (configured() && await digest(store, screen, now, rows)) rows = await store.outboxList(screen);
  const jobs = rows.filter((r) => r.id !== RATE_ROW && r.id !== DIGEST_ROW).sort((a, b) => (b.urgent === true) - (a.urgent === true) || String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!jobs.length) return { sent: 0 };
  const rate = rows.find((r) => r.id === RATE_ROW) || { screen, id: RATE_ROW, last: 0, hourStart: 0, hourCount: 0 };
  if (now - Number(rate.last) < TURN_GAP_MS) return { sent: 0, waiting: 'turn' };
  const hourStart = now - Number(rate.hourStart) >= 3600000 ? now : Number(rate.hourStart), hourCount = hourStart === now ? 0 : Number(rate.hourCount);
  const budget = Math.min(PER_TURN, PER_HOUR - hourCount);
  if (budget <= 0) return { sent: 0, waiting: 'hour' };
  const job = jobs[0], msg = JSON.parse(job.msg);
  const people = (await store.residentList(screen)).filter((r) => r.email && !(msg.optional && r.unsub === true) && r.id > String(job.cursor || '')).sort((a, b) => a.id.localeCompare(b.id)).slice(0, budget);
  // Claim the turn before sending, counting these recipients, so two callers can never send the same people twice.
  const claimed = await store.outboxClaim(screen, { screen, id: RATE_ROW, last: now, hourStart, hourCount: hourCount + people.length }, rate.etag);
  if (!claimed) return { sent: 0, waiting: 'other' };
  if (!people.length) { await store.outboxRemove(screen, job.id); return { sent: 0, finished: job.itemId }; }
  const sender = send || acsSend;
  let sent = 0, cursor = job.cursor || '';
  for (const r of people) {
    try { await sender({ from: msg.from, to: r, subject: msg.subject, ...render(msg, screen, r) }); sent++; }
    catch (e) { if (e.statusCode === 429) break; /* throttled: stop and try this person again next turn */ }
    cursor = r.id;                                      // a failed address is skipped rather than blocking everyone behind it
  }
  await store.outboxPut({ ...job, cursor, sent: Number(job.sent || 0) + sent });
  return { sent, job: job.itemId };
}

let client = null;
async function acsSend({ from, to, subject, text, html }) {
  const { EmailClient } = require('@azure/communication-email');
  client = client || new EmailClient(process.env.ACS_CONNECTION);
  await client.beginSend({
    senderAddress: from.from,
    content: { subject, plainText: text, html },
    recipients: { to: [{ address: to.email, displayName: [to.firstName, to.lastName].filter(Boolean).join(' ') }] },
    replyTo: from.replyTo ? [{ address: from.replyTo }] : undefined
  });
}

async function unsubscribe(store, screen, residentId, token) {
  assertScreen(screen);
  if (!/^[a-f0-9]{32}$/.test(String(residentId)) || !verify(screen, residentId, token)) return false;
  const row = (await store.residentList(screen)).find((r) => r.id === residentId);
  if (!row) return true;                               // already gone from the list: nothing more to stop
  await store.residentPutMany(screen, [{ ...row, unsub: true }]);
  return true;
}

module.exports = { digest, composeDigest, configured, compose, render, queue, drain, unsubscribe, sign, verify, PER_HOUR, PER_TURN };
