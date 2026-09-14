import { publicCollectionCache } from './public-data-cache.js';

export const COLLECTIONS = {
  members: 'members',
  projects: 'projects',
  publications: 'publications',
  patents: 'patents',
  board: 'boardPosts'
};

const firebaseConfig = window.GEH_FIREBASE_CONFIG?.apiKey ? window.GEH_FIREBASE_CONFIG : null;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocalRuntime = LOCAL_HOSTS.has(window.location.hostname) || window.location.protocol === 'file:';
export const isLocalDevMode = window.GEH_LOCAL_DEV_MODE === true
  ? true
  : window.GEH_LOCAL_DEV_MODE === false
    ? false
    : isLocalRuntime;

export const hasFirebaseConfig = Boolean(firebaseConfig) || isLocalDevMode;

const LOCAL_PREFIX = 'geh-local-collection:';
let firestoreContext = null;
let firestoreReady = null;

function localStorageSafe() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function localCollectionKey(name) {
  return `${LOCAL_PREFIX}${name}`;
}

function readLocalCollection(name) {
  const raw = localStorageSafe()?.getItem(localCollectionKey(name));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureFirestore() {
  if (isLocalDevMode || !firebaseConfig) return null;
  if (firestoreContext) return firestoreContext;
  if (!firestoreReady) {
    firestoreReady = Promise.all([
      import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js'),
      import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js')
    ]).then(([appModule, firestoreModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      firestoreContext = {
        db: firestoreModule.getFirestore(app),
        ...firestoreModule
      };
      return firestoreContext;
    });
  }
  return firestoreReady;
}

function snapshotToItems(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export function readCachedCollection(name, options) {
  return isLocalDevMode ? null : publicCollectionCache.read(name, options);
}

export async function fetchCollectionResult(name, options) {
  if (isLocalDevMode) {
    return { items: readLocalCollection(name), fetchedAt: Date.now(), stale: false, source: 'local' };
  }
  if (!firebaseConfig) return { items: [], fetchedAt: Date.now(), stale: false, source: 'local' };
  const loader = async () => {
    const context = await ensureFirestore();
    let timer;
    try {
      const snapshot = await Promise.race([
        context.getDocsFromServer(context.collection(context.db, name)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Data request timed out.'), { code: 'deadline-exceeded' })), 15000); })
      ]);
      return snapshotToItems(snapshot);
    } finally { clearTimeout(timer); }
  };
  try {
    return await publicCollectionCache.load(name, loader, options);
  } catch (error) {
    // An administrator saved while this request was running. Do not restore old data.
    if (error?.code === 'cache/invalidated' && !document.hidden) return publicCollectionCache.load(name, loader, options);
    throw error;
  }
}

export async function fetchCollection(name, options) {
  return (await fetchCollectionResult(name, options)).items;
}
