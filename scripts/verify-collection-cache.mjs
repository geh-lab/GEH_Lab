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
