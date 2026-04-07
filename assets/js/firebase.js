import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
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
  board: 'boardPosts'
};

const firebaseConfig = window.GEH_FIREBASE_CONFIG?.apiKey ? window.GEH_FIREBASE_CONFIG : null;
export const hasFirebaseConfig = Boolean(firebaseConfig);
export const ADMIN_EMAILS = Array.isArray(window.GEH_ADMIN_EMAILS)
  ? window.GEH_ADMIN_EMAILS.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
  : [];

const app = hasFirebaseConfig ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
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

export async function signInAdminWithGoogle() {
  if (!auth || !googleProvider) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  await authPersistenceReady;
  await signInWithRedirect(auth, googleProvider);
  return null;
}

export async function resolveRedirectResult() {
  if (!auth) return null;
  await authPersistenceReady;
  const credential = await getRedirectResult(auth);
  if (!credential) return null;
  return validateCredential(credential);
}

export function watchAdminState(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  let unsubscribe = () => {};
  authPersistenceReady.then(() => {
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
  if (!auth) return;
  await signOut(auth);
}

function snapshotToItems(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function fetchCollection(name) {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, name));
  return snapshotToItems(snapshot);
}

export function listenCollection(name, onData, onError) {
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
  if (!db) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  await deleteDoc(doc(db, collectionName, documentId));
}

export async function uploadAsset(file, folder = 'uploads') {
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
  const asset = await uploadAsset(file, 'board-media');
  return { imageUrl: asset.url, imagePath: asset.path };
}

export async function deleteStoragePath(path) {
  if (!storage || !path) return;
  await deleteObject(ref(storage, path));
}

export async function deleteMemberPhoto(photoPath) {
  await deleteStoragePath(photoPath);
}
