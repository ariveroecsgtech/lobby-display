const { app } = require('@azure/functions');
const store = require('../../lib/store');
const Push = require('../../lib/push');

// Public endpoints used by the installed apps to turn notifications on or off for a device.
const screenOf = (request) => (request.query.get('screen') || '').slice(0, 40);
const problem = (err, context) => {
  if (err.code === 'invalid') return { status: 400, jsonBody: { error: err.message } };
  if (err.code === 'unknown_screen') return { status: 404, jsonBody: { error: 'Unknown screen' } };
  if (err.code === 'not_configured') return { status: 503, jsonBody: { error: 'Not available yet' } };
  context.error('push failed', err);
  return { status: 500, jsonBody: { error: 'Something went wrong. Try again.' } };
};
async function body(request) {
  if (Number(request.headers.get('content-length') || 0) > 4000) return null;
  try { return await request.json(); } catch (e) { return null; }
}

app.http('pushKey', {
  methods: ['GET'], authLevel: 'anonymous', route: 'push/key',
  handler: async () => ({ status: 200, jsonBody: { key: Push.publicKey(), enabled: Push.configured() }, headers: { 'Cache-Control': 'public, max-age=300' } })
});
app.http('pushSubscribe', {
  methods: ['POST'], authLevel: 'anonymous', route: 'push/subscribe',
  handler: async (request, context) => {
    if (!Push.configured()) return { status: 503, jsonBody: { error: 'Not available yet' } };
    const input = await body(request); if (!input) return { status: 400, jsonBody: { error: 'Invalid request' } };
    try { return { status: 200, jsonBody: await Push.subscribe(store, screenOf(request), input.subscription, input.app), headers: { 'Cache-Control': 'no-store' } }; }
    catch (err) { return problem(err, context); }
  }
});
app.http('pushUnsubscribe', {
  methods: ['POST'], authLevel: 'anonymous', route: 'push/unsubscribe',
  handler: async (request, context) => {
    const input = await body(request); if (!input) return { status: 400, jsonBody: { error: 'Invalid request' } };
    try { return { status: 200, jsonBody: await Push.unsubscribe(store, screenOf(request), input.endpoint), headers: { 'Cache-Control': 'no-store' } }; }
    catch (err) { return problem(err, context); }
  }
});
