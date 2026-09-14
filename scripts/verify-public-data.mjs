import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createCollectionCache } from '../assets/js/collection-cache.js';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as data from '../assets/js/data.js';

// Execute production data modules with fake time, storage and Firestore. No browser,
// credentials, Firebase SDK, network requests or live database writes are involved.
const sources = Object.fromEntries(await Promise.all(['public-data-cache', 'firebase-public', 'public', 'firebase'].map(async (name) => [name, await fs.readFile(new URL(`../assets/js/${name}.js`, import.meta.url), 'utf8')])));
const stripImports = (source) => source.replace(/^import\s+[\s\S]*?;\s*$/gm, '').replace(/^export\s+/gm, '');
const plain = (value) => JSON.parse(JSON.stringify(value));
const errorWith = (code) => Object.assign(new Error(code), { code });
const flush = async () => { for (let count = 0; count < 60; count++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); return true; }
  };
}
function fixture(initial = {}) {
  let clock = 1000000;
  const values = new Map();
  const reads = {};
  const responses = new Map(Object.entries({
    members: [{ id: 'member', nameKr: '테스트 멤버', nameEn: 'Test Member', group: 'pi' }],
    projects: [{ id: 'project', titleKr: '테스트 과제', titleEn: 'Test Project', status: 'ongoing' }],
    publications: [{ id: 'paper', title: 'Test publication', year: '2026', indexing: 'SCI(E)' }],
    patents: [],
    boardPosts: [{ id: 'post', title: 'Test board post', category: 'article', date: '2026-09-14' }],
    ...initial
  }));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const snapshot = items => ({ docs: items.map(({ id, ...record }) => ({ id, data: () => record })) });
  let subscriptions = 0;
  const firestore = {
    db: {}, collection: (_db, name) => name,
    async getDocsFromServer(name) {
      reads[name] = (reads[name] || 0) + 1;
      const answer = responses.get(name);
      const result = typeof answer === 'function' ? await answer() : answer;
      if (result instanceof Error) throw result;
      return snapshot(result || []);
    },
    onSnapshot() { subscriptions++; throw new Error('Public pages must not subscribe to Firestore.'); }
  };
  const runtimes = [];
  function runtime(page = 'home', lang = 'kr') {
    const timers = new Map();
    let timerId = 0;
    const setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; };
    const clearTimeout = id => timers.delete(id);
    const window = {
      ...events(), localStorage: storage, GEH_FIREBASE_CONFIG: { apiKey: 'offline-fixture', projectId: 'offline-fixture' },
      GEH_LOCAL_DEV_MODE: false, location: { hostname: 'offline.example', protocol: 'https:' },
      matchMedia: () => ({ matches: true }), setTimeout, clearTimeout
    };
    const document = {
      ...events(), hidden: false, body: { dataset: { page, lang, root: lang === 'en' ? '..' : '.' } },
      documentElement: { classList: { add() {} } }, querySelector: () => null, querySelectorAll: () => []
    };
    class FakeDate extends Date { static now() { return clock; } }
    const base = { window, document, localStorage: storage, Date: FakeDate, URL, URLSearchParams, setTimeout, clearTimeout,
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
      console: { warn() {}, error() {} }, fetch: () => { throw new Error('Network access is prohibited in this test.'); } };
    const bus = vm.runInNewContext(`(() => { ${stripImports(sources['public-data-cache'])}\nreturn { publicCollectionCache, invalidatePublicCollection, PUBLIC_DATA_CHANGED, getPublicCollectionRevision }; })()`, {
      ...base, createCollectionCache: options => createCollectionCache({ ...options, now: () => clock })
    }, { filename: 'public-data-cache.js' });
    const adapter = vm.runInNewContext(`(() => { ${stripImports(sources['firebase-public'])}\nfirestoreContext = injectedFirestore; return { COLLECTIONS, hasFirebaseConfig, isLocalDevMode, fetchCollectionResult, readCachedCollection }; })()`, {
      ...base, ...bus, injectedFirestore: firestore
    }, { filename: 'firebase-public.js' });
    const renders = [];
    const notices = [];
    const api = vm.runInNewContext(`(() => { ${stripImports(sources.public)}\n
      renderPage = () => captureRender(Object.fromEntries(['members','projects','publications','patents','board'].map(key => [key, {
        items: state[key], resolved: resolvedCollections.has(key),
        summary: key === 'patents' ? homePatentSummaryCard() : homeCollectionSummaryCard(key, key, state[key].length, [])
      }])));
      showPublicNotice = (message, tone) => captureNotice({ message, tone });
      return { applyCachedState, hydrate, refreshPublicData, setupPublicDataRefresh, loadGlobalSearch, state, dataIssues, resolvedCollections };
    })()`, { ...base, ...bus, ...adapter, ...utils, ...patents, ...data,
      subscribeCollection: firestore.onSnapshot,
      captureRender: value => renders.push(plain(value)), captureNotice: value => notices.push(value)
    }, { filename: 'public.js' });
    const result = { ...api, ...bus, ...adapter, window, document, timers, renders, notices };
    runtimes.push(result);
    return result;
  }
  async function advance(ms) {
    clock += ms;
    for (const runtime of runtimes) {
      const due = [...runtime.timers].filter(([, timer]) => timer.at <= clock);
      for (const [id, timer] of due) { if (runtime.timers.delete(id)) timer.callback(); }
    }
    await flush();
  }
  function admin(runtime) {
    // Use the actual production write functions, stubbing only SDK and local-store dependencies.
    const functions = sources.firebase.slice(sources.firebase.indexOf('export async function saveDocument('), sources.firebase.indexOf('export async function uploadAsset('));
    let fail = false;
    const writes = [];
    const api = vm.runInNewContext(`(() => { ${stripImports(functions)} return { saveDocument, deleteDocumentById }; })()`, {
      isLocalDevMode: false, db: {}, invalidatePublicCollection: runtime.invalidatePublicCollection,
      collection: (_db, name) => ({ name }), doc: (_db, name, id) => ({ name, id: id || 'new' }), serverTimestamp: () => 'timestamp',
      setDoc: async (target, payload) => {
        if (fail) throw errorWith('permission-denied');
        writes.push(['save', target.name]);
        const existing = responses.get(target.name) || [];
        responses.set(target.name, [...existing.filter(item => item.id !== target.id), { id: target.id, ...payload }]);
      },
      deleteDoc: async target => {
        if (fail) throw errorWith('permission-denied');
        writes.push(['delete', target.name]);
        responses.set(target.name, (responses.get(target.name) || []).filter(item => item.id !== target.id));
      }
    });
    return { ...api, writes, fail(value) { fail = value; } };
  }
  return { runtime, admin, reads, values, storage, responses, advance, subscriptions: () => subscriptions };
}
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

await check('Home, global search, same-language navigation and English navigation reuse each collection', async () => {
  const f = fixture();
  const home = f.runtime();
  await Promise.all([home.refreshPublicData(), home.loadGlobalSearch()]);
  assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 1 });
  const search = await home.loadGlobalSearch();
  assert.equal(search.partial, false);
  assert.equal(search.items.length, 4);
  for (const [page, lang] of [['publications', 'kr'], ['home', 'kr'], ['members', 'en'], ['home', 'en']]) {
    const next = f.runtime(page, lang);
    next.applyCachedState();
    assert.equal(next.state.members[0].id, 'member');
    await next.refreshPublicData();
    await next.loadGlobalSearch();
  }
  assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 1 });
  assert.equal(f.subscriptions(), 0);
});

await check('Successful empty collections stay empty and display a known zero after reload', async () => {
  const f = fixture({ members: [], projects: [], publications: [], patents: [], boardPosts: [] });
  await f.runtime().refreshPublicData();
  const next = f.runtime('home', 'en');
  next.applyCachedState();
  await next.refreshPublicData();
  const search = await next.loadGlobalSearch();
  assert.equal(search.items.length, 0);
  assert.equal(search.partial, false);
  assert.equal(next.resolvedCollections.size, 5);
  // Force a visible render with the same production hydration path, without another read.
  next.state.loadingMembers = true;
  await next.refreshPublicData();
  for (const record of Object.values(next.renders.at(-1))) {
    assert.equal(record.items.length, 0);
    assert.match(record.summary, /data-target="0"/);
    assert.doesNotMatch(record.summary, /<strong>—<\/strong>/);
  }
  assert.equal(Object.values(f.reads).reduce((sum, value) => sum + value, 0), 5);
});

await check('Quota and network errors preserve previous items, count and timestamp', async () => {
  for (const error of [errorWith('resource-exhausted'), new TypeError('Failed to fetch')]) {
    const f = fixture();
    const home = f.runtime();
    await home.refreshPublicData();
    const before = f.values.get(home.publicCollectionCache.keyFor('members'));
    f.responses.set('members', error);
    await f.advance(600000);
    await home.refreshPublicData();
    assert.equal(home.state.members[0].id, 'member');
    assert.equal(home.dataIssues.has('members'), true);
    assert.match(home.renders.at(-1).members.summary, /data-target="1"/);
    assert.equal(f.values.get(home.publicCollectionCache.keyFor('members')), before);
    assert.equal(home.notices.at(-1).tone, 'warning');
    assert.equal((await home.loadGlobalSearch()).partial, true);
    assert.equal(f.reads.members, 2, 'Failure cooldown prevents immediate search retry');
    const next = f.runtime('home', 'en');
    await next.refreshPublicData();
    assert.equal(next.state.members[0].id, 'member', 'Stale persisted success survives a new page');
  }
});

await check('One failed collection does not block healthy collections or create a false zero', async () => {
  const f = fixture({ patents: errorWith('permission-denied') });
  const home = f.runtime();
  await home.refreshPublicData();
  assert.equal(home.state.members.length, 1);
  assert.equal(home.state.publications.length, 1);
  assert.equal(home.state.patentsError, true);
  assert.equal(home.resolvedCollections.has('patents'), false);
  assert.match(home.renders.at(-1).patents.summary, /<strong>—<\/strong>/);
  assert.doesNotMatch(home.renders.at(-1).patents.summary, /data-target="0"/);
  assert.equal(home.publicCollectionCache.read('patents', { allowStale: true }), null);
  const search = await home.loadGlobalSearch();
  assert.equal(search.partial, true);
  assert.equal(search.items.length, 4);
});

await check('Only successful administrator save/delete invalidates the affected public collection', async () => {
  const f = fixture();
  const home = f.runtime();
  await home.refreshPublicData();
  home.setupPublicDataRefresh();
  const admin = f.admin(home);
  await admin.saveDocument('boardPosts', 'post', { title: 'Changed post', category: 'article' });
  await flush();
  assert.equal(home.state.board[0].title, 'Changed post');
  assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 2 });
  await admin.deleteDocumentById('boardPosts', 'post');
  await flush();
  assert.equal(home.state.board.length, 0);
  assert.match(home.renders.at(-1).board.summary, /data-target="0"/);
  assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 3 });
  admin.fail(true);
  await assert.rejects(admin.saveDocument('members', 'member', {}), { code: 'permission-denied' });
  await assert.rejects(admin.deleteDocumentById('members', 'member'), { code: 'permission-denied' });
  await home.refreshPublicData();
  assert.equal(f.reads.members, 1, 'A failed write does not invalidate a valid public cache');
});

await check('An invalidated in-flight response never restores obsolete data', async () => {
  const f = fixture();
  const gate = deferred();
  f.responses.set('members', () => gate.promise);
  const home = f.runtime();
  const pending = home.refreshPublicData();
  await flush();
  home.invalidatePublicCollection('members');
  f.responses.set('members', [{ id: 'updated', nameKr: '갱신된 멤버', group: 'pi' }]);
  gate.resolve([{ id: 'obsolete', nameKr: '오래된 멤버', group: 'pi' }]);
  await pending;
  await flush();
  assert.equal(home.state.members[0].id, 'updated');
  assert.equal(home.renders.some(render => render.members.items.some(item => item.id === 'obsolete')), false);
  assert.equal(home.publicCollectionCache.read('members').items[0].id, 'updated');
  assert.equal(f.reads.members, 2);
});

await check('An early settled collection cannot overwrite a save while another collection is pending', async () => {
  const f = fixture();
  const gate = deferred();
  f.responses.set('projects', () => gate.promise);
  const home = f.runtime();
  home.setupPublicDataRefresh();
  const pending = home.refreshPublicData();
  await flush();
  assert.equal(home.publicCollectionCache.read('members').items[0].id, 'member');
  const admin = f.admin(home);
  await admin.saveDocument('members', 'member', { nameKr: '갱신된 멤버', group: 'pi' });
  gate.resolve([{ id: 'project', titleKr: '과제' }]);
  await pending;
  await flush();
  assert.equal(home.state.members[0].nameKr, '갱신된 멤버');
  assert.equal(home.renders.some(render => render.members.items.some(item => item.nameKr === '테스트 멤버')), false);
  assert.deepEqual(f.reads, { members: 2, projects: 1, publications: 1, patents: 1, boardPosts: 1 });
});

await check('Global search retries an invalidated batch without returning obsolete member results', async () => {
  const f = fixture();
  const gate = deferred();
  f.responses.set('projects', () => gate.promise);
  const page = f.runtime('publications', 'en');
  const pending = page.loadGlobalSearch();
  await flush();
  await f.admin(page).saveDocument('members', 'member', { nameKr: '갱신된 멤버', nameEn: 'Updated Member', group: 'pi' });
  gate.resolve([{ id: 'project', titleEn: 'Test Project' }]);
  const search = await pending;
  assert.equal(search.partial, false);
  assert.equal(search.items.some(item => item.title === 'Updated Member'), true);
  assert.equal(search.items.some(item => item.title === 'Test Member'), false);
  assert.deepEqual(f.reads, { members: 2, projects: 1, publications: 1, patents: 1, boardPosts: 1 });
});

await check('A save in another tab invalidates only that collection through the production storage event', async () => {
  const f = fixture();
  const home = f.runtime();
  await home.refreshPublicData();
  home.setupPublicDataRefresh();
  const otherTab = f.runtime('board', 'en');
  const key = home.publicCollectionCache.keyFor('boardPosts');
  const previousRevision = home.getPublicCollectionRevision('boardPosts');
  await f.admin(otherTab).saveDocument('boardPosts', 'post', { title: 'Saved in another tab', category: 'article' });
  home.window.dispatchEvent({ type: 'storage', key, newValue: f.values.get(key), storageArea: f.storage });
  await flush();
  assert.equal(home.getPublicCollectionRevision('boardPosts'), previousRevision + 1);
  assert.equal(home.state.board[0].title, 'Saved in another tab');
  assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 2 });
});

await check('A hung server request stops waiting after fifteen seconds and a late response cannot populate cache', async () => {
  const f = fixture();
  const gate = deferred();
  f.responses.set('members', () => gate.promise);
  const page = f.runtime('members');
  const request = page.fetchCollectionResult('members');
  // Attach a rejection handler before advancing virtual time.
  const rejected = assert.rejects(request, { code: 'deadline-exceeded' });
  await flush();
  await f.advance(15000);
  await rejected;
  assert.equal(page.publicCollectionCache.read('members', { allowStale: true }), null);
  gate.resolve([{ id: 'too-late' }]);
  await flush();
  assert.equal(page.publicCollectionCache.read('members', { allowStale: true }), null);
  await assert.rejects(page.fetchCollectionResult('members'), { code: 'deadline-exceeded' });
  assert.equal(f.reads.members, 1, 'Timeout also uses the failure cooldown');
});

await check('Hidden pages defer queued refreshes and invalidated responses until visibility returns', async () => {
  // Cover both an adapter request invalidated before it settles and a member
  // response already settled while the outer home batch still waits for projects.
  for (const pendingCollection of ['members', 'projects']) {
    const f = fixture();
    const gate = deferred();
    f.responses.set(pendingCollection, () => gate.promise);
    const home = f.runtime();
    home.setupPublicDataRefresh();
    const pending = home.refreshPublicData();
    await flush();
    home.invalidatePublicCollection('members');
    f.responses.set('members', [{ id: 'updated', nameKr: '갱신된 멤버', group: 'pi' }]);
    home.document.hidden = true;
    home.document.dispatchEvent({ type: 'visibilitychange' });
    gate.resolve(pendingCollection === 'members'
      ? [{ id: 'obsolete', nameKr: '오래된 멤버', group: 'pi' }]
      : [{ id: 'project', titleKr: '과제' }]);
    await pending;
    await flush();
    await home.refreshPublicData();
    home.window.dispatchEvent({ type: 'focus' });
    home.window.dispatchEvent({ type: 'pageshow' });
    await f.advance(60000);
    assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 1 }, `${pendingCollection}: no retry while hidden`);
    assert.equal(home.publicCollectionCache.read('members', { allowStale: true }), null);
    assert.equal(home.renders.some(render => render.members.items.length > 0), false, 'Neither obsolete nor early-settled member data is rendered');
    assert.equal(home.timers.size, 0, 'Hidden page leaves no polling or request timer');
    home.document.hidden = false;
    home.document.dispatchEvent({ type: 'visibilitychange' });
    await flush();
    assert.equal(home.state.members[0].id, 'updated');
    assert.deepEqual(f.reads, { members: 2, projects: 1, publications: 1, patents: 1, boardPosts: 1 }, `${pendingCollection}: only invalidated members refresh on return`);
    home.window.dispatchEvent({ type: 'focus' });
    await flush();
    assert.equal(f.reads.members, 2, 'The queued refresh flag does not force another fetch after returning');
  }
});

await check('Global search defers invalidated-batch retries while hidden and refreshes when reopened', async () => {
  for (const pendingCollection of ['members', 'projects']) {
    const f = fixture();
    const gate = deferred();
    f.responses.set(pendingCollection, () => gate.promise);
    const page = f.runtime('publications', 'en');
    const pending = page.loadGlobalSearch();
    await flush();
    page.invalidatePublicCollection('members');
    f.responses.set('members', [{ id: 'updated', nameEn: 'Updated Member', group: 'pi' }]);
    page.document.hidden = true;
    page.document.dispatchEvent({ type: 'visibilitychange' });
    gate.resolve(pendingCollection === 'members'
      ? [{ id: 'obsolete', nameEn: 'Obsolete Member', group: 'pi' }]
      : [{ id: 'project', titleEn: 'Test Project' }]);
    const partial = await pending;
    await flush();
    assert.equal(partial.partial, true);
    assert.equal(partial.items.some(item => item.group === 'Members'), false, 'Invalidated members cannot appear in partial search');
    assert.deepEqual(f.reads, { members: 1, projects: 1, publications: 1, patents: 1, boardPosts: 1 }, `${pendingCollection}: hidden search performs no retry`);
    assert.equal(page.timers.size, 0);
    page.document.hidden = false;
    const current = await page.loadGlobalSearch();
    assert.equal(current.partial, false);
    assert.equal(current.items.some(item => item.title === 'Updated Member'), true);
    assert.deepEqual(f.reads, { members: 2, projects: 1, publications: 1, patents: 1, boardPosts: 1 });
  }
});

await check('Visible scheduler and focus reuse fresh data; expiry refreshes once and hidden pages pause', async () => {
  const f = fixture();
  const home = f.runtime();
  await home.refreshPublicData();
  home.setupPublicDataRefresh();
  for (let minute = 0; minute < 9; minute++) {
    await f.advance(60000);
    home.window.dispatchEvent({ type: 'focus' });
    home.window.dispatchEvent({ type: 'pageshow' });
    await flush();
  }
  assert.equal(Object.values(f.reads).reduce((sum, value) => sum + value, 0), 5);
  await f.advance(60000);
  assert.equal(Object.values(f.reads).reduce((sum, value) => sum + value, 0), 10);
  home.document.hidden = true;
  home.document.dispatchEvent({ type: 'visibilitychange' });
  await f.advance(1200000);
  assert.equal(Object.values(f.reads).reduce((sum, value) => sum + value, 0), 10);
  home.document.hidden = false;
  home.document.dispatchEvent({ type: 'visibilitychange' });
  await flush();
  assert.equal(Object.values(f.reads).reduce((sum, value) => sum + value, 0), 15);
  assert.equal(f.subscriptions(), 0);
});

console.log(`Public data verification passed: ${checks} offline integration checks, no live Firebase access.`);
