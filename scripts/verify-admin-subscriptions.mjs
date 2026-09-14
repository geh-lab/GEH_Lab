import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { adminSubscriptionKeys, createAdminSubscriptions } from '../assets/js/admin-data-subscriptions.js';

const user = { uid: 'admin-test', email: 'admin@example.test' };
assert.deepEqual(adminSubscriptionKeys({ activeTab: 'members' }), []);
for (const activeTab of ['members', 'projects', 'publications', 'patents', 'board', 'trash']) {
  assert.deepEqual(adminSubscriptionKeys({ user, activeTab }), [activeTab]);
}
assert.deepEqual(adminSubscriptionKeys({ user, activeTab: 'members', openEditorKind: 'member', memberEditorTab: 'basic' }), ['members']);
assert.deepEqual(adminSubscriptionKeys({ user, activeTab: 'members', openEditorKind: 'member', memberEditorTab: 'research' }), ['members', 'projects', 'publications']);
assert.deepEqual(adminSubscriptionKeys({ user, activeTab: 'publications', openEditorKind: 'publication' }), ['publications', 'members']);
assert.deepEqual(adminSubscriptionKeys({ user, activeTab: 'projects', openEditorKind: 'project' }), ['projects', 'members']);
assert.deepEqual(adminSubscriptionKeys({ user, activeTab: 'patents', openEditorKind: 'patent' }), ['patents', 'members']);

const watches = [];
const received = [];
const failures = [];
const manager = createAdminSubscriptions({
  subscribe(key, onData, onError) {
    const record = { key, onData, onError, stopped: false };
    watches.push(record);
    if (key === 'members') onData(['synchronous local snapshot']);
    return () => { record.stopped = true; };
  },
  onData: (key, items) => received.push([key, items]),
  onError: (key, error) => failures.push([key, error])
});
manager.sync(['members']);
assert.equal(received.length, 1, 'Local callbacks can arrive synchronously');
manager.sync(['members']);
assert.equal(watches.length, 1, 'Repeated reconciliation must not subscribe twice');
manager.sync(['members', 'projects', 'publications']);
assert.equal(watches.length, 3);
manager.sync(['board']);
assert.ok(watches.slice(0, 3).every((item) => item.stopped));
const previousCount = received.length;
watches[0].onData(['stale member data']);
watches[1].onError(new Error('stale error'));
assert.equal(received.length, previousCount);
assert.equal(failures.length, 0);
manager.sync(['members']);
watches[0].onData(['older visit to the same tab']);
assert.equal(received.length, previousCount + 1, 'Only the current visit can deliver member data');
manager.clear();
const afterLogout = received.length;
watches.at(-1).onData(['late after logout']);
assert.equal(received.length, afterLogout);
assert.deepEqual(manager.keys(), []);

// Exercise the real admin wiring with a small DOM and fake collection callbacks.
// The script never imports Firebase or opens a network connection.
const source = await readFile(new URL('../assets/js/admin.js', import.meta.url), 'utf8');
const stripped = source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
function makeHarness(local = false) {
  const selectors = new Map();
  const lists = new Map();
  const callbacks = [];
  const writes = [];
  const fallback = [{ id: 'local-member', nameKr: '로컬 멤버' }];
  const passthrough = (items = []) => [...items];
  const context = vm.createContext({
    console, structuredClone, URL, TextEncoder,
    adminSubscriptionKeys, createAdminSubscriptions,
    hasFirebaseConfig: true, isLocalDevMode: local, isLocalAdminPreview: local,
    FALLBACK_MEMBERS: fallback, FALLBACK_PROJECTS: [], FALLBACK_PUBLICATIONS: [], FALLBACK_BOARD_POSTS: [],
    sortMembers: passthrough, sortProjects: passthrough, sortPublications: passthrough, sortBoardPosts: passthrough, sortPatents: passthrough,
    mergeMembers: (a, b) => [...a, ...b], mergeProjects: (a, b) => [...a, ...b], mergePublications: (a, b) => [...a, ...b], mergeBoardPosts: (a, b) => [...a, ...b],
    isActiveItem: (item) => !item.deleted,
    escapeHTML: (value) => String(value ?? ''),
    formatEnglishName: (value) => value || '',
    resolveProjectInvestigator: (project, members) => members.find((member) => member.id === project.principalInvestigatorId),
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts', trash: 'trash' },
    listenCollection(name, onData, onError) {
      const record = { name, onData, onError, stopped: false };
      callbacks.push(record);
      if (local) onData([]);
      return () => { record.stopped = true; };
    },
    saveDocument: async (collection, id, payload) => { writes.push({ collection, id, payload }); return id; },
    deleteDocumentById: async (collection, id) => { writes.push({ collection, id, deleted: true }); },
    document: {
      body: { dataset: {} },
      querySelector: (selector) => selectors.get(selector) || null,
      querySelectorAll: (selector) => lists.get(selector) || [],
      addEventListener() {}
    },
    window: { matchMedia: () => ({ matches: false }), clearTimeout() {}, setTimeout() {} }
  });
  vm.runInContext(`${stripped}\nglobalThis.adminTest = {state, elements, adminSubscriptions, attachListeners, teardownListeners, setActiveTab, syncAdminSubscriptions, renderSummary, renderPendingEditorPickers, collectMemberProjectLinks, collectMemberPublicationLinks, requireEditorMembers, handleAuthState, restoreTrashItem};`, context);
  return { ...context.adminTest, selectors, lists, callbacks, writes };
}

const admin = makeHarness();
admin.state.user = user;
admin.elements.summaryMembers = {};
admin.elements.summaryProjects = {};
admin.attachListeners();
assert.equal(admin.callbacks.length, 1, 'Login subscribes only the initial tab');
assert.equal(admin.callbacks[0].name, 'members');
assert.equal(admin.elements.summaryMembers.textContent, '—');
assert.equal(admin.elements.summaryProjects.textContent, '—', 'Unopened collection is not reported as zero');
admin.callbacks[0].onData([{ id: 'm1' }]);
assert.equal(admin.elements.summaryMembers.textContent, 1);
admin.setActiveTab('board');
assert.equal(admin.callbacks.length, 2);
assert.ok(admin.callbacks[0].stopped);
assert.equal(admin.elements.summaryMembers.title, '마지막으로 불러온 항목 수');
admin.callbacks[0].onData([{ id: 'stale' }]);
assert.equal(admin.state.members[0].id, 'm1');

admin.setActiveTab('members');
admin.state.openEditorKind = 'member';
admin.state.memberEditorTab = 'research';
admin.syncAdminSubscriptions();
assert.deepEqual([...admin.adminSubscriptions.keys()].sort(), ['members', 'projects', 'publications']);
admin.state.memberEditorTab = 'media';
admin.syncAdminSubscriptions();
assert.deepEqual([...admin.adminSubscriptions.keys()], ['members']);

const projectLinks = [{ projectId: 'saved-project', title: 'Existing project' }];
const publicationLinks = [{ publicationId: 'saved-paper', title: 'Existing paper', roles: ['first'] }];
admin.state.editingMember = { projectLinks, publicationLinks };
admin.elements.memberProjectPicker = { dataset: { ready: 'false' } };
admin.selectors.set('#member-publication-picker', { dataset: { ready: 'false' } });
assert.deepEqual(admin.collectMemberProjectLinks(), projectLinks, 'Basic edits retain unopened project links');
assert.deepEqual(admin.collectMemberPublicationLinks(), publicationLinks, 'Basic edits retain unopened publication links');

admin.elements.memberProjectPicker.dataset.ready = 'true';
admin.lists.set('#member-project-picker input[data-project-id]:checked', []);
admin.lists.set('#member-project-picker input[data-project-id]', []);
assert.deepEqual(JSON.parse(JSON.stringify(admin.collectMemberProjectLinks())), projectLinks, 'Completed or unavailable projects are retained');
admin.lists.set('#member-project-picker input[data-project-id]', [{ dataset: { projectId: 'saved-project' } }]);
assert.deepEqual([...admin.collectMemberProjectLinks()], [], 'Explicitly unchecked offered projects are removed');

admin.state.activeTab = 'publications';
admin.state.openEditorKind = 'publication';
admin.state.dirtyForms.add('publication-form');
admin.elements.publicationMemberPicker = { dataset: { ready: 'true' }, innerHTML: 'Unsaved author choices' };
admin.syncAdminSubscriptions();
const memberWatch = admin.callbacks.findLast((item) => item.name === 'members' && !item.stopped);
assert.equal(admin.requireEditorMembers(), false, 'Publication save waits for a fresh dependency snapshot');
memberWatch.onData([{ id: 'fresh-member' }]);
assert.equal(admin.requireEditorMembers(), true);
assert.equal(admin.elements.publicationMemberPicker.innerHTML, 'Unsaved author choices', 'A member snapshot must not reset author choices');
memberWatch.onError(Object.assign(new Error('Quota exceeded'), { code: 'resource-exhausted' }));
assert.equal(admin.requireEditorMembers(), false, 'Failed dependencies cannot silently erase links on save');
assert.equal(admin.state.members[0].id, 'fresh-member', 'Read errors retain last successful data');

admin.state.openEditorKind = '';
admin.state.user = null;
admin.syncAdminSubscriptions();
memberWatch.onData([{ id: 'after-logout' }]);
assert.equal(admin.state.members[0].id, 'fresh-member');
assert.deepEqual([...admin.adminSubscriptions.keys()], []);

const restore = { id: 'trash-m1', originalCollection: 'members', originalId: 'm1', payload: { id: 'm1', nameKr: '복원 대상' } };
await admin.restoreTrashItem(restore);
assert.equal(admin.writes[0].collection, 'members');
assert.equal(admin.writes[0].payload.deleted, false);
assert.equal(admin.writes[1].collection, 'trash');
assert.equal(admin.writes[1].deleted, true);
admin.state.user = user;
admin.setActiveTab('members');
assert.equal(admin.callbacks.at(-1).name, 'members', 'Returning to a collection refreshes restored data');

const localAdmin = makeHarness(true);
await localAdmin.handleAuthState(user);
assert.equal(localAdmin.state.members[0].id, 'local-member');
assert.equal(localAdmin.callbacks.length, 1, 'Local preview/login remains supported with one active listener');
await localAdmin.handleAuthState(user);
assert.equal(localAdmin.callbacks.length, 1, 'Repeated login notification does not duplicate subscriptions');
await localAdmin.handleAuthState(null);
assert.ok(localAdmin.callbacks.every((item) => item.stopped));

const authRace = makeHarness();
const pendingLogin = authRace.handleAuthState(user);
await authRace.handleAuthState(null);
await pendingLogin;
assert.equal(authRace.callbacks.length, 0, 'Logout during async login must not attach old listeners');
await authRace.handleAuthState(user);
const firstAccountWatch = authRace.callbacks[0];
firstAccountWatch.onData([{ id: 'first-account-data' }]);
const nextAccountLogin = authRace.handleAuthState({ uid: 'other-admin' });
assert.ok(firstAccountWatch.stopped, 'An account switch removes old listeners before awaiting setup');
firstAccountWatch.onData([{ id: 'stale-first-account' }]);
assert.equal(authRace.state.members[0].id, 'first-account-data');
await nextAccountLogin;
authRace.callbacks.at(-1).onData([{ id: 'second-account-data' }]);
assert.equal(authRace.state.members[0].id, 'second-account-data');

console.log('Admin subscription checks passed: active tabs, lazy editor dependencies, local login/preview, unsubscribe races, retained data, unloaded counts, preserved links/dirty choices and restoration refresh.');
