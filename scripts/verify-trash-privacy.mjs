import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [firebaseSource, adminSource] = await Promise.all([
  readFile(new URL('../assets/js/firebase.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/js/admin.js', import.meta.url), 'utf8')
]);

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Production function boundaries exist: ${start}`);
  return source.slice(from, to).replace(/^export /gm, '');
}

// Execute the real write and trash functions. Firebase is never imported; these
// in-memory adapters model setDoc's merge/replace semantics without any network.
const production = [
  sourceBetween(firebaseSource, 'export async function saveDocument(', 'export async function uploadAsset('),
  sourceBetween(adminSource, 'function storagePathsForPayload(', 'let trashCleanupRunning'),
  sourceBetween(adminSource, 'async function moveItemToTrash(', 'const dialogState')
].join('\n');

const COLLECTIONS = { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts', trash: 'trash' };
const pairs = [['member', 'members'], ['project', 'projects'], ['publication', 'publications'], ['patent', 'patents'], ['board', 'boardPosts']];
const original = {
  id: 'privacy-fixture',
  name: 'Synthetic deleted profile',
  email: 'private@example.invalid',
  photoUrl: 'data:image/jpeg;base64,c3ludGhldGlj',
  photoPath: 'member-photos/synthetic.jpg',
  body: 'Synthetic confidential body',
  nested: { detail: 'Synthetic private detail' },
  createdAt: '2020-01-01T00:00:00.000Z'
};
const tombstoneKeys = ['id', 'deleted', 'deletedAt', 'purgeAfterAt', 'trashExpired', 'createdAt', 'updatedAt'].sort();

function harness(local) {
  const records = new Map();
  const writes = [];
  const invalidated = [];
  const deletedPaths = [];
  let failPath = '';
  const key = (collection, id) => `${collection}/${id}`;
  const get = (collection, id) => {
    const value = records.get(key(collection, id));
    return value ? structuredClone({ ...value, id }) : null;
  };
  const put = (collection, id, value) => {
    const clean = structuredClone(value);
    delete clean.id;
    records.set(key(collection, id), clean);
  };
  const beforeWrite = (path) => {
    if (path === failPath) { failPath = ''; throw new Error('Synthetic write failure'); }
  };
  const api = vm.runInNewContext(`${production}\n({ saveDocument, moveItemToTrash, restoreTrashItem, permanentlyDeleteTrashItem });`, {
    COLLECTIONS, isLocalDevMode: local, db: {}, console,
    localNow: () => '2026-09-16T12:00:00.000Z',
    makeLocalId: () => 'generated-fixture',
    readLocalCollection: collection => [...records.keys()].filter(path => path.startsWith(`${collection}/`))
      .map(path => get(collection, path.slice(collection.length + 1))),
    writeLocalCollection(collection, items) {
      for (const item of items) beforeWrite(key(collection, item.id));
      for (const path of records.keys()) if (path.startsWith(`${collection}/`)) records.delete(path);
      for (const item of items) put(collection, item.id, item);
      writes.push({ collection, items: structuredClone(items) });
    },
    notifyDocumentWrite: name => invalidated.push(name),
    doc: (_db, collection, id) => ({ collection, id }),
    collection: (_db, name) => ({ name }),
    serverTimestamp: () => '2026-09-16T12:00:00.000Z',
    async setDoc(ref, payload, { merge }) {
      beforeWrite(key(ref.collection, ref.id));
      put(ref.collection, ref.id, { ...(merge ? get(ref.collection, ref.id) || {} : {}), ...payload });
      writes.push({ ...ref, merge });
    },
    async deleteDoc(ref) { records.delete(key(ref.collection, ref.id)); },
    deleteStoragePath: async path => { deletedPaths.push(path); },
    showNotice() {}
  });
  return { ...api, get, put, writes, invalidated, deletedPaths, failNext: (collection, id) => { failPath = key(collection, id); } };
}

let checks = 0;
for (const local of [false, true]) {
  for (const [type, collection] of pairs) {
    const mode = local ? 'local' : 'Firestore adapter';
    const h = harness(local);
    h.put(collection, original.id, original);
    const trashId = `${type}__${original.id}`;
    const entry = await h.moveItemToTrash(type, collection, original, original.name);
    const publicDoc = h.get(collection, original.id);
    assert.deepEqual(Object.keys(publicDoc).sort(), tombstoneKeys, `${mode}/${type}: only deletion metadata stays public`);
    assert.equal(publicDoc.deleted, true);
    assert.equal(publicDoc.trashExpired, false);
    const trash = h.get('trash', trashId);
    for (const field of ['name', 'email', 'photoUrl', 'body', 'nested', 'createdAt']) {
      assert.deepEqual(trash.payload[field], original[field], `${mode}/${type}: private trash retains ${field}`);
    }
    assert.deepEqual(h.invalidated, ['trash', collection]);

    await h.restoreTrashItem(entry);
    const restored = h.get(collection, original.id);
    for (const [field, value] of Object.entries(original)) assert.deepEqual(restored[field], value, `${mode}/${type}: restores ${field}`);
    assert.equal(restored.deleted, false);
    assert.equal(h.get('trash', trashId), null);

    const toPurge = await h.moveItemToTrash(type, collection, restored, original.name);
    // Also cover an old deleted document that still contains its original fields.
    h.put(collection, original.id, { ...original, deleted: true });
    await h.permanentlyDeleteTrashItem(toPurge, { silent: true });
    const purged = h.get(collection, original.id);
    assert.deepEqual(Object.keys(purged).sort(), tombstoneKeys, `${mode}/${type}: purge strips legacy content`);
    assert.equal(purged.deleted, true);
    assert.equal(purged.trashExpired, true);
    assert.equal(h.get('trash', trashId), null);
    assert.deepEqual(h.deletedPaths, [original.photoPath]);

    h.put(collection, original.id, original);
    await h.saveDocument(collection, original.id, { body: 'Updated body' });
    assert.equal(h.get(collection, original.id).email, original.email, `${mode}/${type}: ordinary edits still merge`);
    assert.equal(h.get(collection, original.id).body, 'Updated body');
    checks++;
  }

  const h = harness(local);
  h.put('members', original.id, original);
  h.failNext('trash', `member__${original.id}`);
  await assert.rejects(h.moveItemToTrash('member', 'members', original, original.name), /Synthetic write failure/);
  assert.deepEqual(h.get('members', original.id), original, 'A failed private backup never removes the public original');
  const entry = await h.moveItemToTrash('member', 'members', original, original.name);
  h.failNext('members', original.id);
  await assert.rejects(h.restoreTrashItem(entry), /Synthetic write failure/);
  assert.ok(h.get('trash', entry.id), 'A failed restore keeps its recoverable private copy');
  checks++;
}

console.log(`Trash privacy: ${checks} offline checks passed (5 collections, remote/local writes, restore, legacy purge, failure recovery).`);
