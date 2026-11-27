const { app } = require('@azure/functions');
const store = require('../../lib/store');
const A = require('../../lib/announcements');
const { _clearCache } = require('./community');

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
      if (request.method === 'POST') {
        let input; try { input = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'Invalid request' } }; }
        const item = await A.create(store, screen, input, p.user);
        _clearCache(screen);
        context.log('announcement created', screen, item.kind, item.id, 'by', p.user);
      }
      return { status: 200, jsonBody: { screen, screenName: A.assertScreen(screen).name, user: p.user, limits: A.LIMITS, max: A.MAX, designs: A.DESIGNS, items: await A.listOpen(store, screen) }, headers: { 'Cache-Control': 'no-store' } };
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
