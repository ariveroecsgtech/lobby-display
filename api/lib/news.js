// Top headlines from NewsData.io. Only the headline and the source name are shown on screen.
const TTL_MS = 15 * 60 * 1000; // 96 requests a day, inside NewsData.io's free daily credits
let cached = null;

async function getHeadlines(opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const now = opts.now || Date.now();
  const key = opts.key !== undefined ? opts.key : process.env.NEWSDATA_API_KEY;
  if (!key) { const e = new Error('NEWSDATA_API_KEY is not set'); e.code = 'not_configured'; throw e; }
  if (!opts.noCache && cached && now - cached.at < TTL_MS) return cached.body;

  const query = process.env.NEWS_QUERY || 'country=us&language=en&category=top';
  const res = await fetchImpl('https://newsdata.io/api/1/latest?' + query, { headers: { 'X-ACCESS-KEY': key } });
  if (!res.ok) throw new Error('NewsData request failed: HTTP ' + res.status);
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
