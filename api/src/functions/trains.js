const { app } = require('@azure/functions');
const { getDepartures } = require('../../lib/mnr');

// GET /api/trains?station=South%20Norwalk&to=Grand%20Central,Stamford,New%20Haven
app.http('trains', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const station = (request.query.get('station') || process.env.DEFAULT_STATION || 'South Norwalk').slice(0, 60);
    try {
      const to = (request.query.get('to') || '').split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 6);
      const body = await getDepartures(station, { to });
      return { status: 200, jsonBody: body, headers: { 'Cache-Control': 'public, max-age=20' } };
    } catch (err) {
      context.error('trains failed', err);
      return { status: 502, jsonBody: { error: 'Train data unavailable', detail: String(err.message || err) } };
    }
  }
});
