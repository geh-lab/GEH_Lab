const COLLECTION_KEYS = new Set(['members', 'projects', 'publications', 'patents', 'board', 'trash']);

export function adminSubscriptionKeys({ user, activeTab, openEditorKind, memberEditorTab } = {}) {
  if (!user) return [];
  const keys = new Set(COLLECTION_KEYS.has(activeTab) ? [activeTab] : ['members']);
  if (openEditorKind === 'member' && memberEditorTab === 'research') {
    keys.add('projects');
    keys.add('publications');
  }
  if (['project', 'publication', 'patent'].includes(openEditorKind)) keys.add('members');
  return [...keys];
}

// A listener can deliver an already queued callback after unsubscribe. The entry
// identity also rejects callbacks from a previous visit to the same tab/account.
export function createAdminSubscriptions({ subscribe, onStart, onData, onError, onStop } = {}) {
  const active = new Map();
  function stop(key) {
    const entry = active.get(key);
    if (!entry) return;
    active.delete(key);
    try { entry.unsubscribe?.(); } catch { /* The callback guard is already disabled. */ }
    onStop?.(key);
  }
  return {
    keys: () => [...active.keys()],
    sync(keys = []) {
      const wanted = new Set(keys.filter((key) => COLLECTION_KEYS.has(key)));
      for (const key of active.keys()) if (!wanted.has(key)) stop(key);
      for (const key of wanted) {
        if (active.has(key)) continue;
        const entry = {};
        active.set(key, entry);
        onStart?.(key);
        const current = () => active.get(key) === entry;
        try {
          const unsubscribe = subscribe(key,
            (items) => { if (current()) onData?.(key, items); },
            (error) => { if (current()) onError?.(key, error); });
          if (current()) entry.unsubscribe = unsubscribe;
          else unsubscribe?.();
        } catch (error) {
          if (current()) onError?.(key, error);
        }
      }
    },
    clear() {
      for (const key of [...active.keys()]) stop(key);
    }
  };
}
