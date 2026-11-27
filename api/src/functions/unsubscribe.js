const { app } = require('@azure/functions');
const store = require('../../lib/store');
const Mail = require('../../lib/mail');
const { SCREENS } = require('../../lib/announcements');

// The link at the bottom of every email. Opening it only shows a button, so mail scanners that open links
// cannot unsubscribe anyone by accident; pressing the button does it.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, body:
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B1220;color:#F4F7FB;font-family:Arial,Helvetica,sans-serif;padding:24px;box-sizing:border-box}main{max-width:440px}h1{font-size:24px;margin:0 0 12px}p{font-size:17px;line-height:1.5;color:#C9D4E5;margin:0 0 20px}button{min-height:48px;padding:0 20px;border:0;border-radius:12px;background:#F5B544;color:#0B1220;font-size:16px;font-weight:700;cursor:pointer}</style></head><body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>' });

app.http('unsubscribe', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'unsubscribe',
  handler: async (request, context) => {
    const q = request.query, screen = (q.get('s') || '').slice(0, 40), r = (q.get('r') || '').slice(0, 40), t = (q.get('t') || '').slice(0, 64);
    const building = SCREENS[screen] ? SCREENS[screen].name : '';
    if (!building || !/^[a-f0-9]{32}$/.test(r) || !Mail.verify(screen, r, t)) return page('This link is not valid', '<p>Use the link at the bottom of a recent email from your building.</p>');
    try {
      if (request.method === 'POST') {
        await Mail.unsubscribe(store, screen, r, t);
        return page('You will no longer get event announcements', '<p>' + esc(building) + ' will not email you about events any more. Safety and service notices, such as alarm tests and water shut-offs, are still sent to every resident.</p>');
      }
      return page('Stop event announcements?', '<p>' + esc(building) + ' will stop emailing you about events. Safety and service notices are still sent to every resident.</p>' +
        '<form method="post" action="/api/unsubscribe?s=' + encodeURIComponent(screen) + '&amp;r=' + r + '&amp;t=' + esc(t) + '"><button type="submit">Stop event announcements</button></form>');
    } catch (err) { context.error('unsubscribe failed', err); return page('Something went wrong', '<p>Please try the link again in a few minutes.</p>'); }
  }
});
