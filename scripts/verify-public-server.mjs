import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';
import { parsePublicFirebaseConfig, decodeFirestoreValue, fetchPublicCollection, createPublicCollectionLoader, createPublicDataCache, PublicDataError, PUBLIC_CACHE_TTL_MS, PUBLIC_STALE_TTL_MS, PUBLIC_RETRY_MS } from '../server/public-data.mjs';
import { createPublicPageHandler, PUBLIC_PAGES } from '../api/public-page.js';

// Offline fixtures only: these tests never read configuration credentials or Firestore.
const tests = [];
const test = (name, run) => tests.push({ name, run });
const config = { projectId: 'offline-fixture', apiKey: 'public_test-key' };
const success = items => ({ items, projectId: config.projectId });
const reply = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const unavailable = (status = 503) => new PublicDataError({ status, transient: status >= 500 || status === 429 });
const memberDocument = (id, fields = {}) => ({ name: `projects/offline-fixture/databases/(default)/documents/members/${id}`, fields });
function memberCache(options) { const cache = createPublicDataCache(options); return { read: () => cache.read('members') }; }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('public config literals are read without executing JavaScript', () => {
  const source = `window.GEH_FIREBASE_CONFIG = { apiKey: "public_test-key", authDomain: "offline.test", projectId: 'offline-fixture', }; throw new Error('must not run');`;
  assert.deepEqual(parsePublicFirebaseConfig(source), config);
  assert.throws(() => parsePublicFirebaseConfig(`window.GEH_FIREBASE_CONFIG = {apiKey: call(), projectId: 'offline-fixture'};`), PublicDataError);
  assert.throws(() => parsePublicFirebaseConfig(''), PublicDataError);
});

test('Firestore values retain nested member and timestamp data', () => {
  assert.deepEqual(decodeFirestoreValue({ mapValue: { fields: {
    experienceEntries: { arrayValue: { values: [{ mapValue: { fields: { organization: { stringValue: 'Lab' }, sortOrder: { integerValue: '2' } } } }] } },
    updatedAt: { timestampValue: '2026-09-16T00:00:00.000Z' }, removed: { booleanValue: false }, empty: { nullValue: null }, score: { doubleValue: 1.5 }
  } } }), { experienceEntries: [{ organization: 'Lab', sortOrder: 2 }], updatedAt: '2026-09-16T00:00:00.000Z', removed: false, empty: null, score: 1.5 });
  assert.deepEqual(decodeFirestoreValue({ arrayValue: {} }), []);
});

test('public read paginates only members, excludes deleted, and preserves document identity', async () => {
  const requests = [];
  const result = await fetchPublicCollection(config, 'members', { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1
      ? reply({ documents: [memberDocument('one', { id: { stringValue: 'wrong' }, nameKr: { stringValue: '멤버' } }), memberDocument('deleted', { deleted: { booleanValue: true } })], nextPageToken: 'page two' })
      : reply({ documents: [memberDocument('two'), memberDocument('one')] });
  } });
  assert.deepEqual(result.items.map(item => item.id), ['one', 'two']);
  assert.equal(result.items[0].documentId, 'one');
  assert.equal(result.items[0].nameKr, '멤버');
  assert.equal(result.projectId, config.projectId);
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'page two');
  for (const request of requests) {
    assert.match(request.url.pathname, /\/documents\/members$/);
    assert.equal(request.url.hostname, 'firestore.googleapis.com');
    assert.equal(request.options.headers, undefined);
    assert.ok(request.options.signal instanceof AbortSignal);
  }
});

test('malformed or looping pagination fails without unbounded requests', async () => {
  let calls = 0;
  await assert.rejects(fetchPublicCollection(config, 'members', { fetchImpl: async () => { calls++; return reply({ nextPageToken: 'same' }); } }), PublicDataError);
  assert.equal(calls, 2);
  await assert.rejects(fetchPublicCollection(config, 'members', { fetchImpl: async () => reply({ documents: {} }) }), PublicDataError);
});

test('HTTP permission and transient errors are classified without response details', async () => {
  for (const status of [400, 401, 403, 404, 408, 429, 500, 503]) {
    await assert.rejects(fetchPublicCollection(config, 'members', { fetchImpl: async () => reply({ detail: 'secret' }, status) }), error => {
      assert.equal(error.status, status);
      assert.equal(error.transient, [408, 429, 500, 503].includes(status));
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test('one deadline bounds the complete read even if fetch never resolves', async () => {
  let signal;
  await assert.rejects(fetchPublicCollection(config, 'members', { timeoutMs: 10, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } }), error => error.transient === true);
  assert.equal(signal.aborted, true);
});

test('loader reads public config once and only after a data request', async () => {
  const paths = [];
  let requests = 0;
  const load = createPublicCollectionLoader({ cwd: () => '/offline/site', read: async path => { paths.push(path); return `window.GEH_FIREBASE_CONFIG = {apiKey:'public_test-key',projectId:'offline-fixture'};`; }, fetchImpl: async () => { requests++; return reply({}); } });
  assert.equal(paths.length, 0);
  await load('members'); await load('members');
  assert.deepEqual(paths, ['/offline/site/firebase-config.js']);
  assert.equal(requests, 2);
});

test('empty successful collections are cached and expire after ten minutes', async () => {
  let time = 1000, reads = 0;
  const cache = memberCache({ now: () => time, load: async () => { reads++; return success([]); } });
  const first = await cache.read();
  time += PUBLIC_CACHE_TTL_MS - 1;
  assert.deepEqual(await cache.read(), first);
  assert.equal(reads, 1);
  time++;
  assert.equal((await cache.read()).fetchedAt, time);
  assert.equal(reads, 2);
});

test('concurrent requests share one in-flight collection read', async () => {
  let reads = 0;
  const gate = deferred();
  const cache = memberCache({ load: async () => { reads++; return gate.promise; } });
  const first = cache.read(), second = cache.read();
  await Promise.resolve();
  assert.equal(reads, 1);
  gate.resolve(success([{ id: 'same' }]));
  assert.deepEqual(await first, await second);
});

test('transient failures retain timestamped cache with one-minute retry cooldown', async () => {
  let time = 1000, reads = 0, fail = false;
  const cache = memberCache({ now: () => time, load: () => { reads++; if (fail) throw unavailable(); return success([{ id: 'last-success' }]); } });
  await cache.read();
  time += PUBLIC_CACHE_TTL_MS;
  fail = true;
  const stale = await cache.read();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, 1000);
  time += PUBLIC_RETRY_MS - 1;
  assert.deepEqual(await cache.read(), stale);
  assert.equal(reads, 2);
  time++;
  fail = false;
  assert.equal((await cache.read()).stale, false);
  assert.equal(reads, 3);
});

test('cold failure cooldown recovers even when the loader throws synchronously', async () => {
  let time = 1000, reads = 0;
  const cache = memberCache({ now: () => time, load: () => { reads++; if (reads === 1) throw unavailable(); return success([]); } });
  await assert.rejects(cache.read(), PublicDataError);
  await assert.rejects(cache.read(), PublicDataError);
  assert.equal(reads, 1);
  time += PUBLIC_RETRY_MS;
  assert.deepEqual((await cache.read()).items, []);
  assert.equal(reads, 2);
});

test('stale data expires at 24 hours and is never used after permission denial', async () => {
  for (const status of [401, 403, 503]) {
    let time = 1000, error;
    const cache = memberCache({ now: () => time, load: async () => { if (error) throw error; return success([{ id: 'previous' }]); } });
    await cache.read();
    time += status === 503 ? PUBLIC_STALE_TTL_MS : PUBLIC_CACHE_TTL_MS;
    error = unavailable(status);
    await assert.rejects(cache.read(), PublicDataError);
    time += PUBLIC_RETRY_MS;
    error = unavailable(503);
    await assert.rejects(cache.read(), PublicDataError);
  }
});

function response() {
  return Object.assign(new EventEmitter(), {
    headers: {}, chunks: [], headersSent: false, destroyed: false, writableEnded: false,
    setHeader(name, value) { assert.equal(this.headersSent, false); this.headers[name.toLowerCase()] = value; },
    removeHeader(name) { assert.equal(this.headersSent, false); delete this.headers[name.toLowerCase()]; },
    flushHeaders() { this.headersSent = true; },
    write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); return true; },
    end() { this.headersSent = true; this.writableEnded = true; this.body = this.chunks.length ? Buffer.concat(this.chunks).toString('utf8') : undefined; this.emit('finish'); },
    destroy() { this.destroyed = true; this.emit('close'); }
  });
}

test('collection cache allowlist rejects arbitrary paths and separates collection results', async () => {
  const requested = [];
  const cache = createPublicDataCache({ load: async name => { requested.push(name); return success([{ id: name }]); } });
  const [members, publications] = await Promise.all([cache.read('members'), cache.read('publications')]);
  assert.equal(members.items[0].id, 'members');
  assert.equal(publications.items[0].id, 'publications');
  await cache.read('members');
  await assert.rejects(cache.read('trash'), PublicDataError);
  await assert.rejects(cache.read('../other'), PublicDataError);
  assert.deepEqual(requested, ['members', 'publications']);
});

test('both languages share collection data while using separate fixed templates and correct cache age', async () => {
  let time = 1000, reads = 0;
  const paths = [], rendered = [];
  const cache = createPublicDataCache({ now: () => time, load: async () => { reads++; return success([{ id: 'member' }]); } });
  const handler = createPublicPageHandler({ now: () => time, cwd: () => '/offline/site', readCollection: name => cache.read(name), read: async path => { paths.push(path); return '<template>'; }, render: (template, records, options) => { rendered.push({ template, records, options }); return `<html lang="${options.lang}">멤버</html>`; } });
  const kr = response();
  await handler({ method: 'GET', url: '/members.html', query: { page: 'members', lang: 'kr' } }, kr);
  assert.equal(kr.statusCode, 200);
  assert.equal(kr.headers['vercel-cdn-cache-control'], 'public, s-maxage=600');
  assert.equal(kr.headers['cache-control'], 'no-cache, max-age=0, must-revalidate');
  assert.equal(kr.headers['content-length'], undefined);
  assert.ok(kr.chunks.length > 0);
  time += 250500;
  const en = response();
  await handler({ method: 'GET', url: '/api/public-page?page=members&lang=en' }, en);
  assert.equal(en.statusCode, 200);
  assert.equal(en.headers['vercel-cdn-cache-control'], 'public, s-maxage=349');
  assert.deepEqual(paths, ['/offline/site/.server/members.html', '/offline/site/.server/en/members.html']);
  assert.equal(reads, 1);
  assert.deepEqual(rendered.map(entry => entry.options.lang), ['kr', 'en']);
  assert.deepEqual(rendered[1].options, { page: 'members', lang: 'en', projectId: config.projectId, unavailableCollections: [] });
  assert.deepEqual(rendered[1].records.members, { ...success([{ id: 'member' }]), fetchedAt: 1000, stale: false });
  const head = response();
  await handler({ method: 'HEAD', url: '/api/public-page?page=members&lang=en' }, head);
  assert.equal(head.body, undefined);
  assert.equal(head.headers['content-length'], Buffer.byteLength(en.body));
  assert.equal(head.statusCode, 200);
  assert.equal(paths.length, 2);
});

test('public pages request only required collections and home cache lifetime uses the oldest result', async () => {
  const requested = [], rendered = [], paths = [];
  const time = PUBLIC_CACHE_TTL_MS;
  const handler = createPublicPageHandler({ now: () => time, cwd: () => '/offline', read: async path => { paths.push(path); return 'template'; }, readCollection: async name => { requested.push(name); return { ...success([]), fetchedAt: name === 'members' ? 120000 : 360000, stale: false }; }, render: (_template, records, options) => { rendered.push({ records, options }); return 'complete'; } });
  for (const [page, specification] of Object.entries(PUBLIC_PAGES)) {
    requested.length = 0;
    const res = response();
    await handler({ method: 'GET', query: { page, lang: 'kr' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(requested, specification.collections);
    assert.deepEqual(Object.keys(rendered.at(-1).records), specification.collections);
    assert.equal(paths.at(-1), `/offline/.server/${specification.file}`);
    assert.equal(res.headers['vercel-cdn-cache-control'], `public, s-maxage=${specification.collections.includes('members') ? 120 : 360}`);
  }
});

test('stale responses are explicitly passed to renderer and are never HTTP cached', async () => {
  let records;
  const handler = createPublicPageHandler({ now: () => PUBLIC_CACHE_TTL_MS + 1000, read: async () => '', readCollection: async () => ({ ...success([]), fetchedAt: 1000, stale: true }), render: (_html, received) => { records = received; return 'last available members'; } });
  const res = response();
  await handler({ method: 'GET', url: '/?page=members&lang=kr' }, res);
  assert.equal(records.members.stale, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
});

test('invalid route and methods perform no data read and cannot select another file', async () => {
  let reads = 0;
  const handler = createPublicPageHandler({ readCollection: async () => { reads++; throw new Error(); }, read: async () => { throw new Error(); } });
  for (const req of [{ method: 'POST', url: '/' }, { method: 'GET', query: { lang: '../other' } }, { method: 'GET', query: { lang: ['kr', 'en'] } }, { method: 'GET', url: '/?lang=kr&lang=en' }, { method: 'GET', query: { page: 'constructor' } }, { method: 'GET', query: { page: '../admin.html' } }]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, req.method === 'POST' ? 405 : 400);
    assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
  }
  assert.equal(reads, 0);
});

test('one failed primary collection returns a retry page without obsolete data, zeros, or error details', async () => {
  const handler = createPublicPageHandler({ read: async () => 'OLD ROSTER', readCollection: async name => { if (name === 'projects') throw new Error('credential-detail-must-stay-private'); return { ...success([]), fetchedAt: Date.now(), stale: false }; }, render: () => { throw new Error('must not render'); } });
  const res = response();
  await handler({ method: 'GET', query: { page: 'projects', lang: 'en' } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /Try again/);
  assert.match(res.body, /href="\/en\/projects\.html"/);
  assert.doesNotMatch(res.body, /OLD ROSTER|credential-detail|skeleton/);
  assert.equal(res.headers['retry-after'], '60');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('home retains every healthy section when one collection is unavailable and does not cache partial HTML', async () => {
  const requested = [];
  let rendered;
  const handler = createPublicPageHandler({
    read: async () => 'template',
    readCollection: async name => {
      requested.push(name);
      if (name === 'patents') throw unavailable(403);
      return { ...success([{ id: name }]), fetchedAt: Date.now(), stale: false };
    },
    render: (_template, records, options) => { rendered = { records, options }; return 'healthy home content'; }
  });
  const res = response();
  await handler({ method: 'GET', url: '/?page=home&lang=kr' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'healthy home content');
  assert.deepEqual(requested, PUBLIC_PAGES.home.collections);
  assert.deepEqual(Object.keys(rendered.records), ['members', 'projects', 'publications', 'boardPosts']);
  assert.equal(Object.hasOwn(rendered.records, 'patents'), false, 'A failed collection must not be converted into an empty success');
  assert.deepEqual(rendered.options.unavailableCollections, ['patents']);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
});

test('related-member lookup failures preserve project, publication, and patent pages', async () => {
  for (const page of ['projects', 'publications', 'patents']) {
    let rendered;
    const handler = createPublicPageHandler({
      read: async () => 'template',
      readCollection: async name => {
        if (name === 'members') throw unavailable(503);
        return { ...success([{ id: `${page}-record` }]), fetchedAt: Date.now(), stale: false };
      },
      render: (_template, records, options) => { rendered = { records, options }; return `healthy ${page}`; }
    });
    const res = response();
    await handler({ method: 'GET', query: { page, lang: 'en' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, `healthy ${page}`);
    assert.deepEqual(Object.keys(rendered.records), [page]);
    assert.deepEqual(rendered.options.unavailableCollections, ['members']);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
  }
});

test('home can show one available collection but all failures produce a retry response', async () => {
  let allFail = false, renders = 0;
  const handler = createPublicPageHandler({
    read: async () => 'template',
    readCollection: async name => {
      if (allFail || name !== 'publications') throw unavailable(503);
      return { ...success([]), fetchedAt: Date.now(), stale: false };
    },
    render: (_template, records, options) => {
      renders++;
      assert.deepEqual(Object.keys(records), ['publications']);
      assert.deepEqual(records.publications.items, [], 'Known empty content remains a fulfilled collection');
      assert.deepEqual(options.unavailableCollections, ['members', 'projects', 'patents', 'boardPosts']);
      return 'available publications';
    }
  });
  const partial = response();
  await handler({ method: 'GET', query: { page: 'home', lang: 'en' } }, partial);
  assert.equal(partial.statusCode, 200);
  assert.equal(partial.headers['vercel-cdn-cache-control'], 'no-store');
  allFail = true;
  const failed = response();
  await handler({ method: 'GET', query: { page: 'home', lang: 'en' } }, failed);
  assert.equal(failed.statusCode, 503);
  assert.match(failed.body, /Try again/);
  assert.equal(failed.headers['cache-control'], 'no-store');
  assert.equal(renders, 1);
});

test('a failed template read is retried and a later valid template can render', async () => {
  let reads = 0;
  const handler = createPublicPageHandler({ read: async () => { if (++reads === 1) throw new Error('missing'); return 'template'; }, readCollection: async () => ({ ...success([]), fetchedAt: Date.now(), stale: false }), render: () => 'ready' });
  const first = response(), second = response();
  await handler({ method: 'GET', url: '/' }, first);
  await handler({ method: 'GET', url: '/' }, second);
  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body, 'ready');
});

test('streaming writes bounded UTF-8 byte chunks and waits for backpressure', async () => {
  const html = '<html>' + '멤버🌿'.repeat(30000) + '</html>';
  const handler = createPublicPageHandler({ read: async () => '', readCollection: async () => ({ ...success([]), fetchedAt: Date.now(), stale: false }), render: () => html });
  const res = response();
  const write = res.write.bind(res);
  let blocked = false, drains = 0;
  res.write = chunk => {
    assert.equal(res.headersSent, true);
    assert.equal(blocked, false, 'The next chunk must wait for drain.');
    assert.ok(chunk.length <= 64 * 1024);
    blocked = true;
    write(chunk);
    queueMicrotask(() => { blocked = false; drains++; res.emit('drain'); });
    return false;
  };
  await handler({ method: 'GET', query: { page: 'members' } }, res);
  assert.equal(res.body, html);
  assert.equal(res.headers['content-length'], undefined);
  assert.equal(drains, res.chunks.length);
  assert.ok(drains > 1);
  assert.equal(res.listenerCount('drain'), 0);
  assert.equal(res.listenerCount('error'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('disconnect during a stream stops writing and never appends a 503 retry page', async () => {
  const handler = createPublicPageHandler({ read: async () => '', readCollection: async () => ({ ...success([]), fetchedAt: Date.now(), stale: false }), render: () => 'current-content'.repeat(20000) });
  const res = response();
  const write = res.write.bind(res);
  res.write = chunk => {
    write(chunk);
    queueMicrotask(() => res.destroy());
    return false;
  };
  await handler({ method: 'GET', query: { page: 'members' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.destroyed, true);
  assert.equal(res.chunks.length, 1);
  assert.equal(res.headers['retry-after'], undefined);
  assert.doesNotMatch(Buffer.concat(res.chunks).toString('utf8'), /Try again|다시 불러오기/);
  assert.equal(res.listenerCount('close'), 0);
});

test('real HTTP streams an 8 MB Unicode document with no buffered Content-Length', async () => {
  const html = '<!doctype html><html><body>' + '멤버🌿'.repeat(800000) + '</body></html>';
  assert.ok(Buffer.byteLength(html) > 4.5 * 1024 * 1024);
  const handler = createPublicPageHandler({ read: async () => '', readCollection: async () => ({ ...success([]), fetchedAt: Date.now(), stale: false }), render: () => html });
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const receive = method => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, method, path: '/api/public-page?page=board&lang=kr', agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const streamed = await receive('GET');
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers['content-length'], undefined);
    assert.equal(streamed.headers['transfer-encoding'], 'chunked');
    assert.ok(streamed.chunks.length > 1);
    assert.equal(streamed.body, html);
    const head = await receive('HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(html));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

for (const { name, run } of tests) { await run(); console.log(`✓ ${name}`); }
console.log(`Public server verification passed (${tests.length} checks).`);
