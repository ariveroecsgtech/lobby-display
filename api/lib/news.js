// Top headlines from NewsData.io. Only the headline and the source name are shown on screen.
// Note: the free plan serves news with a 12-hour delay.
const TTL_MS = 15 * 60 * 1000; // 96 requests a day, inside NewsData.io's free daily credits
let cached = null;

async function getHeadlines(opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const rawKey = opts.key !== undefined ? opts.key : process.env.NEWSDATA_API_KEY;
  // Tolerate the usual paste mistakes: stray spaces, quotes, or the "apikey=" prefix copied from NewsData's sample URL.
  const key = String(rawKey || '').trim().replace(/^["']|["']$/g, '').replace(/^apikey=/i, '').trim();
  if (!key) { const e = new Error('NEWSDATA_API_KEY is not set'); e.code = 'not_configured'; throw e; }
  if (!opts.noCache && cached && now - cached.at < TTL_MS) return cached.body;

  const query = process.env.NEWS_QUERY || 'country=us&language=en&category=top';
  // NewsData.io documents the key as the `apikey` query parameter.
  const res = await fetchImpl('https://newsdata.io/api/1/latest?apikey=' + encodeURIComponent(key) + '&' + query);
  if (!res.ok) {
    // Pass NewsData's own explanation along (never the key) so a bad parameter or plan limit is easy to diagnose.
    let why = '';
    try { const b = await res.json(); why = String((b.results && (b.results.message || b.results.code)) || b.message || '').split(key).join('***').slice(0, 200); } catch (e) { /* no body */ }
    const err = new Error('NewsData request failed: HTTP ' + res.status + (why ? ' - ' + why : ''));
    err.detail = 'HTTP ' + res.status + (why ? ' - ' + why : '') +
      ' [key as stored: ' + String(rawKey).length + ' characters, ' + (/^pub_/.test(key) ? 'starts with pub_' : 'does not start with pub_') + (key !== rawKey ? ', cleaned before use' : '') + ']';
    throw err;
  }
  const data = await res.json();
  const seen = new Set();
  const headlines = [];
  for (const a of data.results || []) {
    const title = String(a.title || '').replace(/\s+/g, ' ').trim();
    const id = title.toLowerCase();
    if (!title || title.length > 160 || seen.has(id)) continue;   // skip empty, very long and duplicate titles
    seen.add(id);
    headlines.push({ title, source: String(a.source_name || a.source_id || '').trim() });
    if (headlines.length === 6) break;
  }
  if (!headlines.length) throw new Error('NewsData returned no usable headlines');
  const body = { source: 'NewsData.io', generatedAt: new Date(now).toISOString(), headlines };
  cached = { at: now, body };
  return body;
}

module.exports = { getHeadlines, _reset: () => { cached = null; } };
