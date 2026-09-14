import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createCollectionCache } from '../assets/js/collection-cache.js';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as inventors from '../assets/js/patent-inventors.js';
import * as data from '../assets/js/data.js';

// Exercise the production modal/data code with an in-memory document, fake time,
// storage and Firestore. No Firebase SDK, credentials or network are used.
const sources = Object.fromEntries(await Promise.all(['public-data-cache', 'firebase-public', 'public'].map(async (name) => [name, await fs.readFile(new URL(`../assets/js/${name}.js`, import.meta.url), 'utf8')])));
const stripImports = (source) => source.replace(/^import\s+[\s\S]*?;\s*$/gm, '').replace(/^export\s+/gm, '');
const failure = (code) => Object.assign(new Error(code), { code });
const flush = async () => { for (let count = 0; count < 80; count++) await Promise.resolve(); };
const memberA = { id: 'member-a', nameKr: '연구자 가', nameEn: 'Researcher A', group: 'researchProfessor' };
const memberB = { id: 'member-b', nameKr: '연구자 나', nameEn: 'Researcher B', group: 'graduateStudent', course: 'phd' };
const makePatent = (id, status = 'pending', ids = ['member-a']) => ({
  id, titleKr: `특허 ${id}`, titleEn: `Patent ${id}`, status,
  inventorMemberIds: ids, inventorsKr: '연구자 가, 외부 발명자',
  applicationNumber: `application-${id}`, applicationDate: '2024-06-12',
  registrationNumber: status === 'granted' ? `registration-${id}` : '',
  registrationDate: status === 'granted' ? '2026-09-12' : ''
});
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
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); }
  };
}
function classList() {
  const values = new Set();
  return { add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)), contains: (name) => values.has(name), toggle(name, force) { const next = force ?? !values.has(name); if (next) values.add(name); else values.delete(name); } };
}
function fixture(initialPatents = []) {
  let clock = 1000000;
  const values = new Map();
  const reads = {};
  const answers = new Map([['members', [memberA, memberB]], ['projects', []], ['publications', []], ['patents', initialPatents], ['boardPosts', []]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const snapshot = (items) => ({ docs: items.map(({ id, ...record }) => ({ id, data: () => record })) });
  const firestore = { db: {}, collection: (_db, name) => name, async getDocsFromServer(name) {
    reads[name] = (reads[name] || 0) + 1;
    const answer = answers.get(name);
    const result = typeof answer === 'function' ? await answer() : answer;
    if (result instanceof Error) throw result;
    return snapshot(result || []);
  }, onSnapshot() { throw new Error('Public member profiles must not subscribe to Firestore.'); } };
  const runtimes = [];
  function runtime(page = 'members', lang = 'kr') {
    const timers = new Map();
    let timerId = 0;
    const setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; };
    const clearTimeout = (id) => timers.delete(id);
    const window = { ...events(), localStorage: storage, GEH_FIREBASE_CONFIG: { apiKey: 'offline-fixture', projectId: 'offline-member-patents' }, GEH_LOCAL_DEV_MODE: false,
      location: { hostname: 'offline.example', protocol: 'https:' }, matchMedia: () => ({ matches: true }), setTimeout, clearTimeout };
    const document = { ...events(), hidden: false, activeElement: null,
      body: { dataset: { page, lang, root: lang === 'en' ? '..' : '.' }, classList: classList() },
      documentElement: { classList: classList() }, querySelector: () => null, querySelectorAll: () => [] };
    class FakeDate extends Date { static now() { return clock; } }
    const base = { window, document, localStorage: storage, Date: FakeDate, URL, URLSearchParams, setTimeout, clearTimeout,
      HTMLElement: class {}, requestAnimationFrame: (callback) => callback(),
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
      console: { warn() {}, error() {} }, fetch: () => { throw new Error('Network access is prohibited in this test.'); } };
    const bus = vm.runInNewContext(`(() => { ${stripImports(sources['public-data-cache'])}\nreturn { publicCollectionCache, invalidatePublicCollection, PUBLIC_DATA_CHANGED, getPublicCollectionRevision }; })()`, {
      ...base, createCollectionCache: (options) => createCollectionCache({ ...options, now: () => clock })
    }, { filename: 'public-data-cache.js' });
    const adapter = vm.runInNewContext(`(() => { ${stripImports(sources['firebase-public'])}\nfirestoreContext = injectedFirestore; return { COLLECTIONS, hasFirebaseConfig, isLocalDevMode, fetchCollectionResult, readCachedCollection }; })()`, {
      ...base, ...bus, injectedFirestore: firestore
    }, { filename: 'firebase-public.js' });
    const api = vm.runInNewContext(`(() => { ${stripImports(sources.public)}\n
      renderPage = () => {};
      return { state, modalState, resolvedCollections, dataIssues, renderMemberPatentBlock, refreshOpenMemberPatentBlock, ensureMemberPatents,
        openMemberModal, openModal, closeModal, refreshPublicData, setupPublicDataRefresh, loadGlobalSearch };
    })()`, { ...base, ...bus, ...adapter, ...utils, ...patents, ...inventors, ...data,
      portraitMarkup: () => '<span class="fixture-portrait"></span>', refreshImageFallbacks() {}, setSpatialOrigin() {}
    }, { filename: 'public.js' });
    api.state.members = [memberA, memberB];
    let fullWrites = 0, slotWrites = 0, currentSlot = null;
    const bodyNode = {
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(html) {
        fullWrites++; this._html = html;
        const found = html.match(/<article[^>]*data-member-patents="([^"]*)"[^>]*>([\s\S]*?)<\/article>/);
        currentSlot = found ? { dataset: { memberPatents: found[1] }, _html: found[2],
          get innerHTML() { return this._html; }, set innerHTML(next) { slotWrites++; this._html = next; }
        } : null;
      },
      querySelector(selector) { if (selector === '[data-member-patents]') return currentSlot; if (selector === '.detail-modal--member') return this._html.includes('detail-modal--member') ? {} : null; return null; }
    };
    const rootNode = { hidden: true, classList: classList(), setAttribute() {}, querySelector: () => null };
    Object.assign(api.modalState, { root: rootNode, title: { textContent: '' }, body: bodyNode, closeButtons: [], closeButton: { focus() {} } });
    const result = { ...api, ...bus, ...adapter, document, window, timers, bodyNode, rootNode,
      slot: () => currentSlot, html: () => currentSlot?.innerHTML || '', writes: () => ({ full: fullWrites, slot: slotWrites }) };
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
  return { runtime, answers, reads, advance };
}

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

await check('Registered and filed patents are separate, member-specific counts in Korean and English', async () => {
  const f = fixture([makePatent('granted', 'granted'), makePatent('filed'), makePatent('other', 'granted', ['member-b'])]);
  for (const lang of ['kr', 'en']) {
    const r = f.runtime('members', lang);
    r.openMemberModal(memberA);
    await r.ensureMemberPatents();
    assert.match(r.html(), lang === 'kr' ? /등록 1건/ : /Granted 1/);
    assert.match(r.html(), lang === 'kr' ? /출원 1건/ : /Filed 1/);
    assert.match(r.html(), /2026-09-12/);
    assert.match(r.html(), /2024-06-12/);
    assert.doesNotMatch(r.html(), /registration-other/);
  }
  assert.equal(f.reads.patents, 1, 'Language navigation must reuse the same collection cache');
});

await check('Profile load is lazy on all pages and repeated member opens reuse one pending request', async () => {
  const f = fixture();
  const wait = deferred();
  f.answers.set('patents', () => wait.promise);
  const r = f.runtime('publications');
  await r.refreshPublicData();
  assert.equal(f.reads.patents, undefined);
  r.openMemberModal(memberA);
  const first = r.ensureMemberPatents();
  assert.match(r.html(), /불러오는 중/);
  assert.doesNotMatch(r.html(), /(?:등록|출원) 0건/);
  r.openMemberModal(memberB);
  const second = r.ensureMemberPatents();
  assert.equal(first, second);
  const writesBeforeReply = r.writes().full;
  wait.resolve([makePatent('for-a', 'granted'), makePatent('for-b', 'pending', ['member-b'])]);
  await second;
  assert.equal(f.reads.patents, 1);
  assert.equal(r.modalState.memberId, 'member-b');
  assert.match(r.html(), /특허 for-b/);
  assert.doesNotMatch(r.html(), /특허 for-a/);
  assert.equal(r.writes().full, writesBeforeReply, 'Arriving data must not recreate the portrait or the whole modal');
});

await check('A delayed response cannot repaint a closed member profile or replace another kind of modal', async () => {
  for (const action of ['close', 'switch']) {
    const f = fixture();
    const wait = deferred();
    f.answers.set('patents', () => wait.promise);
    const r = f.runtime('projects');
    r.openMemberModal(memberA);
    const pending = r.ensureMemberPatents();
    if (action === 'close') r.closeModal();
    else r.openModal('Other detail', '<div class="detail-modal--project">Unchanged project</div>');
    const writesBeforeReply = r.writes();
    wait.resolve([makePatent('late', 'granted')]);
    await pending;
    assert.equal(r.modalState.memberId, '');
    assert.deepEqual(r.writes(), writesBeforeReply);
    if (action === 'switch') assert.match(r.bodyNode.innerHTML, /Unchanged project/);
    await f.advance(0);
    if (action === 'close') assert.equal(r.rootNode.hidden, true);
  }
});

await check('Zero counts appear only after a successful empty response', async () => {
  const f = fixture();
  const wait = deferred();
  f.answers.set('patents', () => wait.promise);
  const r = f.runtime();
  r.openMemberModal(memberA);
  const pending = r.ensureMemberPatents();
  assert.doesNotMatch(r.html(), /등록 0건|출원 0건/);
  wait.resolve([]);
  await pending;
  assert.match(r.html(), /등록 0건/);
  assert.match(r.html(), /출원 0건/);
  assert.match(r.html(), /연결된 특허가 아직 없습니다/);
});

await check('An initial permission or quota failure does not report zero patents', async () => {
  for (const code of ['permission-denied', 'resource-exhausted']) {
    const f = fixture();
    f.answers.set('patents', failure(code));
    const r = f.runtime();
    r.openMemberModal(memberA);
    await r.ensureMemberPatents();
    assert.match(r.html(), /건수를 확인할 수 없습니다/);
    assert.doesNotMatch(r.html(), /등록 0건|출원 0건/);
    assert.equal(r.resolvedCollections.has('patents'), false);
  }
});

await check('A recoverable refresh failure preserves known counts and clearly labels stale information', async () => {
  const f = fixture([makePatent('known', 'granted')]);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  await f.advance(600001);
  f.answers.set('patents', failure('resource-exhausted'));
  await r.ensureMemberPatents();
  assert.match(r.html(), /등록 1건/);
  assert.match(r.html(), /마지막으로 불러온 특허 정보/);
  assert.equal(f.reads.patents, 2);
  await r.ensureMemberPatents();
  assert.equal(f.reads.patents, 2, 'The failure cooldown must avoid repeat quota-exhausted reads');
});

await check('Fresh counts are reused for ten minutes and refreshed afterward without rebuilding the profile', async () => {
  const f = fixture([makePatent('first', 'granted')]);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  const fullWrites = r.writes().full;
  await f.advance(599999);
  await r.ensureMemberPatents();
  assert.equal(f.reads.patents, 1);
  f.answers.set('patents', [makePatent('first', 'granted'), makePatent('second')]);
  await f.advance(2);
  await r.ensureMemberPatents();
  assert.equal(f.reads.patents, 2);
  assert.match(r.html(), /출원 1건/);
  assert.equal(r.writes().full, fullWrites);
});

await check('An administrator invalidation updates an open profile through the shared refresh path', async () => {
  const f = fixture([makePatent('old')]);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  r.setupPublicDataRefresh();
  const fullWrites = r.writes().full;
  f.answers.set('patents', [makePatent('new', 'granted')]);
  r.invalidatePublicCollection('patents');
  await flush();
  assert.match(r.html(), /등록 1건/);
  assert.match(r.html(), /출원 0건/);
  assert.doesNotMatch(r.html(), /특허 old/);
  assert.equal(r.writes().full, fullWrites);
  assert.equal(f.reads.patents, 2);
});

await check('Invalidating an in-flight profile request cannot restore old patent counts', async () => {
  const f = fixture();
  const wait = deferred();
  f.answers.set('patents', () => wait.promise);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await flush();
  f.answers.set('patents', [makePatent('current', 'granted')]);
  r.invalidatePublicCollection('patents');
  wait.resolve([makePatent('outdated')]);
  await flush();
  assert.match(r.html(), /등록 1건/);
  assert.doesNotMatch(r.html(), /特許 outdated|특허 outdated/);
  assert.equal(f.reads.patents, 2);
});

await check('Patent titles, identifiers and links are escaped and unsafe URL schemes never reach anchors', async () => {
  const unsafe = { ...makePatent('unsafe'), titleKr: '<img src=x onerror=alert(1)>', applicationNumber: '<script>bad</script>', url: 'javascript:alert(1)' };
  const safe = { ...makePatent('safe', 'granted'), url: 'https://example.test/patent?a=1&b=2' };
  const f = fixture([unsafe, safe]);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  assert.doesNotMatch(r.html(), /<img|<script|href="javascript:/i);
  assert.match(r.html(), /&lt;img/);
  assert.match(r.html(), /href="patents\.html\?item=unsafe"/);
  assert.match(r.html(), /https:\/\/example\.test\/patent\?a=1&amp;b=2/);
  assert.match(r.html(), /rel="noopener noreferrer"/);
});

await check('Legacy names support existing patents while an explicit empty linkage remains unlinked', async () => {
  const legacy = { ...makePatent('legacy', 'granted'), inventorsKr: '연구자 가, 외부 발명자' };
  delete legacy.inventorMemberIds;
  const explicit = { ...makePatent('explicit', 'pending', []), inventorsKr: '연구자 가' };
  const f = fixture([legacy, explicit]);
  const r = f.runtime();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  assert.match(r.html(), /등록 1건/);
  assert.match(r.html(), /출원 0건/);
  assert.doesNotMatch(r.html(), /특허 explicit/);
});

await check('Opening global search while a profile is loading shares its patent request', async () => {
  const f = fixture();
  const wait = deferred();
  f.answers.set('patents', () => wait.promise);
  const r = f.runtime('projects');
  r.openMemberModal(memberA);
  const search = r.loadGlobalSearch();
  await flush();
  assert.equal(f.reads.patents, 1);
  wait.resolve([makePatent('shared', 'granted')]);
  const result = await search;
  await flush();
  assert.equal(result.partial, false);
  assert.match(r.html(), /등록 1건/);
  assert.equal(f.reads.patents, 1);
});

await check('Patent-only invalidations do not make closed profiles fetch extra collections', async () => {
  const f = fixture([makePatent('original')]);
  const r = f.runtime('members');
  r.setupPublicDataRefresh();
  r.openMemberModal(memberA);
  await r.ensureMemberPatents();
  r.closeModal();
  await f.advance(0);
  const readsBefore = { ...f.reads };
  r.invalidatePublicCollection('patents');
  await flush();
  assert.deepEqual(f.reads, readsBefore);
});

await check('A timed-out request exits loading without claiming a zero count', async () => {
  const f = fixture();
  f.answers.set('patents', () => new Promise(() => {}));
  const r = f.runtime();
  r.openMemberModal(memberA);
  const pending = r.ensureMemberPatents();
  await flush();
  await f.advance(15001);
  await pending;
  assert.match(r.html(), /건수를 확인할 수 없습니다/);
  assert.doesNotMatch(r.html(), /등록 0건|출원 0건|불러오는 중/);
});

console.log(`Member patent profile verification passed: ${checks} scenarios.`);
