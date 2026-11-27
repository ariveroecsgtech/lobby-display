const { app } = require('@azure/functions');
const store = require('../../lib/store');
const A = require('../../lib/announcements');
const { _clearCache } = require('./community');
const Mail = require('../../lib/mail');

// Manager endpoints. Azure Static Web Apps only lets signed-in people with the "manager" or "admin" role reach
// /api/manage/* (see staticwebapp.config.json); the role is checked again here so a config mistake cannot open them.
function guard(request) {
  const p = A.principal(request.headers.get('x-ms-client-principal'));
  return p.allowed ? p : null;
}
const problem = (err, context) => {
  if (err.code === 'invalid' || err.code === 'limit') return { status: 400, jsonBody: { error: err.message } };
  if (err.code === 'unknown_screen') return { status: 404, jsonBody: { error: 'Unknown screen' } };
  if (err.code === 'not_configured') return { status: 503, jsonBody: { error: 'Storage is not connected yet' } };
  context.error('manage failed', err);
  return { status: 500, jsonBody: { error: 'Something went wrong. Try again.' } };
};
const screenOf = (request) => (request.query.get('screen') || '').slice(0, 40);

app.http('manageList', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'manage/announcements',
  handler: async (request, context) => {
    const p = guard(request);
    if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    const screen = screenOf(request);
    try {
      let mail = null;
      if (request.method === 'POST') {
        let input; try { input = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'Invalid request' } }; }
        const item = await A.create(store, screen, input, p.user);
        _clearCache(screen);
        // Each announcement or alert is emailed once, when it is published. Alerts always; cards and posters unless the manager unticked it.
        // Alerts are emailed at once. Cards and posters wait for the building's one daily email (see digest in lib/mail.js).
        if (A.ALERT_KINDS.includes(item.kind)) {
          try { mail = await Mail.queue(store, screen, item); } catch (e) { context.error('email queue failed', e); mail = { queued: false, recipients: 0, reason: 'error' }; }
        } else if (item.mailPending && Mail.configured()) mail = { queued: false, daily: true, recipients: 0 };
        context.log('announcement created', screen, item.kind, item.id, 'by', p.user);
      }
      return { status: 200, jsonBody: { screen, screenName: (await A.getSettings(store, screen)).name, settings: await A.getSettings(store, screen), role: p.admin ? 'admin' : 'manager', user: p.user, limits: { total: A.totalFor(screen), emergency: A.LIMITS.emergency, notice: A.LIMITS.notice, drill: A.LIMITS.drill }, noticeTypes: A.NOTICES, emergencyTypes: A.EMERGENCIES, safety: A.assertScreen(screen).safety || {}, mailOn: Mail.configured(), mailHour: (A.assertScreen(screen).mail || {}).digestHour, mail, max: A.MAX, designs: A.DESIGNS, image: A.IMAGE.rules, places: await A.getPlaces(store, screen), items: await A.listOpen(store, screen) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) { return problem(err, context); }
  }
});

app.http('manageEnd', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'manage/announcements/{id}',
  handler: async (request, context) => {
    const p = guard(request);
    if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    const screen = screenOf(request);
    try {
      await A.end(store, screen, request.params.id);
      _clearCache(screen);
      context.log('announcement ended', screen, request.params.id, 'by', p.user);
      return { status: 200, jsonBody: { items: await A.listOpen(store, screen) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) { return problem(err, context); }
  }
});

// POST /api/manage/images?screen=confluence — body is the image itself (already resized by the manager page).
app.http('manageImage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/images',
  handler: async (request, context) => {
    const p = guard(request);
    if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    try {
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > A.IMAGE.maxBytes) return { status: 400, jsonBody: { error: 'The image is too large' } };
      const saved = await A.saveImage(store, screenOf(request), new Uint8Array(await request.arrayBuffer()));
      context.log('image uploaded', saved.id, saved.bytes, 'by', p.user);
      return { status: 200, jsonBody: { id: saved.id } };
    } catch (err) { return problem(err, context); }
  }
});

// Building settings (name, address, email, logo). Administrators only: a manager gets 403 here even though they can use the rest.
app.http('manageSettings', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/settings',
  handler: async (request, context) => {
    const p = guard(request);
    if (!p || !p.admin) return { status: 403, jsonBody: { error: 'Only an ECSG administrator can change the building settings.' } };
    const screen = screenOf(request);
    try {
      let input; try { input = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'Invalid request' } }; }
      const settings = await A.saveSettings(store, screen, input, p.user);
      _clearCache(screen);
      context.log('settings saved', screen, 'by', p.user);
      return { status: 200, jsonBody: { settings }, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) { return problem(err, context); }
  }
});
