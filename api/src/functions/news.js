const { app } = require('@azure/functions');
const { getHeadlines } = require('../../lib/news');

// GET /api/news
app.http('news', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      return { status: 200, jsonBody: await getHeadlines(), headers: { 'Cache-Control': 'public, max-age=300' } };
    } catch (err) {
      if (err.code === 'not_configured') return { status: 503, jsonBody: { error: 'not_configured' } };
      context.error('news failed', err);
      return { status: 502, jsonBody: { error: 'Headlines unavailable' } };
    }
  }
});
