import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolvePatentInventors, buildPatentInventorFields } from '../assets/js/patent-inventors.js';
import { normalizePatent, validatePatent, sortPatents, patentText } from '../assets/js/patents.js';
import { adminSubscriptionKeys, createAdminSubscriptions } from '../assets/js/admin-data-subscriptions.js';

// Execute the real editor, subscription callbacks and save handler. The small
// form/DOM below substitutes browser layout only; Firebase is never contacted.
const source = (await readFile(new URL('../assets/js/admin.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /id="patent-inventor-picker"/);
assert.match(html, /name="externalInventorsKr"/);
assert.match(html, /name="externalInventorsEn"/);
assert.doesNotMatch(html, /name="inventorsKr"[^>]*required/);
const members = [
  { id: 'park', nameKr: '박종석', nameEn: 'Jong Seok Park' },
  { id: 'ham', nameKr: '함승용', nameEn: 'Seung Yong Ham' }
];
const base = { id: 'p1', titleKr: '기존 특허', applicationNumber: '2022-001', applicationDate: '2022-11-30', status: 'pending', countryKr: '대한민국', inventorsKr: '박종석, 외부 연구자' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function harness({ ready = true } = {}) {
  const callbacks = [];
  const writes = [];
  const notices = [];
  const controls = ['titleKr', 'titleEn', 'externalInventorsKr', 'externalInventorsEn', 'applicantKr', 'applicantEn', 'countryKr', 'countryEn', 'applicationNumber', 'applicationDate', 'status', 'registrationNumber', 'registrationDate', 'url', 'descriptionKr', 'descriptionEn']
    .map((name) => ({ name, value: '', disabled: false }));
  controls.namedItem = (name) => controls.find((field) => field.name === name);
  const form = {
    id: 'patent-form', dataset: {}, elements: controls,
    reset() { controls.forEach((field) => { field.value = field.name === 'status' ? 'pending' : ''; }); },
    setAttribute() {}, querySelector() { return null; }
  };
  const picker = {
    dataset: {}, markup: '', rows: [],
    get innerHTML() { return this.markup; },
    set innerHTML(value) {
      this.markup = value;
      this.rows = [...value.matchAll(/class="publication-picker__item patent-inventor-option" data-search="([^"]*)"/g)]
        .map((match) => ({ dataset: { search: match[1] }, style: {} }));
    },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === '.publication-picker__item' ? this.rows : []; },
    appendChild() {}
  };
  const selectors = new Map([
    ['#patent-form', form], ['#patent-inventor-picker', picker], ['#patent-inventor-preview', {}],
    ['#patent-form-title', {}], ['#patent-registration-fields', {}], ['#patent-search-admin', {}]
  ]);
  const copy = (items = []) => [...items];
  const context = vm.createContext({
    console, structuredClone, URL, TextEncoder,
    resolvePatentInventors, buildPatentInventorFields, normalizePatent, validatePatent, sortPatents, patentText,
    adminSubscriptionKeys, createAdminSubscriptions, escapeHTML,
    hasFirebaseConfig: true, isLocalDevMode: false, isLocalAdminPreview: false,
    FALLBACK_MEMBERS: [], FALLBACK_PROJECTS: [], FALLBACK_PUBLICATIONS: [], FALLBACK_BOARD_POSTS: [],
    sortMembers: copy, sortProjects: copy, sortPublications: copy, sortBoardPosts: copy,
    isActiveItem: (item) => !item.deleted,
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts', trash: 'trash' },
    FormData: class { constructor(target) { this.target = target; } *[Symbol.iterator]() { for (const field of this.target.elements) if (!field.disabled) yield [field.name, field.value]; } },
    listenCollection(name, onData, onError) {
      const callback = { name, onData, onError, stopped: false };
      callbacks.push(callback);
      return () => { callback.stopped = true; };
    },
    saveDocument: async (collection, id, payload) => { writes.push({ collection, id, payload: plain(payload) }); return id || 'new-patent'; },
    document: { body: { dataset: {} }, querySelector: (key) => selectors.get(key) || null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) },
    window: { matchMedia: () => ({ matches: false }), clearTimeout() {}, setTimeout() {} },
    recordNotice: (message) => notices.push(message)
  });
  vm.runInContext(`${source}
    openEditor = (kind) => { state.openEditorKind = kind; syncAdminSubscriptions(); };
    closeEditor = () => { state.openEditorKind = ''; syncAdminSubscriptions(); };
    showNotice = recordNotice;
    globalThis.test = { state, elements, adminSubscriptions, loadPatentForm, resetPatentForm, collectPatentInventors, handlePatentSubmit, onPatentInventorInput, onPatentInventorSelection, renderPendingEditorPickers };
  `, context);
  const test = context.test;
  test.state.user = { uid: 'test-admin' };
  test.state.activeTab = 'patents';
  test.state.members = ready ? structuredClone(members) : [];
  test.state.collectionReads.set('members', { status: ready ? 'ready' : 'idle', hasData: ready });
  const value = (name, text) => {
    const field = controls.namedItem(name);
    if (text !== undefined) field.value = text;
    return field.value;
  };
  const type = (name, text) => { value(name, text); test.onPatentInventorInput({ target: controls.namedItem(name) }); };
  const select = (id, checked) => test.onPatentInventorSelection({ target: { closest: () => ({ dataset: { patentInventorId: id }, checked }) } });
  const submit = () => test.handlePatentSubmit({ preventDefault() {}, currentTarget: form });
  const arrive = (items = members) => callbacks.findLast((callback) => callback.name === 'members' && !callback.stopped).onData(items);
  return { ...test, callbacks, writes, notices, picker, value, type, select, submit, arrive };
}

let count = 0;
async function check(name, fn) { await fn(); count += 1; console.log(`✓ ${name}`); }

await check('Legacy names become checked members and unmatched external names', () => {
  const h = harness(); h.loadPatentForm(base);
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['park']);
  assert.equal(h.value('externalInventorsKr'), '외부 연구자');
  assert.match(h.picker.innerHTML, /aria-label="박종석 발명자" checked/);
  assert.deepEqual(plain(h.adminSubscriptions.keys()), ['patents', 'members']);
});

await check('Save composes names and stable links, then reopening retains the selection', async () => {
  const h = harness(); h.loadPatentForm(base); h.select('ham', true);
  h.type('externalInventorsKr', '외부 연구자, 새 발명자');
  h.type('externalInventorsEn', 'Outside Researcher, New Inventor');
  await h.submit();
  const saved = h.writes[0].payload;
  assert.deepEqual(saved.inventorMemberIds, ['park', 'ham']);
  assert.match(saved.inventorsKr, /박종석.*함승용.*외부 연구자.*새 발명자/);
  assert.match(saved.inventorsEn, /Jong Seok Park.*Seung Yong Ham.*Outside Researcher/);
  assert.deepEqual(plain(h.adminSubscriptions.keys()), ['patents'], 'Closing the saved editor releases members');
  h.loadPatentForm({ ...saved, id: 'p1' });
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['park', 'ham']);
  assert.equal(h.value('externalInventorsKr'), '외부 연구자, 새 발명자');
});

await check('Late first member snapshot infers untouched legacy text', () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  assert.equal(h.value('externalInventorsKr'), base.inventorsKr);
  h.value('titleKr', '다른 항목만 수정');
  h.arrive();
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['park']);
  assert.equal(h.value('externalInventorsKr'), '외부 연구자');
  assert.equal(h.value('titleKr'), '다른 항목만 수정');
});

await check('Late member snapshots preserve typed external names and manual choices', () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  h.type('externalInventorsKr', '직접 수정한 이름'); h.arrive();
  assert.equal(h.value('externalInventorsKr'), '직접 수정한 이름');
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
  h.select('ham', true); h.arrive();
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['ham']);
  assert.equal(h.value('externalInventorsKr'), '직접 수정한 이름');
});

await check('Explicit empty selection stays unlinked despite matching external names', async () => {
  const h = harness(); h.loadPatentForm(base); h.select('park', false);
  h.type('externalInventorsKr', '박종석'); await h.submit();
  assert.deepEqual(h.writes[0].payload.inventorMemberIds, []);
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
});

await check('Missing saved IDs and name snapshots survive edits and can be removed', async () => {
  const h = harness();
  h.loadPatentForm({ ...base, inventorMemberIds: ['missing'], inventorMembers: [{ memberId: 'missing', nameKr: '옛 멤버', nameEn: 'Past Member' }], externalInventorsKr: '외부인', externalInventorsEn: '' });
  assert.match(h.picker.innerHTML, /옛 멤버 발명자" checked/);
  assert.match(h.picker.innerHTML, /저장된 멤버 연결/);
  await h.submit();
  assert.deepEqual(h.writes[0].payload.inventorMemberIds, ['missing']);
  assert.equal(h.writes[0].payload.inventorMembers[0].nameKr, '옛 멤버');
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' }); h.select('missing', false); await h.submit();
  assert.deepEqual(h.writes[1].payload.inventorMemberIds, []);
  assert.equal(h.writes[1].payload.inventorsKr, '외부인');
});

await check('Member read failure permits external-only saves and retains legacy names', async () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  h.callbacks.find((callback) => callback.name === 'members').onError({ code: 'permission-denied' });
  await h.submit();
  assert.equal(h.writes[0].payload.inventorsKr, base.inventorsKr);
  assert.deepEqual(h.writes[0].payload.inventorMemberIds, []);
});

await check('No inventor prevents saving, and reset clears inventor state', async () => {
  const h = harness(); h.loadPatentForm(base); h.select('park', false); h.type('externalInventorsKr', '');
  await h.submit(); assert.equal(h.writes.length, 0); assert.ok(h.notices.some((notice) => /발명자/.test(notice)));
  h.resetPatentForm();
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
  assert.equal(h.value('externalInventorsKr'), '');
  assert.equal(h.value('externalInventorsEn'), '');
});

console.log(`Patent admin verification passed (${count} checks, no network).`);
