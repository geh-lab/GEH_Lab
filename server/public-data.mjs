import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const PUBLIC_COLLECTIONS = Object.freeze(['members', 'projects', 'publications', 'patents', 'boardPosts']);
const collectionNames = new Set(PUBLIC_COLLECTIONS);
function assertCollection(name) { if (!collectionNames.has(name)) throw new PublicDataError(); }

export const PUBLIC_CACHE_TTL_MS = 10 * 60 * 1000;
export const PUBLIC_STALE_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_RETRY_MS = 60 * 1000;
export const PUBLIC_REQUEST_TIMEOUT_MS = 7500;

export class PublicDataError extends Error {
  constructor({ status = 0, transient = false } = {}) {
    super('Public information is temporarily unavailable.');
    this.name = 'PublicDataError';
    this.status = status;
    this.transient = transient;
  }
}

// Read only the public configuration literals; never execute configuration code.
export function parsePublicFirebaseConfig(source) {
  const object = String(source).match(/window\.GEH_FIREBASE_CONFIG\s*=\s*\{([^}]*)\}/)?.[1];
  if (!object) throw new PublicDataError();
  const value = key => object.match(new RegExp(`(?:^|,)\\s*["']?${key}["']?\\s*:\\s*(["'])([A-Za-z0-9_-]+)\\1\\s*(?=,|$)`))?.[2];
  const projectId = value('projectId');
  const apiKey = value('apiKey');
  if (!projectId || !apiKey || projectId.length > 100) throw new PublicDataError();
  return { projectId, apiKey };
}

export function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function normalizeReadError(error) {
  if (error instanceof PublicDataError) return error;
  const transient = error?.name === 'AbortError' || error?.name === 'TimeoutError'
    || error instanceof TypeError || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code);
  return new PublicDataError({ transient });
}

export async function fetchPublicCollection(config, collectionName, { fetchImpl = fetch, timeoutMs = PUBLIC_REQUEST_TIMEOUT_MS } = {}) {
  assertCollection(collectionName);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PublicDataError({ transient: true }));
    }, Math.min(PUBLIC_REQUEST_TIMEOUT_MS, Math.max(1, timeoutMs)));
  });
  const request = async () => {
    const items = [];
    const seenTokens = new Set();
    const seenDocuments = new Set();
    let pageToken = '';
    do {
      const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/${collectionName}`);
      url.searchParams.set('pageSize', '300');
      url.searchParams.set('key', config.apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new PublicDataError({ status: response.status, transient: [408, 429].includes(response.status) || response.status >= 500 });
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || (payload.documents !== undefined && !Array.isArray(payload.documents))) throw new PublicDataError();
      for (const document of payload.documents || []) {
        const documentId = String(document.name || '').split('/').pop();
        if (!documentId) throw new PublicDataError();
        if (seenDocuments.has(documentId)) continue;
        seenDocuments.add(documentId);
        const fields = decodeFirestoreFields(document.fields || {});
        if (fields.deleted !== true) items.push({ ...fields, id: documentId, documentId });
      }
      pageToken = payload.nextPageToken || '';
      if (pageToken && (typeof pageToken !== 'string' || seenTokens.has(pageToken) || seenTokens.size >= 100)) throw new PublicDataError();
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return { items, projectId: config.projectId };
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    throw normalizeReadError(error);
  } finally {
    clearTimeout(timer);
  }
}

export function createPublicCollectionLoader({ read = readFile, fetchImpl = fetch, cwd = () => process.cwd(), timeoutMs = PUBLIC_REQUEST_TIMEOUT_MS } = {}) {
  let config;
  return async (collectionName) => {
    assertCollection(collectionName);
    config ||= parsePublicFirebaseConfig(await read(resolve(cwd(), 'firebase-config.js'), 'utf8'));
    return fetchPublicCollection(config, collectionName, { fetchImpl, timeoutMs });
  };
}

function createCollectionCache({ load, now }) {
  let cached = null;
  let pending = null;
  let failedAt = null;
  let lastError = null;
  const staleOrThrow = error => {
    if (error.transient && cached && now() - cached.fetchedAt < PUBLIC_STALE_TTL_MS) return { ...cached, stale: true };
    throw error;
  };
  return {
    async read() {
      if (cached && now() - cached.fetchedAt < PUBLIC_CACHE_TTL_MS && !lastError) return { ...cached, stale: false };
      if (failedAt !== null && now() - failedAt < PUBLIC_RETRY_MS) return staleOrThrow(lastError);
      if (!pending) {
        pending = Promise.resolve().then(load).then(result => {
            if (!Array.isArray(result?.items) || !result?.projectId) throw new PublicDataError();
            cached = { items: result.items, projectId: result.projectId, fetchedAt: now() };
            failedAt = null;
            lastError = null;
            return { ...cached, stale: false };
          }).catch(error => {
            lastError = normalizeReadError(error);
            failedAt = now();
            // Never retain an old authorized response after permission is revoked.
            if ([401, 403].includes(lastError.status)) cached = null;
            return staleOrThrow(lastError);
          }).finally(() => {
            pending = null;
          });
      }
      return pending;
    }
  };
}

export function createPublicDataCache({ load = createPublicCollectionLoader(), now = Date.now } = {}) {
  const collections = new Map();
  return {
    async read(name) {
      assertCollection(name);
      if (!collections.has(name)) collections.set(name, createCollectionCache({ load: () => load(name), now }));
      return collections.get(name).read();
    }
  };
}
