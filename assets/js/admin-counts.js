// Counts have their own lifetime: unopened tabs need totals, not document
// subscriptions. A full collection snapshot always supersedes an older count.
export function createAdminCounts({ keys = [], readCount, onChange } = {}) {
  const allowed = new Set(keys);
  const entries = new Map();
  let enabled = false;
  let generation = 0;

  function publish(key, entry) {
    entries.set(key, entry);
    onChange?.(key, entry);
  }

  function refresh(keysToRead = [], { force = false } = {}) {
    if (!enabled) return Promise.resolve([]);
    return Promise.all(keysToRead.filter((key) => allowed.has(key)).map((key) => {
      const previous = entries.get(key);
      if (!force && previous?.pending) return previous.pending;
      const currentGeneration = generation;
      const entry = { ...previous, status: 'loading', error: null };
      const current = () => enabled && generation === currentGeneration && entries.get(key) === entry;
      const pending = Promise.resolve().then(() => current() ? readCount(key) : undefined).then((count) => {
        if (!current()) return;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid collection count');
        publish(key, { status: 'ready', count });
      }).catch((error) => {
        if (current()) publish(key, { status: 'error', count: previous?.count, error });
      });
      entry.pending = pending;
      publish(key, entry);
      return pending;
    }));
  }

  return {
    get: (key) => entries.get(key),
    start() {
      generation += 1;
      entries.clear();
      enabled = true;
    },
    refresh,
    accept(key, count) {
      if (!enabled || !allowed.has(key) || !Number.isSafeInteger(count) || count < 0) return;
      // Replacing the entry invalidates any count request already in flight.
      publish(key, { status: 'ready', count });
    },
    clear() {
      enabled = false;
      generation += 1;
      entries.clear();
    }
  };
}
