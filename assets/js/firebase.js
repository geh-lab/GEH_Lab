import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
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
  publications: 'publications',
  projects: 'projects'
};

const firebaseConfig =
  window.GEH_FIREBASE_CONFIG && window.GEH_FIREBASE_CONFIG.apiKey
    ? window.GEH_FIREBASE_CONFIG
    : null;

export const hasFirebaseConfig = Boolean(firebaseConfig);

export const ADMIN_EMAILS = Array.isArray(window.GEH_ADMIN_EMAILS)
  ? window.GEH_ADMIN_EMAILS.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
  : [];

const app = hasFirebaseConfig ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
const googleProvider = app ? new GoogleAuthProvider() : null;

if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export function isAllowedAdmin(email = '') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return false;
  if (!ADMIN_EMAILS.length) return true;
  return ADMIN_EMAILS.includes(normalizedEmail);
}

async function validateAdminCredential(credential) {
  if (!credential?.user) {
    throw new Error('Google 로그인 결과를 확인하지 못했습니다.');
  }

  if (!isAllowedAdmin(credential.user.email)) {
    await signOut(auth);
    throw new Error('허용된 관리자 이메일이 아닙니다. firebase-config.js의 GEH_ADMIN_EMAILS를 확인하세요.');
  }

  return credential;
}

export async function signInAdminWithGoogle(options = {}) {
  if (!auth || !googleProvider) {
    throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  }

  await setPersistence(auth, browserLocalPersistence);

  const shouldUseRedirect =
    options.redirect === true ||
    (window.matchMedia && window.matchMedia('(max-width: 820px)').matches);

  if (shouldUseRedirect) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return await validateAdminCredential(credential);
  } catch (error) {
    if (
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
}

export async function resolveGoogleRedirectResult() {
  if (!auth) return null;
  const credential = await getRedirectResult(auth);
  if (!credential) return null;
  return validateAdminCredential(credential);
}

export async function signOutAdmin() {
  if (!auth) return;
  await signOut(auth);
}

export function watchAdminState(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, async (user) => {
    if (user && !isAllowedAdmin(user.email)) {
      await signOut(auth);
      callback(null);
      return;
    }

    callback(user);
  });
}

function snapshotToItems(snapshot) {
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data()
  }));
}

export async function fetchCollection(collectionName) {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshotToItems(snapshot);
}

export function listenCollection(collectionName, onData, onError) {
  if (!db) {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, collectionName),
    (snapshot) => onData(snapshotToItems(snapshot)),
    (error) => {
      console.error(`[Firebase] ${collectionName} listen failed`, error);
      if (typeof onError === 'function') onError(error);
    }
  );
}

export async function saveDocument(collectionName, documentId, payload) {
  if (!db) {
    throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  }

  const cleanPayload = { ...payload };
  delete cleanPayload.id;

  if (documentId) {
    const documentRef = doc(db, collectionName, documentId);
    await setDoc(
      documentRef,
      {
        ...cleanPayload,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    return documentId;
  }

  const documentRef = doc(collection(db, collectionName));
  await setDoc(documentRef, {
    ...cleanPayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return documentRef.id;
}

export async function deleteDocumentById(collectionName, documentId) {
  if (!db) {
    throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  }

  await deleteDoc(doc(db, collectionName, documentId));
}

export async function uploadMemberPhoto(file) {
  if (!storage) {
    throw new Error('Firebase Storage가 연결되지 않았습니다.');
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const fileName = `member-photos/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const fileRef = ref(storage, fileName);
  await uploadBytes(fileRef, file, {
    contentType: file.type || 'image/jpeg'
  });
  const photoUrl = await getDownloadURL(fileRef);

  return {
    photoUrl,
    photoPath: fileName
  };
}

export async function deleteMemberPhoto(photoPath) {
  if (!storage || !photoPath) return;
  const fileRef = ref(storage, photoPath);
  await deleteObject(fileRef);
}
