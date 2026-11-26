const { app } = require('@azure/functions');
const { getDriveTimes } = require('../../lib/drive');

// GET /api/drive?screen=confluence
app.http('drive', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const screen = (request.query.get('screen') || 'confluence').slice(0, 40);
    try {
      const body = await getDriveTimes(screen);
      return { status: 200, jsonBody: body, headers: { 'Cache-Control': 'public, max-age=300' } };
    } catch (err) {
      if (err.code === 'not_configured') return { status: 503, jsonBody: { error: 'not_configured' } };
      if (err.code === 'unknown_screen') return { status: 404, jsonBody: { error: 'unknown_screen' } };
      context.error('drive failed', err);
      return { status: 502, jsonBody: { error: 'Drive times unavailable' } };
    }
  }
});
