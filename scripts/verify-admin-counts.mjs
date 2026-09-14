import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAdminCounts } from '../assets/js/admin-counts.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(setImmediate);
let checks = 0;
async function check(name, run) { await run(); checks += 1; console.log(`✓ ${name}`); }

function harness() {
  const requests = [];
  const changes = [];
  const counts = createAdminCounts({
    keys: ['members', 'projects', 'publications', 'patents', 'board', 'trash'],
    readCount(key) { const request = { key, ...deferred() }; requests.push(request); return request.promise; },
    onChange: (key, value) => changes.push([key, value])
  });
  return { counts, requests, changes };
}

await check('No reads before login; duplicate pending requests are shared', async () => {
  const { counts, requests } = harness();
  await counts.refresh(['projects']);
  assert.equal(requests.length, 0);
  counts.start();
  const first = counts.refresh(['projects']);
  const second = counts.refresh(['projects', 'unknown']);
  await flush();
  assert.equal(requests.length, 1);
  requests[0].resolve(22);
  await Promise.all([first, second]);
  assert.equal(counts.get('projects').count, 22);
});

await check('Newer document snapshots supersede late aggregation results', async () => {
  const { counts, requests } = harness();
  counts.start();
  const reading = counts.refresh(['patents']);
  await flush();
  counts.accept('patents', 10);
  requests[0].resolve(9);
  await reading;
  assert.equal(counts.get('patents').count, 10);
});

await check('Queued requests do not start after logout or an immediate snapshot', async () => {
  const { counts, requests } = harness();
  counts.start();
  const cancelled = counts.refresh(['projects']);
  counts.clear();
  await cancelled;
  counts.start();
  const unnecessary = counts.refresh(['members']);
  counts.accept('members', 45);
  await unnecessary;
  assert.equal(requests.length, 0);
  assert.equal(counts.get('members').count, 45);
});

await check('A mutation supersedes the old in-flight count', async () => {
  const { counts, requests } = harness();
  counts.start();
  const older = counts.refresh(['board']);
  await flush();
  const latest = counts.refresh(['board'], { force: true });
  await flush();
  requests[1].resolve(19);
  await latest;
  requests[0].resolve(18);
  await older;
  assert.equal(counts.get('board').count, 19);
});

await check('Logout/account changes reject pending counts and pending errors', async () => {
  const { counts, requests, changes } = harness();
  counts.start();
  const old = counts.refresh(['members', 'projects']);
  await flush();
  counts.clear();
  counts.start();
  counts.accept('members', 4);
  const before = changes.length;
  requests[0].resolve(45);
  requests[1].reject(new Error('Previous account denied'));
  await old;
  assert.equal(changes.length, before);
  assert.equal(counts.get('members').count, 4);
  assert.equal(counts.get('projects'), undefined);
});

await check('Failed and invalid counts never become a false zero', async () => {
  const { counts, requests } = harness();
  counts.start();
  counts.accept('publications', 102);
  const reading = counts.refresh(['publications', 'patents', 'trash']);
  await flush();
  requests[0].reject(Object.assign(new Error('Quota'), { code: 'resource-exhausted' }));
  requests[1].reject(Object.assign(new Error('Denied'), { code: 'permission-denied' }));
  requests[2].resolve(NaN);
  await reading;
  assert.equal(counts.get('publications').count, 102);
  assert.equal(counts.get('publications').status, 'error');
  assert.equal(counts.get('patents').count, undefined);
  assert.equal(counts.get('trash').status, 'error');
});

// Execute the real Firebase adapter with only its network transport replaced.
const firebase = await readFile(new URL('../assets/js/firebase.js', import.meta.url), 'utf8');
const source = firebase.slice(firebase.indexOf('export async function fetchCollectionCount('), firebase.indexOf('export async function fetchCollection(name)'))
  .replace(/^export /gm, '');
function adapter({ local = false, items = [], fail = false } = {}) {
  const calls = [];
  const count = vm.runInNewContext(`(() => { ${source}; return fetchCollectionCount; })()`, {
    isLocalDevMode: local, db: {},
    readLocalCollection: () => items,
    collection: (_db, name) => ({ name }),
    where: (field, operator, value) => ({ field, operator, value }),
    query: (collection, filter) => ({ ...collection, filter }),
    withOperationTimeout: (promise) => promise,
    getCountFromServer: async (target) => {
      calls.push(target);
      if (fail) throw Object.assign(new Error('Denied'), { code: 'permission-denied' });
      const selected = target.filter ? items.filter((item) => item[target.filter.field] === target.filter.value) : items;
      return { data: () => ({ count: selected.length }) };
    }
  });
  return { count, calls };
}
const mixed = [{ id: 'legacy' }, { id: 'active', deleted: false }, { id: 'deleted', deleted: true }];
await check('Aggregate totals include legacy records and exclude only deleted:true', async () => {
  const { count, calls } = adapter({ items: mixed });
  assert.equal(await count('members'), 2);
  assert.equal(calls.length, 2);
  assert.deepEqual({ ...calls[1].filter }, { field: 'deleted', operator: '==', value: true });
});
await check('Trash needs one aggregate and counts every trash record', async () => {
  const { count, calls } = adapter({ items: mixed });
  assert.equal(await count('trash', { includeDeleted: true }), 3);
  assert.equal(calls.length, 1);
});
await check('Local counts work without a Firebase connection', async () => {
  const { count, calls } = adapter({ local: true, items: mixed });
  assert.equal(await count('members'), 2);
  assert.equal(await count('trash', { includeDeleted: true }), 3);
  assert.equal(calls.length, 0);
});
await check('Firestore aggregation failures remain errors', async () => {
  const { count } = adapter({ fail: true });
  await assert.rejects(count('patents'), { code: 'permission-denied' });
});
console.log(`Admin count checks passed (${checks}).`);
