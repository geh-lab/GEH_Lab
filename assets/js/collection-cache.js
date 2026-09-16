const COLLECTIONS = new Set(['members', 'projects', 'publications', 'patents', 'boardPosts']);
const VERSION = 1;

function cacheError(code, message) {
  return Object.assign(new Error(message), { code });
}

function permitsStale(error) {
  const code = String(error?.code || '').toLowerCase().replaceAll('_', '-').split('/').at(-1);
  if (code) return [
    'resource-exhausted', 'unavailable', 'deadline-exceeded', 'aborted', 'internal', 'unknown',
    'network-request-failed', 'network-error', 'networkerror', 'timeout', '408', '429', '500', '502', '503', '504'
  ].includes(code);
  return ['NetworkError', 'TimeoutError'].includes(error?.name)
    || /\b(?:network|offline)\b|^(?:failed to fetch|fetch failed|load failed)$/i.test(String(error?.message || ''));
}

export function createCollectionCache({ storage, scope, now = Date.now, ttlMs = 600000, staleMs = 86400000, retryMs = 60000 } = {}) {
  if (typeof scope !== 'string' || !scope.trim()) throw new TypeError('A collection cache requires a project scope.');
  for (const [name, value] of Object.entries({ ttlMs, staleMs, retryMs })) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number.`);
  }
  const prefix = `geh-public-collections-v1:${encodeURIComponent(scope)}:`;
  const memory = new Map();
  const inFlight = new Map();
  const failures = new Map();
  const generations = new Map();
  // A failed tombstone write must not let this instance reread old disk data.
  const invalidated = new Set();
  const instanceToken = Math.random().toString(36).slice(2);

  function keyFor(name) {
    if (!COLLECTIONS.has(name)) throw cacheError('cache/unsupported-collection', `Unsupported public collection: ${name}`);
    return `${prefix}${name}`;
  }

  function generation(name) {
    return generations.get(name) || 0;
  }

  function clearLocal(name) {
    memory.delete(name);
    failures.delete(name);
    generations.set(name, generation(name) + 1);
  }

  function parseRecord(raw) {
    try {
      const record = JSON.parse(raw);
      if (record?.version !== VERSION || record.invalidated || !Array.isArray(record.items)
        || !Number.isFinite(record.fetchedAt) || record.fetchedAt < 0 || record.fetchedAt > now()) return null;
      return { items: record.items, fetchedAt: record.fetchedAt };
    } catch {
      return null;
    }
  }

  function persist(name, record) {
    try {
      storage?.setItem(keyFor(name), JSON.stringify({ version: VERSION, ...record }));
    } catch {
      // Private browsing, storage quotas and non-serializable values keep working in memory.
    }
  }

  function read(name, { allowStale = false } = {}) {
    const key = keyFor(name);
    if (invalidated.has(name)) return null;
    let record = memory.get(name);
    if (!record) {
      try { record = parseRecord(storage?.getItem(key)); } catch { /* Use memory when storage is unavailable. */ }
      if (record) memory.set(name, record);
    }
    if (!record) return null;
    const age = now() - record.fetchedAt;
    if (age < 0) return null;
    const stale = age >= ttlMs;
    if (stale && (!allowStale || age > staleMs)) return null;
    return { items: record.items, fetchedAt: record.fetchedAt, stale };
  }

  function seed(name, record) {
    const key = keyFor(name);
    const timestamp = now();
    if (!Array.isArray(record?.items) || !Number.isFinite(record.fetchedAt)
      || record.fetchedAt < 0 || record.fetchedAt > timestamp
      || timestamp - record.fetchedAt >= ttlMs || invalidated.has(name) || inFlight.has(name)) return false;

    let raw;
    let persisted;
    try {
      raw = storage?.getItem(key);
      persisted = JSON.parse(raw);
    } catch { /* Verified server data can still seed the in-memory cache. */ }
    const invalidTombstoneTime = !Number.isFinite(persisted?.invalidatedAt) || persisted.invalidatedAt < 0;
    if (persisted?.version === VERSION && persisted.invalidated
      && (invalidTombstoneTime || record.fetchedAt <= persisted.invalidatedAt)) {
      // An HTML response generated before an admin save cannot restore that old roster.
      const current = memory.get(name);
      if (!current || invalidTombstoneTime || current.fetchedAt <= persisted.invalidatedAt) {
        clearLocal(name);
        invalidated.add(name);
      }
      return false;
    }

    const stored = parseRecord(raw);
    const current = memory.get(name);
    if (stored && (!current || stored.fetchedAt > current.fetchedAt)) memory.set(name, stored);
    if (memory.get(name)?.fetchedAt >= record.fetchedAt) return false;

    // Preserve server age: visiting another page must not restart the freshness window.
    const seeded = { items: record.items, fetchedAt: record.fetchedAt };
    memory.set(name, seeded);
    failures.delete(name);
    persist(name, seeded);
    return true;
  }

  function fallback(name, failure) {
    const record = failure.allowStale ? read(name, { allowStale: true }) : null;
    if (!record) throw failure.error;
    return { ...record, stale: true, source: 'stale', error: failure.error };
  }

  function load(name, loader, { force = false } = {}) {
    keyFor(name);
    if (typeof loader !== 'function') return Promise.reject(new TypeError('A collection loader must be a function.'));
    if (inFlight.has(name)) return inFlight.get(name);
    const failure = failures.get(name);
    if (failure && now() < failure.retryAt) {
      try { return Promise.resolve(fallback(name, failure)); } catch (error) { return Promise.reject(error); }
    }
    // Failed refreshes must be rechecked after their cooldown, including permission errors.
    const cached = !force && !failure ? read(name) : null;
    if (cached) return Promise.resolve({ ...cached, source: 'cache' });

    const startedGeneration = generation(name);
    const assertCurrent = () => {
      if (generation(name) !== startedGeneration) throw cacheError('cache/invalidated', `${name} changed during its cache request.`);
    };
    const request = Promise.resolve().then(() => {
      assertCurrent();
      return loader();
    }).then((items) => {
      assertCurrent();
      if (!Array.isArray(items)) throw cacheError('cache/invalid-data', 'A collection loader must return an array.');
      const record = { items, fetchedAt: now() };
      memory.set(name, record);
      invalidated.delete(name);
      failures.delete(name);
      persist(name, record);
      return { ...record, stale: false, source: 'server' };
    }).catch((error) => {
      assertCurrent();
      const failed = { error, retryAt: now() + retryMs, allowStale: permitsStale(error) };
      failures.set(name, failed);
      return fallback(name, failed);
    });
    const pending = request.finally(() => {
      if (inFlight.get(name) === pending) inFlight.delete(name);
    });
    inFlight.set(name, pending);
    return pending;
  }

  function invalidate(name) {
    const key = keyFor(name);
    clearLocal(name);
    invalidated.add(name);
    // Distinct tombstones notify other tabs even for repeated invalidation at the same timestamp.
    persist(name, { invalidated: true, invalidatedAt: now(), token: `${instanceToken}:${generation(name)}` });
    return key;
  }

  function handleStorageEvent(event) {
    if (!event || (event.storageArea && storage && event.storageArea !== storage)) return false;
    if (event.key === null) {
      COLLECTIONS.forEach((name) => { clearLocal(name); invalidated.add(name); });
      return true;
    }
    if (typeof event.key !== 'string' || !event.key.startsWith(prefix)) return false;
    const name = event.key.slice(prefix.length);
    if (!COLLECTIONS.has(name)) return false;
    clearLocal(name);
    if ('newValue' in event && !parseRecord(event.newValue)) invalidated.add(name);
    else invalidated.delete(name);
    return true;
  }

  return { read, load, seed, invalidate, handleStorageEvent, keyFor };
}
