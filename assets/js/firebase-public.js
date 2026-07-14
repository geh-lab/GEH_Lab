export const COLLECTIONS = {
  members: 'members',
  projects: 'projects',
  publications: 'publications',
  board: 'boardPosts'
};

const firebaseConfig = window.GEH_FIREBASE_CONFIG?.apiKey ? window.GEH_FIREBASE_CONFIG : null;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const isLocalRuntime = LOCAL_HOSTS.has(window.location.hostname) || window.location.protocol === 'file:';
export const isLocalDevMode = window.GEH_LOCAL_DEV_MODE === true
  ? true
  : window.GEH_LOCAL_DEV_MODE === false
    ? false
    : (!firebaseConfig && isLocalRuntime);

export const hasFirebaseConfig = Boolean(firebaseConfig) || isLocalDevMode;

const LOCAL_PREFIX = 'geh-local-collection:';
const localSubscribers = new Map();
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

export async function fetchCollection(name) {
  if (isLocalDevMode) return readLocalCollection(name);
  const context = await ensureFirestore();
  if (!context?.db) return [];
  try {
    const snapshot = await context.getDocsFromServer(context.collection(context.db, name));
    return snapshotToItems(snapshot);
  } catch (error) {
    console.warn('getDocsFromServer failed, falling back to getDocs', error);
    const snapshot = await context.getDocs(context.collection(context.db, name));
    return snapshotToItems(snapshot);
  }
}

export function listenCollection(name, onData, onError) {
  if (isLocalDevMode) {
    onData(readLocalCollection(name));
    const subscribers = localSubscribers.get(name) || new Set();
    subscribers.add(onData);
    localSubscribers.set(name, subscribers);
    const storageHandler = (event) => {
      if (event.key === localCollectionKey(name)) onData(readLocalCollection(name));
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      subscribers.delete(onData);
      window.removeEventListener('storage', storageHandler);
    };
  }
  if (!firestoreContext?.db) {
    onData([]);
    return () => {};
  }
  return firestoreContext.onSnapshot(
    firestoreContext.collection(firestoreContext.db, name),
    (snapshot) => onData(snapshotToItems(snapshot)),
    (error) => {
      console.error(error);
      onError?.(error);
    }
  );
}
