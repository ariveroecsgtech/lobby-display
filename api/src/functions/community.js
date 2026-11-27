const { app } = require('@azure/functions');
const store = require('../../lib/store');
const { publicView, assertScreen } = require('../../lib/announcements');
const Mail = require('../../lib/mail');

// GET /api/community?screen=confluence — what the lobby screen shows right now. Public, no author details.
// Cached for 8 seconds so many open screens and phones cost one table read.
const cache = new Map();
app.http('community', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const screen = (request.query.get('screen') || '').slice(0, 40);
    try {
      assertScreen(screen);
      const hit = cache.get(screen), now = Date.now();
      let body = hit && now - hit.at < 8000 ? hit.body : null;
      if (!body) {
        body = publicView(await store.list(screen), now, screen); cache.set(screen, { at: now, body });
        // Every check-in from a screen also moves the email outbox forward a few recipients (see lib/mail.js).
        if (Mail.configured()) { try { await Mail.drain(store, screen, { now }); } catch (e) { context.error('email drain failed', e); } }
      }
      return { status: 200, jsonBody: body, headers: { 'Cache-Control': 'no-store' } };
    } catch (err) {
      if (err.code === 'unknown_screen') return { status: 404, jsonBody: { error: 'Unknown screen' } };
      if (err.code === 'not_configured') return { status: 200, jsonBody: { emergency: null, drill: null, notices: [], items: [], notConfigured: true }, headers: { 'Cache-Control': 'no-store' } };
      context.error('community failed', err);
      return { status: 502, jsonBody: { error: 'Announcements unavailable' } };
    }
  }
});
module.exports = { _clearCache: (screen) => cache.delete(screen) };
