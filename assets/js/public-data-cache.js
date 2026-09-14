import { createCollectionCache } from './collection-cache.js';

export const PUBLIC_DATA_CHANGED = 'geh:public-data-changed';
export const PUBLIC_COLLECTION_NAMES = ['members', 'projects', 'publications', 'patents', 'boardPosts'];
const revisions = new Map();
export const getPublicCollectionRevision = (name) => revisions.get(name) || 0;
let storage;
try { storage = window.localStorage; } catch { /* Memory caching still works. */ }

export const publicCollectionCache = createCollectionCache({
  storage,
  scope: window.GEH_FIREBASE_CONFIG?.projectId || 'local-preview'
});

function notify(collections) {
  collections.forEach((name) => revisions.set(name, getPublicCollectionRevision(name) + 1));
  window.dispatchEvent(new CustomEvent(PUBLIC_DATA_CHANGED, { detail: { collections } }));
}

export function invalidatePublicCollection(name) {
  if (!PUBLIC_COLLECTION_NAMES.includes(name)) return;
  publicCollectionCache.invalidate(name);
  notify([name]);
}

window.addEventListener('storage', (event) => {
  if (!publicCollectionCache.handleStorageEvent(event)) return;
  const names = event.key === null
    ? PUBLIC_COLLECTION_NAMES
    : PUBLIC_COLLECTION_NAMES.filter((name) => publicCollectionCache.keyFor(name) === event.key);
  notify(names);
});
