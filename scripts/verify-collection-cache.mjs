import assert from 'node:assert/strict';
import { createCollectionCache } from '../assets/js/collection-cache.js';

function fixture(options = {}) {
  let clock = 0;
  const values = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes.push([key, value]); },
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
  const settings = { storage, scope: 'project/a', now: () => clock, ttlMs: 100, staleMs: 1000, retryMs: 50, ...options };
  return { cache: createCollectionCache(settings), settings, storage, values, writes, tick: (milliseconds) => { clock += milliseconds; } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const errorWith = (code) => Object.assign(new Error(code), { code });
let checks = 0;
async function check(name, test) {
  await test();
  checks++;
  console.log(`PASS: ${name}`);
}

await check('Fresh hits retain the original timestamp and do not write or slide TTL', async () => {
  const f = fixture();
  let calls = 0;
  const loader = async () => { calls++; return [{ id: 'one' }]; };
  assert.equal(f.cache.read('members'), null);
  assert.deepEqual(await f.cache.load('members', loader), { items: [{ id: 'one' }], fetchedAt: 0, stale: false, source: 'server' });
  f.tick(99);
  assert.deepEqual(await f.cache.load('members', loader), { items: [{ id: 'one' }], fetchedAt: 0, stale: false, source: 'cache' });
  assert.equal(calls, 1);
  assert.equal(f.writes.length, 1);
  f.tick(1);
  assert.equal(f.cache.read('members'), null);
  assert.equal(f.cache.read('members', { allowStale: true }).stale, true);
  assert.equal((await f.cache.load('members', loader)).fetchedAt, 100);
  assert.equal(calls, 2);
});

await check('Successful empty arrays survive a new instance and expire independently', async () => {
  const f = fixture();
  await f.cache.load('members', async () => [{ id: 'member' }]);
  f.tick(70);
  await f.cache.load('patents', async () => []);
  f.tick(31);
  assert.equal(f.cache.read('members'), null);
  assert.deepEqual(f.cache.read('patents'), { items: [], fetchedAt: 70, stale: false });
  const next = createCollectionCache(f.settings);
  assert.deepEqual(await next.load('patents', () => { throw new Error('Must not fetch'); }), { items: [], fetchedAt: 70, stale: false, source: 'cache' });
});

await check('Server-seeded records prevent a duplicate fetch without extending server age', async () => {
  const f = fixture();
  f.tick(80);
  const record = { items: [{ id: 'server-rendered' }], fetchedAt: 20 };
  assert.equal(f.cache.seed('members', record), true);
  const noFetch = () => { throw new Error('Fresh server-rendered data must not be fetched again'); };
  assert.deepEqual(await f.cache.load('members', noFetch), { ...record, stale: false, source: 'cache' });
  f.tick(39);
  assert.equal(f.cache.seed('members', record), false);
  assert.equal(f.writes.length, 1);
  assert.equal((await createCollectionCache(f.settings).load('members', noFetch)).fetchedAt, 20);
  f.tick(1);
  assert.equal(f.cache.read('members'), null);
  assert.equal(f.cache.seed('members', record), false);
  assert.equal((await f.cache.load('members', async () => [{ id: 'refreshed' }])).source, 'server');
});

await check('A newer browser record wins over HTML seeds in both memory and storage', async () => {
  const f = fixture();
  f.tick(20);
  await f.cache.load('members', async () => [{ id: 'local' }]);
  f.tick(10);
  const other = createCollectionCache(f.settings);
  await other.load('members', async () => [{ id: 'other-tab' }], { force: true });
  const writes = f.writes.length;
  for (const fetchedAt of [10, 25, 30]) {
    assert.equal(f.cache.seed('members', { items: [{ id: 'older-html' }], fetchedAt }), false);
    assert.equal(f.cache.read('members').items[0].id, 'other-tab');
    assert.equal(createCollectionCache(f.settings).seed('members', { items: [], fetchedAt }), false);
  }
  assert.equal(f.writes.length, writes);
  f.tick(1);
  assert.equal(f.cache.seed('members', { items: [{ id: 'newer-html' }], fetchedAt: 31 }), true);
  assert.equal(f.cache.read('members').items[0].id, 'newer-html');
  assert.equal(f.writes.length, writes + 1);
});

await check('Seed validation rejects expired, future, malformed and unsupported data', async () => {
  const f = fixture();
  f.tick(200);
  for (const record of [null, {}, { items: {}, fetchedAt: 200 }, { items: [], fetchedAt: -1 },
    { items: [], fetchedAt: NaN }, { items: [], fetchedAt: Infinity }, { items: [], fetchedAt: '200' },
    { items: [], fetchedAt: 201 }, { items: [], fetchedAt: 100 }, { items: [], fetchedAt: 0 }]) {
    assert.equal(f.cache.seed('members', record), false);
    assert.equal(f.cache.read('members'), null);
  }
  assert.equal(f.writes.length, 0);
  assert.throws(() => f.cache.seed('trash', { items: [], fetchedAt: 200 }), { code: 'cache/unsupported-collection' });
  assert.equal(fixture({ ttlMs: 0 }).cache.seed('members', { items: [], fetchedAt: 0 }), false);
});

await check('An empty server-rendered collection remains a resolved cache hit', async () => {
  const f = fixture();
  assert.equal(f.cache.seed('members', { items: [], fetchedAt: 0 }), true);
  const next = createCollectionCache(f.settings);
  assert.deepEqual(await next.load('members', () => { throw new Error('An empty seed is not a cache miss'); }),
    { items: [], fetchedAt: 0, stale: false, source: 'cache' });
});

await check('Persisted tombstones reject older or equal HTML before the first cache read', async () => {
  const f = fixture();
  f.tick(20);
  const key = f.cache.invalidate('members');
  const tombstone = f.values.get(key);
  f.tick(10);
  for (const fetchedAt of [0, 20]) {
    const next = createCollectionCache(f.settings);
    assert.equal(next.seed('members', { items: [{ id: 'before-save' }], fetchedAt }), false);
    assert.equal(next.read('members', { allowStale: true }), null);
    assert.equal(f.values.get(key), tombstone);
  }
  const next = createCollectionCache(f.settings);
  assert.equal(next.seed('members', { items: [{ id: 'after-save' }], fetchedAt: 30 }), true);
  assert.equal(next.read('members').items[0].id, 'after-save');
  for (const invalidatedAt of [undefined, -1, '20']) {
    const malformed = JSON.stringify({ version: 1, invalidated: true, invalidatedAt });
    f.values.set(key, malformed);
    assert.equal(createCollectionCache(f.settings).seed('members', { items: [], fetchedAt: 30 }), false);
    assert.equal(f.values.get(key), malformed);
  }
});

await check('Local invalidation and active requests cannot be bypassed by an HTML seed', async () => {
  const f = fixture();
  f.cache.invalidate('members');
  f.tick(5);
  assert.equal(f.cache.seed('members', { items: [{ id: 'html' }], fetchedAt: 5 }), false);
  const gate = deferred();
  const pending = f.cache.load('members', () => gate.promise);
  await Promise.resolve();
  assert.equal(f.cache.seed('members', { items: [{ id: 'html' }], fetchedAt: 5 }), false);
  gate.resolve([{ id: 'saved' }]);
  assert.equal((await pending).items[0].id, 'saved');
  f.tick(1);
  assert.equal(f.cache.seed('members', { items: [{ id: 'later-html' }], fetchedAt: 6 }), true);
  const refreshing = deferred();
  const refresh = f.cache.load('members', () => refreshing.promise, { force: true });
  f.tick(1);
  assert.equal(f.cache.seed('members', { items: [], fetchedAt: 7 }), false);
  refreshing.resolve([{ id: 'fresh-request' }]);
  assert.equal((await refresh).items[0].id, 'fresh-request');
});

await check('Seeding notices missed cross-tab invalidations without restoring old memory', async () => {
  const f = fixture();
  await f.cache.load('members', async () => [{ id: 'before-save' }]);
  f.tick(5);
  createCollectionCache(f.settings).invalidate('members');
  assert.equal(f.cache.seed('members', { items: [{ id: 'old-html' }], fetchedAt: 0 }), false);
  assert.equal(f.cache.read('members', { allowStale: true }), null);
  assert.equal((await f.cache.load('members', async () => [{ id: 'after-save' }])).items[0].id, 'after-save');
});

await check('Blocked storage still permits memory seeding while preserving local invalidation', async () => {
  for (const storage of [undefined, {}, {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage blocked'); }
  }, { getItem: () => null, setItem() { throw errorWith('QuotaExceededError'); } }]) {
    const f = fixture({ storage });
    assert.equal(f.cache.seed('members', { items: [], fetchedAt: 0 }), true);
    assert.equal((await f.cache.load('members', () => { throw new Error('Memory seed expected'); })).source, 'cache');
    f.cache.invalidate('members');
    f.tick(1);
    assert.equal(f.cache.seed('members', { items: [], fetchedAt: 1 }), false);
    assert.equal(f.cache.read('members'), null);
  }
});

await check('Concurrent loads share one request, while other collections remain independent', async () => {
  const f = fixture();
  const gate = deferred();
  let calls = 0;
  const first = f.cache.load('members', () => { calls++; return gate.promise; });
  const second = f.cache.load('members', () => { throw new Error('Duplicate request'); }, { force: true });
  assert.equal(first, second);
  await f.cache.load('projects', async () => []);
  assert.equal(calls, 1);
  gate.resolve([{ id: 'ready' }]);
  assert.equal((await first).source, 'server');
  assert.equal((await second).items[0].id, 'ready');
  assert.deepEqual(f.cache.read('projects').items, []);
});

await check('Force refresh bypasses a fresh entry without corrupting the previous result', async () => {
  const f = fixture();
  await f.cache.load('publications', async () => [{ id: 'old' }]);
  f.tick(5);
  const result = await f.cache.load('publications', async () => [{ id: 'new' }], { force: true });
  assert.equal(result.source, 'server');
  assert.equal(result.fetchedAt, 5);
  assert.equal(f.cache.read('publications').items[0].id, 'new');
});

await check('Corrupt, wrong-version and future-dated storage entries are ignored', async () => {
  const f = fixture();
  for (const raw of ['broken JSON', 'null', '{}', '{"version":1,"items":{},"fetchedAt":0}', '{"version":2,"items":[],"fetchedAt":0}', '{"version":1,"items":[],"fetchedAt":999}']) {
    f.values.set(f.cache.keyFor('members'), raw);
    const cache = createCollectionCache(f.settings);
    assert.equal(cache.read('members'), null);
    assert.equal((await cache.load('members', async () => [])).source, 'server');
  }
});

await check('Unavailable or quota-blocked storage falls back to memory', async () => {
  for (const storage of [undefined, {}, {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage blocked'); }
  }, { getItem: () => null, setItem() { throw errorWith('QuotaExceededError'); } }]) {
    const f = fixture({ storage });
    await f.cache.load('boardPosts', async () => []);
    assert.deepEqual(f.cache.read('boardPosts').items, []);
    assert.equal((await f.cache.load('boardPosts', () => { throw new Error('Memory hit expected'); })).source, 'cache');
  }
});

await check('Quota failures preserve successful data and enforce cooldown even when forced', async () => {
  const f = fixture();
  await f.cache.load('members', async () => [{ id: 'saved' }]);
  const saved = f.values.get(f.cache.keyFor('members'));
  f.tick(100);
  let calls = 0;
  const failure = errorWith('resource-exhausted');
  const loader = async () => { calls++; throw failure; };
  const result = await f.cache.load('members', loader);
  assert.equal(result.source, 'stale');
  assert.equal(result.stale, true);
  assert.equal(result.error, failure);
  assert.equal(result.fetchedAt, 0);
  f.tick(49);
  assert.equal((await f.cache.load('members', loader, { force: true })).source, 'stale');
  assert.equal(calls, 1);
  assert.equal(f.values.get(f.cache.keyFor('members')), saved);
  f.tick(1);
  assert.equal((await f.cache.load('members', async () => [{ id: 'recovered' }])).source, 'server');
  assert.equal(f.cache.read('members').fetchedAt, 150);
});

await check('Network fallback has a fixed age limit; cache misses also honor cooldown', async () => {
  const f = fixture();
  const network = errorWith('unavailable');
  await f.cache.load('projects', async () => []);
  f.tick(1000);
  assert.equal((await f.cache.load('projects', async () => { throw network; })).source, 'stale');
  f.tick(1);
  let calls = 0;
  await assert.rejects(f.cache.load('projects', async () => { calls++; return []; }), (error) => error === network);
  assert.equal(calls, 0);
  assert.equal(f.cache.read('projects', { allowStale: true }), null);
  const loader = async () => { calls++; throw network; };
  await assert.rejects(f.cache.load('patents', loader), (error) => error === network);
  await assert.rejects(f.cache.load('patents', loader), (error) => error === network);
  assert.equal(calls, 1);
});

await check('Permission and authentication errors are never returned as stale success', async () => {
  for (const code of ['permission-denied', 'firestore/permission-denied', 'PERMISSION_DENIED', 'unauthenticated']) {
    const f = fixture();
    await f.cache.load('members', async () => [{ id: 'previous' }]);
    const error = errorWith(code);
    let calls = 0;
    const loader = async () => { calls++; throw error; };
    await assert.rejects(f.cache.load('members', loader, { force: true }), (value) => value === error);
    await assert.rejects(f.cache.load('members', loader), (value) => value === error);
    assert.equal(calls, 1);
    assert.equal(f.cache.read('members').items[0].id, 'previous');
    f.tick(50);
    assert.equal((await f.cache.load('members', async () => [{ id: 'allowed-again' }])).source, 'server');
  }
});

await check('Scopes are isolated and private or unknown collections are rejected', async () => {
  const f = fixture();
  await f.cache.load('members', async () => []);
  const other = createCollectionCache({ ...f.settings, scope: 'project%2Fa' });
  assert.notEqual(other.keyFor('members'), f.cache.keyFor('members'));
  assert.equal(f.cache.keyFor('members'), 'geh-public-collections-v1:project%2Fa:members');
  assert.equal(other.read('members'), null);
  for (const name of ['trash', 'admin', '../members', '__proto__', 'board']) {
    assert.throws(() => f.cache.read(name), { code: 'cache/unsupported-collection' });
    assert.throws(() => f.cache.load(name, async () => []), { code: 'cache/unsupported-collection' });
    assert.throws(() => f.cache.invalidate(name), { code: 'cache/unsupported-collection' });
  }
  assert.equal(f.cache.handleStorageEvent({ key: other.keyFor('members'), newValue: null }), false);
  assert.deepEqual(f.cache.read('members').items, []);
});

await check('Invalidation writes distinct tombstones even before a cache exists', async () => {
  const f = fixture();
  const key = f.cache.invalidate('members');
  const first = f.values.get(key);
  assert.equal(JSON.parse(first).invalidated, true);
  f.cache.invalidate('members');
  assert.notEqual(f.values.get(key), first);
  assert.equal(f.cache.read('members', { allowStale: true }), null);
  assert.equal(createCollectionCache(f.settings).read('members'), null);
  assert.equal((await f.cache.load('members', async () => [])).source, 'server');
});

await check('A blocked tombstone write cannot resurrect old persisted data locally', async () => {
  const f = fixture();
  await f.cache.load('members', async () => [{ id: 'old' }]);
  f.storage.setItem = () => { throw errorWith('QuotaExceededError'); };
  f.cache.invalidate('members');
  assert.equal(f.cache.read('members', { allowStale: true }), null);
  const network = errorWith('unavailable');
  await assert.rejects(f.cache.load('members', async () => { throw network; }), (error) => error === network);
  f.cache.invalidate('members');
  assert.equal((await f.cache.load('members', async () => [{ id: 'new' }])).source, 'server');
  assert.equal(f.cache.read('members').items[0].id, 'new');
});

await check('Local invalidation rejects an old in-flight response without repopulating storage', async () => {
  const f = fixture();
  const gate = deferred();
  const pending = f.cache.load('members', () => gate.promise);
  await Promise.resolve();
  f.cache.invalidate('members');
  const tombstone = f.values.get(f.cache.keyFor('members'));
  assert.equal(f.cache.load('members', () => { throw new Error('Must share old request until it settles'); }), pending);
  gate.resolve([{ id: 'outdated' }]);
  await assert.rejects(pending, { code: 'cache/invalidated' });
  assert.equal(f.values.get(f.cache.keyFor('members')), tombstone);
  assert.equal(f.cache.read('members', { allowStale: true }), null);
  assert.equal((await f.cache.load('members', async () => [{ id: 'current' }])).source, 'server');
});

await check('Cross-tab tombstones discard an old response and allow a new request after settling', async () => {
  const f = fixture();
  const other = createCollectionCache(f.settings);
  const gate = deferred();
  const pending = f.cache.load('projects', () => gate.promise);
  await Promise.resolve();
  const key = other.invalidate('projects');
  assert.equal(f.cache.handleStorageEvent({ key, newValue: f.values.get(key), storageArea: f.storage }), true);
  gate.resolve([{ id: 'outdated' }]);
  await assert.rejects(pending, { code: 'cache/invalidated' });
  assert.equal(f.cache.read('projects', { allowStale: true }), null);
  await other.load('projects', async () => [{ id: 'updated' }]);
  f.cache.handleStorageEvent({ key, newValue: f.values.get(key), storageArea: f.storage });
  assert.equal((await f.cache.load('projects', () => { throw new Error('Cross-tab cache expected'); })).items[0].id, 'updated');
});

await check('Storage clear invalidates every local entry and pending response; unrelated storage is ignored', async () => {
  const f = fixture();
  await f.cache.load('members', async () => []);
  await f.cache.load('patents', async () => []);
  assert.equal(f.cache.handleStorageEvent({ key: null, storageArea: {} }), false);
  assert.deepEqual(f.cache.read('members').items, []);
  const gate = deferred();
  const pending = f.cache.load('boardPosts', () => gate.promise);
  await Promise.resolve();
  f.storage.clear();
  assert.equal(f.cache.handleStorageEvent({ key: null, storageArea: f.storage }), true);
  assert.equal(f.cache.read('members'), null);
  assert.equal(f.cache.read('patents'), null);
  gate.reject(errorWith('unavailable'));
  await assert.rejects(pending, { code: 'cache/invalidated' });
  assert.equal((await f.cache.load('boardPosts', async () => [])).source, 'server');
});

await check('Invalid loader results are rejected and never replace cached success', async () => {
  const f = fixture();
  await f.cache.load('members', async () => []);
  await assert.rejects(f.cache.load('members', async () => ({ items: [] }), { force: true }), { code: 'cache/invalid-data' });
  assert.deepEqual(f.cache.read('members').items, []);
});

await check('Nonrecoverable server and programming errors are not disguised as stale success', async () => {
  for (const error of [errorWith('failed-precondition'), errorWith('invalid-argument'), errorWith('not-found'), new TypeError('Bad application state')]) {
    const f = fixture();
    await f.cache.load('members', async () => []);
    f.tick(100);
    await assert.rejects(f.cache.load('members', async () => { throw error; }), (value) => value === error);
    assert.deepEqual(f.cache.read('members', { allowStale: true }).items, []);
  }
  const f = fixture();
  await f.cache.load('members', async () => []);
  f.tick(100);
  assert.equal((await f.cache.load('members', async () => { throw new TypeError('Failed to fetch'); })).source, 'stale');
});

await check('Default policy uses ten minutes freshness, one minute cooldown and a fixed 24-hour age limit', async () => {
  const f = fixture();
  const cache = createCollectionCache({ storage: f.storage, scope: 'defaults', now: f.settings.now });
  let calls = 0;
  const failure = errorWith('resource-exhausted');
  const loader = async () => { calls++; throw failure; };
  await cache.load('members', async () => []);
  f.tick(599999);
  assert.equal(cache.read('members').stale, false);
  f.tick(1);
  assert.equal(cache.read('members'), null);
  assert.equal((await cache.load('members', loader)).source, 'stale');
  f.tick(59999);
  await cache.load('members', loader, { force: true });
  assert.equal(calls, 1);
  f.tick(1);
  await cache.load('members', loader);
  assert.equal(calls, 2);
  f.tick(86400000 - 660000);
  assert.equal((await cache.load('members', loader)).source, 'stale');
  f.tick(1);
  await assert.rejects(cache.load('members', loader), (error) => error === failure);
  assert.equal(cache.read('members', { allowStale: true }), null);
});

await check('Invalidation before a deferred loader starts prevents the obsolete request', async () => {
  const f = fixture();
  let calls = 0;
  const pending = f.cache.load('members', async () => { calls++; return []; });
  f.cache.invalidate('members');
  await assert.rejects(pending, { code: 'cache/invalidated' });
  assert.equal(calls, 0);
  assert.equal((await f.cache.load('members', async () => [])).source, 'server');
});

console.log(`Collection cache verification passed: ${checks} offline checks, no browser or network access.`);
