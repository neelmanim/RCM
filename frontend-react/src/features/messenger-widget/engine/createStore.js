/** Tiny external-store factory — the subscribe/getSnapshot/notify boilerplate
 * dialerEngine.js and widgetUiStore.js both need for useSyncExternalStore,
 * shared instead of hand-rolled twice. */
export function createStore(initialSnapshot) {
  const listeners = new Set();
  let snapshot = initialSnapshot;
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot() {
      return snapshot;
    },
    notify(next) {
      snapshot = next;
      listeners.forEach((fn) => fn());
    },
  };
}
