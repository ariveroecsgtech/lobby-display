const assert = require('assert');
const { getHeadlines, _reset } = require('../lib/news');
(async () => {
  await assert.rejects(() => getHeadlines({ key: '' }), (e) => e.code === 'not_configured');
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push([url, init.headers['X-ACCESS-KEY']]); return { ok: true, json: async () => ({ results: [
    { title: '  First   headline ', source_name: 'Example Times' }, { title: 'first headline', source_id: 'dup' }, { title: '' },
    { title: 'x'.repeat(200) }, { title: 'Second headline', source_id: 'wire' }, ...Array.from({ length: 10 }, (_, i) => ({ title: 'More ' + i })) ] }) }; };
  _reset();
  const out = await getHeadlines({ key: 'k', fetch: fakeFetch, now: 1000 });
  assert.deepStrictEqual(out.headlines.slice(0, 2), [{ title: 'First headline', source: 'Example Times' }, { title: 'Second headline', source: 'wire' }]);
  assert.strictEqual(out.headlines.length, 6);
  assert.ok(calls[0][1] === 'k' && !calls[0][0].includes('apikey'));
  await getHeadlines({ key: 'k', fetch: fakeFetch, now: 2000 });
  assert.strictEqual(calls.length, 1, 'cached within 15 minutes');
  _reset();
  await assert.rejects(() => getHeadlines({ key: 'k', fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) }), /no usable/);
  console.log('news tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
