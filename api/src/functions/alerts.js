const { app } = require('@azure/functions');
const { getAlerts } = require('../../lib/alerts');

// GET /api/alerts?routes=3,5   (Metro-North route ids: 3 = New Haven Line, 5 = Danbury Branch)
app.http('alerts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const routes = (request.query.get('routes') || '3').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9]{1,12}$/.test(s)).slice(0, 8);
      return { status: 200, jsonBody: await getAlerts(routes), headers: { 'Cache-Control': 'public, max-age=60' } };
    } catch (err) {
      context.error('alerts failed', err);
      return { status: 502, jsonBody: { error: 'Service notices unavailable', detail: String(err.message || err) } };
    }
  }
});
