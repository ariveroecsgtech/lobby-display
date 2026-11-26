const assert = require('assert');
const { getHeadlines, _reset } = require('../lib/news');
(async () => {
  await assert.rejects(() => getHeadlines({ key: '' }), (e) => e.code === 'not_configured');
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({ results: [
    { title: '  First   headline ', source_name: 'Example Times' }, { title: 'first headline', source_id: 'dup' }, { title: '' },
    { title: 'x'.repeat(200) }, { title: 'Second headline', source_id: 'wire' }, ...Array.from({ length: 10 }, (_, i) => ({ title: 'More ' + i })) ] }) }; };
  _reset();
  const out = await getHeadlines({ key: 'k', fetch: fakeFetch, now: 1000 });
  assert.deepStrictEqual(out.headlines.slice(0, 2), [{ title: 'First headline', source: 'Example Times' }, { title: 'Second headline', source: 'wire' }]);
  assert.strictEqual(out.headlines.length, 6);
  assert.ok(calls[0].startsWith('https://newsdata.io/api/1/latest?apikey=k&country=us&language=en&category=top&prioritydomain=top'));
  await getHeadlines({ key: 'k', fetch: fakeFetch, now: 2000 });
  assert.strictEqual(calls.length, 1, 'cached within 15 minutes');
  _reset();
  await assert.rejects(() => getHeadlines({ key: 'k', fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) }), /no usable/);
  _reset();
  await assert.rejects(() => getHeadlines({ key: 'secretkey', fetch: async () => ({ ok: false, status: 422, json: async () => ({ status: 'error', results: { message: 'Bad param for secretkey', code: 'UnsupportedFilter' } }) }) }),
    (e) => e.detail === 'HTTP 422 - Bad param for *** [key as stored: 9 characters, does not start with pub_]');
  _reset();
  const seen = [];
  await getHeadlines({ key: '  apikey=pub_abc \n', fetch: async (u) => { seen.push(u); return { ok: true, json: async () => ({ results: [{ title: 'T' }] }) }; } });
  assert.ok(seen[0].includes('?apikey=pub_abc&'), 'pasted prefix and spaces are cleaned');
  _reset();
  await getHeadlines({ key: 'https://newsdata.io/api/1/latest? \n  apikey=pub_81ab', fetch: async (u) => { seen.push(u); return { ok: true, json: async () => ({ results: [{ title: 'T' }] }) }; } });
  assert.ok(seen[1].startsWith('https://newsdata.io/api/1/latest?apikey=pub_81ab&'), 'a pasted sample URL still yields the key');
  console.log('news tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
