const { app } = require('@azure/functions');
const store = require('../../lib/store');
const A = require('../../lib/announcements');
const R = require('../../lib/residents');

// Resident list for a building. Manager or admin role only (staticwebapp.config.json protects /api/manage/*, and the role
// is checked again here). Responses are never cached and nothing here is reachable from the public screen.
const guard = (request) => { const p = A.principal(request.headers.get('x-ms-client-principal')); return p.allowed ? p : null; };
const screenOf = (request) => (request.query.get('screen') || '').slice(0, 40);
const noStore = { 'Cache-Control': 'no-store' };
const problem = (err, context) => {
  if (err.code === 'invalid' || err.code === 'limit') return { status: 400, jsonBody: { error: err.message } };
  if (err.code === 'unknown_screen') return { status: 404, jsonBody: { error: 'Unknown screen' } };
  if (err.code === 'not_configured') return { status: 503, jsonBody: { error: 'Storage is not connected yet' } };
  context.error('residents failed', err);
  return { status: 500, jsonBody: { error: 'Something went wrong. Try again.' } };
};

app.http('residents', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'manage/residents',
  handler: async (request, context) => {
    const p = guard(request); if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    const screen = screenOf(request);
    try {
      if (request.method === 'POST') {
        let input; try { input = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'Invalid request' } }; }
        const residents = await R.add(store, screen, input, p.user);
        context.log('resident added', screen, 'by', p.user);                    // who and when, never the resident's details
        return { status: 200, jsonBody: { residents }, headers: noStore };
      }
      return { status: 200, jsonBody: { residents: await R.list(store, screen), max: R.MAX }, headers: noStore };
    } catch (err) { return problem(err, context); }
  }
});

app.http('residentsImport', {
  methods: ['POST'], authLevel: 'anonymous', route: 'manage/residents/import',
  handler: async (request, context) => {
    const p = guard(request); if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    const screen = screenOf(request);
    try {
      let input; try { input = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'Invalid request' } }; }
      const out = await R.importRows(store, screen, input.rows, { mode: input.mode, dryRun: input.dryRun === true, user: p.user });
      if (!input.dryRun) context.log('residents imported', screen, JSON.stringify({ mode: out.summary.mode, added: out.summary.added, updated: out.summary.updated, removed: out.summary.removed }), 'by', p.user);
      return { status: 200, jsonBody: out, headers: noStore };
    } catch (err) { return problem(err, context); }
  }
});

app.http('residentRemove', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'manage/residents/{id}',
  handler: async (request, context) => {
    const p = guard(request); if (!p) return { status: 403, jsonBody: { error: 'Not allowed' } };
    const screen = screenOf(request);
    try {
      const residents = await R.remove(store, screen, request.params.id);
      context.log('resident removed', screen, 'by', p.user);
      return { status: 200, jsonBody: { residents }, headers: noStore };
    } catch (err) { return problem(err, context); }
  }
});
