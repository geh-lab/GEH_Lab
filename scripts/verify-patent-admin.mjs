import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolvePatentInventors, buildPatentInventorFields, patentsForMember } from '../assets/js/patent-inventors.js';
import { resolvePatentCountry, patentCountryOptions, patentCountryFields } from '../assets/js/patent-countries.js';
import { normalizePatent, validatePatent, sortPatents, patentText } from '../assets/js/patents.js';
import { adminSubscriptionKeys, createAdminSubscriptions } from '../assets/js/admin-data-subscriptions.js';
import { createAdminCounts } from '../assets/js/admin-counts.js';

// Execute the real editor, subscription callbacks and save handler. The small
// form/DOM below substitutes browser layout only; Firebase is never contacted.
const source = (await readFile(new URL('../assets/js/admin.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /id="patent-inventor-picker"/);
assert.match(html, /id="patent-inventor-order"/);
for (const name of ['externalFamilyNameKr', 'externalGivenNameKr', 'externalFamilyNameEn', 'externalGivenNameEn']) assert.match(html, new RegExp(`name="${name}"`));
assert.match(html, /id="patent-external-add"[^>]*type="button"|type="button"[^>]*id="patent-external-add"/);
assert.doesNotMatch(html, /name="externalInventors(?:Kr|En)"/);
assert.doesNotMatch(html, /name="inventorsKr"[^>]*required/);
assert.match(html, /<select id="patent-country">/);
assert.match(html, /name="countryEn"[^>]*readonly/);
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
  const controls = ['titleKr', 'titleEn', 'externalFamilyNameKr', 'externalGivenNameKr', 'externalFamilyNameEn', 'externalGivenNameEn', 'applicantKr', 'applicantEn', 'countryKr', 'countryEn', 'applicationNumber', 'applicationDate', 'status', 'registrationNumber', 'registrationDate', 'url', 'descriptionKr', 'descriptionEn']
    .map((name) => ({ name, value: '', disabled: false, focus() { this.focused = true; }, matches(selector) { return selector === '[data-patent-external-name]' && name.startsWith('external'); } }));
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
    ['#patent-form', form], ['#patent-country', { value: 'KR', innerHTML: '' }], ['#patent-inventor-picker', picker], ['#patent-inventor-preview', {}],
    ['#patent-inventor-order', { innerHTML: '', querySelector() { return null; } }],
    ['#patent-external-add', { textContent: '', focus() { this.focused = true; } }], ['#patent-external-cancel', { hidden: true }], ['#patent-external-status', { textContent: '' }],
    ['#patent-form-title', {}], ['#patent-registration-fields', {}], ['#patent-search-admin', {}]
  ]);
  const copy = (items = []) => [...items];
  const context = vm.createContext({
    console, structuredClone, URL, TextEncoder,
    resolvePatentInventors, buildPatentInventorFields, normalizePatent, validatePatent, sortPatents, patentText,
    resolvePatentCountry, patentCountryOptions, patentCountryFields,
    adminSubscriptionKeys, createAdminSubscriptions, createAdminCounts, escapeHTML,
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
    globalThis.test = { state, elements, adminSubscriptions, loadPatentForm, resetPatentForm, updatePatentCountryFields, collectPatentInventors, handlePatentSubmit, onPatentInventorInput, onPatentInventorSelection, onPatentInventorReorder, onPatentInventorOrderAction, onPatentExternalAdd, onPatentExternalKeydown, readPatentExternalInventor, resetPatentExternalEditor, renderPendingEditorPickers };
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
  const move = (index, direction) => test.onPatentInventorReorder({
    preventDefault() {},
    target: { closest: () => ({ dataset: { patentInventorIndex: String(index), patentInventorMove: direction } }) }
  });
  const action = (index, action) => test.onPatentInventorOrderAction({
    preventDefault() {},
    target: { closest: () => ({ dataset: { patentInventorIndex: String(index), patentInventorAction: action } }) }
  });
  const input = (fields) => { for (const [name, text] of Object.entries(fields)) type(name, text); };
  const add = (fields = {}) => { input(fields); test.onPatentExternalAdd({ preventDefault() {} }); };
  const key = (key, options = {}) => test.onPatentExternalKeydown({
    key, target: controls.namedItem('externalGivenNameKr'), preventDefault() {}, ...options
  });
  const submit = () => test.handlePatentSubmit({ preventDefault() {}, currentTarget: form });
  const arrive = (items = members) => callbacks.findLast((callback) => callback.name === 'members' && !callback.stopped).onData(items);
  return { ...test, callbacks, writes, notices, picker, order: selectors.get('#patent-inventor-order'), country: selectors.get('#patent-country'), value, type, select, move, action, input, add, key, submit, arrive, preview: selectors.get('#patent-inventor-preview'), cancel: selectors.get('#patent-external-cancel') };
}

let count = 0;
async function check(name, fn) { await fn(); count += 1; console.log(`✓ ${name}`); }

const composerNames = ['externalFamilyNameKr', 'externalGivenNameKr', 'externalFamilyNameEn', 'externalGivenNameEn'];
const outside = { externalFamilyNameKr: '홍', externalGivenNameKr: '길동', externalFamilyNameEn: 'Hong', externalGivenNameEn: 'Gildong' };
const revised = { externalFamilyNameKr: '김', externalGivenNameKr: '수정', externalFamilyNameEn: 'Kim', externalGivenNameEn: 'Sujeong' };
const orderKeys = (h) => plain(h.collectPatentInventors().inventorOrder).map((entry) => entry.memberId || entry.nameKr || entry.nameEn);

await check('Legacy credits become ordered people with checked members and an empty composer', () => {
  const h = harness(); h.loadPatentForm(base);
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['park']);
  assert.deepEqual(orderKeys(h), ['park', '외부 연구자']);
  for (const name of composerNames) assert.equal(h.value(name), '');
  assert.match(h.picker.innerHTML, /aria-label="박종석 발명자" checked/);
  assert.deepEqual(plain(h.adminSubscriptions.keys()), ['patents', 'members']);
});

await check('Member checks and direct additions share their actual click order and automatic separators', async () => {
  const h = harness(); h.loadPatentForm({ ...base, inventorsKr: '' });
  h.select('ham', true); h.add(outside); h.select('park', true);
  assert.deepEqual(orderKeys(h), ['ham', '홍길동', 'park']);
  assert.equal(h.collectPatentInventors().inventorsKr, '함승용, 홍길동, 박종석');
  assert.equal(h.collectPatentInventors().inventorsEn, 'Seung Yong Ham, Gildong Hong, Jong Seok Park');
  assert.equal(h.preview.textContent, '국문: 함승용, 홍길동, 박종석\n영문: Seung Yong Ham, Gildong Hong, Jong Seok Park');
  for (const name of composerNames) assert.equal(h.value(name), '', 'Adding resets each individual-name field');
  assert.ok(h.state.dirtyForms.has('patent-form'));
  await h.submit();
  const saved = h.writes[0].payload;
  assert.deepEqual(saved.inventorMemberIds, ['ham', 'park']);
  assert.deepEqual(saved.inventorOrder.map((entry) => entry.memberId || entry.nameKr), ['ham', '홍길동', 'park']);
  assert.deepEqual(plain(h.adminSubscriptions.keys()), ['patents']);
  h.loadPatentForm({ ...saved, id: 'p1' });
  assert.deepEqual(orderKeys(h), ['ham', '홍길동', 'park']);
  assert.equal(h.collectPatentInventors().inventorsEn, saved.inventorsEn);
  h.action(1, 'edit');
  for (const [name, value] of Object.entries(outside)) assert.equal(h.value(name), value, 'Saved split names can be edited without reparsing commas');
});

await check('Repeated member checks do not duplicate entries; rechecking appends to the end', () => {
  const h = harness(); h.loadPatentForm(base);
  h.select('ham', true); h.select('ham', true);
  assert.deepEqual(orderKeys(h), ['park', '외부 연구자', 'ham']);
  h.select('park', false); h.select('park', true);
  assert.deepEqual(orderKeys(h), ['외부 연구자', 'ham', 'park']);
  assert.match(h.picker.innerHTML, /aria-label="박종석 발명자" checked/);
});

await check('Late first member snapshot infers untouched legacy credits without replacing other form fields', () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  assert.equal(h.collectPatentInventors().inventorsKr, base.inventorsKr);
  h.value('titleKr', '다른 항목만 수정'); h.arrive();
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['park']);
  assert.deepEqual(orderKeys(h), ['park', '외부 연구자']);
  assert.equal(h.value('titleKr'), '다른 항목만 수정');
});

await check('Late member snapshots preserve pending typed names and manually assembled order', () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  h.input(outside); h.arrive();
  for (const [name, value] of Object.entries(outside)) assert.equal(h.value(name), value);
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
  h.add(); h.select('ham', true);
  const expected = orderKeys(h); h.arrive();
  assert.deepEqual(orderKeys(h), expected);
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['ham']);
});

await check('Explicit removal stays unlinked when an external person has the same name as a member', async () => {
  const h = harness(); h.loadPatentForm(base); h.select('park', false);
  h.add({ externalFamilyNameKr: '박', externalGivenNameKr: '종석' }); await h.submit();
  assert.deepEqual(h.writes[0].payload.inventorMemberIds, []);
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
  assert.equal(h.collectPatentInventors().inventorsKr, '외부 연구자, 박종석');
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

await check('Member read failure permits direct additions and preserves existing credits', async () => {
  const h = harness({ ready: false }); h.loadPatentForm(base);
  h.callbacks.find((callback) => callback.name === 'members').onError({ code: 'permission-denied' });
  h.add(outside); await h.submit();
  assert.equal(h.writes[0].payload.inventorsKr, `${base.inventorsKr}, 홍길동`);
  assert.deepEqual(h.writes[0].payload.inventorMemberIds, []);
});

await check('No inventors prevents saving, and reset clears the ordered list and composer', async () => {
  const h = harness(); h.loadPatentForm(base); h.action(1, 'remove'); h.select('park', false);
  await h.submit(); assert.equal(h.writes.length, 0); assert.ok(h.notices.some((notice) => /발명자/.test(notice)));
  h.input(outside); h.resetPatentForm();
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), []);
  assert.deepEqual(orderKeys(h), []);
  for (const name of composerNames) assert.equal(h.value(name), '');
});

await check('Country selection defaults to Korea and synchronizes the saved bilingual values', async () => {
  const h = harness(); h.resetPatentForm();
  assert.equal(h.country.value, 'KR');
  assert.equal(h.value('countryKr'), '대한민국');
  assert.equal(h.value('countryEn'), 'Republic of Korea');
  h.loadPatentForm(base);
  h.country.value = 'US'; h.updatePatentCountryFields();
  assert.equal(h.value('countryKr'), '미국');
  assert.equal(h.value('countryEn'), 'United States');
  await h.submit();
  assert.equal(h.writes[0].payload.countryKr, '미국');
  assert.equal(h.writes[0].payload.countryEn, 'United States');
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  assert.equal(h.country.value, 'US');
});

await check('Unknown existing jurisdictions survive an unrelated edit and can be replaced with a listed country', async () => {
  const h = harness();
  h.loadPatentForm({ ...base, countryKr: '기존 관할 <A>', countryEn: 'Custom jurisdiction A' });
  assert.equal(h.country.value, 'legacy');
  assert.match(h.country.innerHTML, /기존 관할 &lt;A&gt;/);
  h.value('titleKr', '제목만 변경');
  await h.submit();
  assert.equal(h.writes[0].payload.countryKr, '기존 관할 <A>');
  assert.equal(h.writes[0].payload.countryEn, 'Custom jurisdiction A');
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  h.country.value = 'JP'; h.updatePatentCountryFields();
  assert.equal(h.value('countryEn'), 'Japan');
  h.resetPatentForm();
  assert.equal(h.country.value, 'KR');
  assert.doesNotMatch(h.country.innerHTML, /기존 관할/);
});

const interleaved = {
  ...base,
  inventorsKr: '박종석, 외부 연구자, 함승용',
  inventorsEn: 'Jong Seok Park, Outside Researcher, Seung Yong Ham'
};

await check('An unrelated save preserves the official interleaving of lab and external inventors', async () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.value('titleKr', '제목만 수정한 특허');
  await h.submit();
  const saved = h.writes[0].payload;
  assert.equal(saved.inventorsKr, interleaved.inventorsKr);
  assert.equal(saved.inventorsEn, interleaved.inventorsEn);
  assert.deepEqual(saved.inventorOrder.map((entry) => entry.memberId || entry.nameKr), ['park', '외부 연구자', 'ham']);
  assert.equal(h.callbacks.filter((callback) => callback.name === 'members').length, 1, 'Ordering uses the existing member subscription');
});

await check('Mixed inventor moves save bilingual order and reopen without changing member linkage', async () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.move(2, 'up'); h.move(1, 'up'); h.move(2, 'up');
  const fields = h.collectPatentInventors();
  assert.equal(fields.inventorsKr, '함승용, 외부 연구자, 박종석');
  assert.equal(fields.inventorsEn, 'Seung Yong Ham, Outside Researcher, Jong Seok Park');
  assert.ok(h.state.dirtyForms.has('patent-form'), 'Moving an inventor marks the editor as changed');
  assert.equal(h.callbacks.filter((callback) => callback.name === 'members').length, 1, 'Moves do not reload the member collection');
  await h.submit();
  const saved = h.writes[0].payload;
  assert.deepEqual([...saved.inventorMemberIds].sort(), ['ham', 'park']);
  for (const member of members) assert.equal(patentsForMember([saved], member, members).length, 1);
  h.loadPatentForm({ ...saved, id: 'p1' });
  assert.equal(h.collectPatentInventors().inventorsKr, fields.inventorsKr);
  assert.equal(h.collectPatentInventors().inventorsEn, fields.inventorsEn);
  assert.deepEqual(plain(h.collectPatentInventors().inventorOrder), saved.inventorOrder);
});

await check('Boundary and invalid moves never drop or duplicate inventors', () => {
  const h = harness(); h.loadPatentForm(interleaved);
  const original = plain(h.collectPatentInventors());
  for (const [index, direction] of [[0, 'up'], [2, 'down'], [-1, 'up'], [999, 'down'], ['invalid', 'up'], [1, 'sideways']]) h.move(index, direction);
  assert.deepEqual(plain(h.collectPatentInventors()), original);
  assert.equal(h.state.dirtyForms.has('patent-form'), false);
  h.move(0, 'down');
  assert.equal(h.collectPatentInventors().inventorsKr, '외부 연구자, 박종석, 함승용');
  h.move(1, 'up');
  assert.deepEqual(plain(h.collectPatentInventors()), original);
});

await check('Removing a selected member retains the reordered external inventor and remaining links', async () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.move(1, 'up'); h.select('ham', false);
  assert.equal(h.collectPatentInventors().inventorsKr, '외부 연구자, 박종석');
  h.select('ham', true);
  assert.equal(h.collectPatentInventors().inventorsKr, '외부 연구자, 박종석, 함승용');
  h.select('park', false); await h.submit();
  const saved = h.writes[0].payload;
  assert.equal(saved.inventorsKr, '외부 연구자, 함승용');
  assert.deepEqual(saved.inventorMemberIds, ['ham']);
  assert.equal(patentsForMember([saved], members[0], members).length, 0);
  assert.equal(patentsForMember([saved], members[1], members).length, 1);
});

await check('External edits apply in place after moving the person and keep the English pairing', async () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.action(1, 'edit'); h.input(revised); h.move(1, 'up');
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, 0);
  h.add();
  assert.deepEqual(orderKeys(h), ['김수정', 'park', 'ham']);
  assert.equal(h.collectPatentInventors().inventorsEn, 'Sujeong Kim, Jong Seok Park, Seung Yong Ham');
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, -1);
  assert.equal(h.cancel.hidden, true);
  await h.submit();
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  assert.deepEqual(orderKeys(h), ['김수정', 'park', 'ham']);
});

await check('Removing a row before the edited person keeps Apply targeted at the same inventor', () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.action(1, 'edit'); h.input(revised); h.action(0, 'remove');
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, 0);
  h.add(); assert.deepEqual(orderKeys(h), ['김수정', 'ham']);
  assert.doesNotMatch(h.picker.innerHTML, /aria-label="박종석 발명자" checked/);
  assert.deepEqual(plain(h.state.patentInventorDraft.memberIds), ['ham']);
});

await check('Removing the person being edited cancels their pending edit without changing other people', () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.action(1, 'edit'); h.input(revised); h.action(1, 'remove');
  assert.deepEqual(orderKeys(h), ['park', 'ham']);
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, -1);
  for (const name of composerNames) assert.equal(h.value(name), '');
});

await check('Cancel discards only the pending external edit and returns to Add', () => {
  const h = harness(); h.loadPatentForm(interleaved);
  h.action(1, 'edit'); h.input(revised); h.resetPatentExternalEditor();
  assert.deepEqual(orderKeys(h), ['park', '외부 연구자', 'ham']);
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, -1);
  assert.equal(h.cancel.hidden, true);
  for (const name of composerNames) assert.equal(h.value(name), '');
});

await check('Pending Add or Apply is never silently lost by saving the patent', async () => {
  const h = harness(); h.loadPatentForm(base); h.input(outside);
  await h.submit(); assert.equal(h.writes.length, 0); assert.ok(h.notices.some((notice) => /추가|적용/.test(notice)));
  h.add(); h.action(2, 'edit'); h.input(revised);
  await h.submit(); assert.equal(h.writes.length, 0);
  h.add(); await h.submit(); assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].payload.inventorsKr, '박종석, 외부 연구자, 김수정');
});

await check('Clearing every field during an external edit still requires Apply or Cancel before saving', async () => {
  const h = harness(); h.loadPatentForm(interleaved); h.action(1, 'edit');
  h.input(Object.fromEntries(composerNames.map((name) => [name, ''])));
  await h.submit();
  assert.equal(h.writes.length, 0, 'An empty pending edit must not silently save the old inventor');
  assert.ok(h.notices.some((notice) => /추가|적용|취소/.test(notice)));
  assert.equal(h.state.patentInventorDraft.editingExternalIndex, 1);
  h.resetPatentExternalEditor(); await h.submit();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].payload.inventorsKr, interleaved.inventorsKr);
  assert.equal(h.writes[0].payload.inventorsEn, interleaved.inventorsEn);
});

await check('Enter adds one person, while Enter during IME composition does not add prematurely', () => {
  const h = harness(); h.loadPatentForm({ ...base, inventorsKr: '' }); h.input(outside);
  h.key('Enter', { isComposing: true }); assert.deepEqual(orderKeys(h), []);
  h.key('Enter'); assert.deepEqual(orderKeys(h), ['홍길동']);
  h.key('Enter'); assert.deepEqual(orderKeys(h), ['홍길동'], 'Empty Enter never duplicates the previous addition');
});

await check('External people with identical names remain separate entries through save and reopen', async () => {
  const h = harness(); h.loadPatentForm({ ...base, inventorsKr: '' });
  h.add(outside); h.select('park', true); h.add(outside);
  assert.deepEqual(orderKeys(h), ['홍길동', 'park', '홍길동']);
  await h.submit();
  h.loadPatentForm({ ...h.writes[0].payload, id: 'p1' });
  assert.deepEqual(orderKeys(h), ['홍길동', 'park', '홍길동']);
  h.action(0, 'remove'); assert.deepEqual(orderKeys(h), ['park', '홍길동']);
});

await check('Mononyms and English-only names can be added without typing separators', () => {
  const h = harness(); h.loadPatentForm({ ...base, inventorsKr: '' });
  h.add({ externalGivenNameKr: '하늘' });
  h.add({ externalFamilyNameEn: 'Doe', externalGivenNameEn: 'Jane' });
  assert.equal(h.collectPatentInventors().inventorsKr, '하늘, Jane Doe');
  assert.equal(h.collectPatentInventors().inventorsEn, '하늘, Jane Doe');
});

await check('Directly entered markup is escaped in the rendered ordered list', () => {
  const h = harness(); h.loadPatentForm({ ...base, inventorsKr: '' });
  h.add({ externalGivenNameKr: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(h.order.innerHTML, /<img/);
  assert.match(h.order.innerHTML, /&lt;img/);
});

console.log(`Patent admin verification passed (${count} checks, no network).`);
