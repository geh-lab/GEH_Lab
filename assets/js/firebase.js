import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  browserLocalPersistence,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js';

export const COLLECTIONS = {
  members: 'members',
  projects: 'projects',
  publications: 'publications',
  board: 'boardPosts',
  trash: 'trash'
};

const firebaseConfig = window.GEH_FIREBASE_CONFIG?.apiKey ? window.GEH_FIREBASE_CONFIG : null;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const isLocalDevMode = window.GEH_LOCAL_DEV_MODE === false
  ? false
  : (window.GEH_LOCAL_DEV_MODE === true || LOCAL_HOSTS.has(window.location.hostname) || window.location.protocol === 'file:');
export const hasFirebaseConfig = Boolean(firebaseConfig) || isLocalDevMode;
export const ADMIN_EMAILS = Array.isArray(window.GEH_ADMIN_EMAILS)
  ? window.GEH_ADMIN_EMAILS.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
  : [];

const app = firebaseConfig ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
const googleProvider = auth ? new GoogleAuthProvider() : null;

const authPersistenceReady = auth
  ? setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.warn(error);
    })
  : Promise.resolve();

if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export function isAllowedAdmin(email = '') {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (!ADMIN_EMAILS.length) return true;
  return ADMIN_EMAILS.includes(normalized);
}

async function validateCredential(credential) {
  if (!credential?.user) throw new Error('Google 로그인 결과를 확인하지 못했습니다.');
  if (!isAllowedAdmin(credential.user.email)) {
    await signOut(auth);
    throw new Error('허용된 관리자 계정이 아닙니다.');
  }
  return credential;
}

const LOCAL_AUTH_KEY = 'geh-local-admin-auth';
const LOCAL_PREFIX = 'geh-local-collection:';
const LOCAL_AUTH_EVENT = 'geh-local-auth-change';
const LOCAL_COLLECTION_EVENT = 'geh-local-collection-change';
const localSubscribers = new Map();

function localStorageSafe() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getLocalAdminUser() {
  const store = localStorageSafe();
  const raw = store?.getItem(LOCAL_AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      uid: parsed.uid || 'local-admin',
      email: parsed.email || ADMIN_EMAILS[0] || 'local-admin@localhost',
      displayName: parsed.displayName || 'Local Admin'
    };
  } catch {
    return null;
  }
}

function setLocalAdminUser(user) {
  const store = localStorageSafe();
  if (!store) return;
  if (!user) store.removeItem(LOCAL_AUTH_KEY);
  else store.setItem(LOCAL_AUTH_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent(LOCAL_AUTH_EVENT, { detail: user || null }));
}

function localCollectionKey(name) {
  return `${LOCAL_PREFIX}${name}`;
}

function readLocalCollection(name) {
  const store = localStorageSafe();
  const raw = store?.getItem(localCollectionKey(name));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function notifyLocalCollection(name) {
  const items = readLocalCollection(name);
  const subs = localSubscribers.get(name) || new Set();
  subs.forEach((callback) => {
    try { callback(items); } catch (error) { console.error(error); }
  });
  window.dispatchEvent(new CustomEvent(LOCAL_COLLECTION_EVENT, { detail: { name, items } }));
}

function writeLocalCollection(name, items) {
  const store = localStorageSafe();
  store?.setItem(localCollectionKey(name), JSON.stringify(items));
  notifyLocalCollection(name);
}

function localNow() {
  return new Date().toISOString();
}

function makeLocalId(collectionName = 'doc') {
  const suffix = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  return `${collectionName}-${suffix}`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const padding = (base64.match(/=+$/)?.[0]?.length) || 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    image.src = src;
  });
}

async function compressImageForFirestore(file, options = {}) {
  const maxWidth = options.maxWidth || 1400;
  const maxHeight = options.maxHeight || 1400;
  const maxBytes = options.maxBytes || 650 * 1024;
  const dataUrl = await readFileAsDataURL(file);
  const image = await loadImageElement(dataUrl);
  let width = image.naturalWidth || image.width || 0;
  let height = image.naturalHeight || image.height || 0;
  if (!width || !height) return dataUrl;
  let scale = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const render = () => {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
  };
  render();
  let quality = 0.86;
  let output = canvas.toDataURL('image/jpeg', quality);
  while (estimateDataUrlBytes(output) > maxBytes && quality > 0.5) {
    quality -= 0.08;
    output = canvas.toDataURL('image/jpeg', quality);
  }
  while (estimateDataUrlBytes(output) > maxBytes && (width > 720 || height > 720)) {
    width = Math.max(720, Math.round(width * 0.86));
    height = Math.max(720, Math.round(height * 0.86));
    render();
    output = canvas.toDataURL('image/jpeg', Math.max(quality, 0.72));
  }
  if (estimateDataUrlBytes(output) > maxBytes) {
    throw new Error('maximum document size exceeded');
  }
  return output;
}

export async function signInAdminWithGoogle() {
  if (isLocalDevMode) {
    const localUser = {
      uid: 'local-admin',
      email: ADMIN_EMAILS[0] || 'local-admin@localhost',
      displayName: 'Local Admin'
    };
    setLocalAdminUser(localUser);
    return { user: localUser };
  }
  if (!auth || !googleProvider) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  await authPersistenceReady;
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return await validateCredential(credential);
  } catch (error) {
    const popupFallbackCodes = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment'
    ];
    if (popupFallbackCodes.includes(error?.code)) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
}

export async function resolveRedirectResult() {
  if (isLocalDevMode) {
    const localUser = getLocalAdminUser();
    return localUser ? { user: localUser } : null;
  }
  if (!auth) return null;
  await authPersistenceReady;
  let credential = null;
  try {
    credential = await getRedirectResult(auth);
  } catch (error) {
    if (auth.currentUser && isAllowedAdmin(auth.currentUser.email)) {
      return { user: auth.currentUser };
    }
    throw error;
  }
  if (!credential) {
    if (auth.currentUser && isAllowedAdmin(auth.currentUser.email)) {
      return { user: auth.currentUser };
    }
    return null;
  }
  return validateCredential(credential);
}

export function watchAdminState(callback) {
  if (isLocalDevMode) {
    callback(getLocalAdminUser());
    const handler = (event) => callback(event?.detail || getLocalAdminUser());
    window.addEventListener(LOCAL_AUTH_EVENT, handler);
    return () => window.removeEventListener(LOCAL_AUTH_EVENT, handler);
  }
  if (!auth) {
    callback(null);
    return () => {};
  }
  let unsubscribe = () => {};
  authPersistenceReady.finally(() => {
    unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && !isAllowedAdmin(user.email)) {
        await signOut(auth);
        callback(null);
        return;
      }
      callback(user);
    });
  });
  return () => unsubscribe();
}

export async function signOutAdmin() {
  if (isLocalDevMode) {
    setLocalAdminUser(null);
    return;
  }
  if (!auth) return;
  await signOut(auth);
}

function snapshotToItems(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function fetchCollection(name) {
  if (isLocalDevMode) return readLocalCollection(name);
  if (!db) return [];
  try {
    const snapshot = await getDocsFromServer(collection(db, name));
    return snapshotToItems(snapshot);
  } catch (error) {
    console.warn('getDocsFromServer failed, falling back to getDocs', error);
    const snapshot = await getDocs(collection(db, name));
    return snapshotToItems(snapshot);
  }
}

export function listenCollection(name, onData, onError) {
  if (isLocalDevMode) {
    onData(readLocalCollection(name));
    const subs = localSubscribers.get(name) || new Set();
    subs.add(onData);
    localSubscribers.set(name, subs);
    const storageHandler = (event) => {
      if (event.key === localCollectionKey(name)) onData(readLocalCollection(name));
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      subs.delete(onData);
      window.removeEventListener('storage', storageHandler);
    };
  }
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, name),
    (snapshot) => onData(snapshotToItems(snapshot)),
    (error) => {
      console.error(error);
      onError?.(error);
    }
  );
}

export async function saveDocument(collectionName, documentId, payload) {
  if (isLocalDevMode) {
    const clean = { ...payload };
    delete clean.id;
    const items = readLocalCollection(collectionName);
    const targetId = documentId || makeLocalId(collectionName);
    const index = items.findIndex((item) => item.id === targetId);
    const next = {
      ...(index >= 0 ? items[index] : {}),
      ...clean,
      id: targetId,
      createdAt: (index >= 0 ? items[index]?.createdAt : localNow()),
      updatedAt: localNow()
    };
    if (index >= 0) items[index] = next;
    else items.push(next);
    writeLocalCollection(collectionName, items);
    return targetId;
  }
  if (!db) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  const clean = { ...payload };
  delete clean.id;
  const targetRef = documentId ? doc(db, collectionName, documentId) : doc(collection(db, collectionName));
  await setDoc(
    targetRef,
    {
      ...clean,
      createdAt: clean.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return targetRef.id;
}

export async function deleteDocumentById(collectionName, documentId) {
  if (isLocalDevMode) {
    const items = readLocalCollection(collectionName).filter((item) => item.id !== documentId);
    writeLocalCollection(collectionName, items);
    return;
  }
  if (!db) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  await deleteDoc(doc(db, collectionName, documentId));
}

export async function uploadAsset(file, folder = 'uploads') {
  if (isLocalDevMode) {
    const url = await readFileAsDataURL(file);
    return { url, path: `local://${folder}/${file.name || makeLocalId(folder)}` };
  }
  if (!storage) throw new Error('Firebase Storage가 연결되지 않았습니다.');
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const path = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type || 'image/jpeg' });
  const url = await getDownloadURL(fileRef);
  return { url, path };
}

export async function uploadMemberPhoto(file) {
  const asset = await uploadAsset(file, 'member-photos');
  return { photoUrl: asset.url, photoPath: asset.path };
}

export async function uploadProjectFigure(file) {
  const asset = await uploadAsset(file, 'project-media');
  return { figureUrl: asset.url, figurePath: asset.path };
}

export async function uploadBoardImage(file) {
  const imageUrl = await compressImageForFirestore(file);
  return { imageUrl, imagePath: '' };
}

export async function deleteStoragePath(path) {
  if (isLocalDevMode) return;
  if (!storage || !path) return;
  await deleteObject(ref(storage, path));
}

export async function deleteMemberPhoto(photoPath) {
  await deleteStoragePath(photoPath);
}
