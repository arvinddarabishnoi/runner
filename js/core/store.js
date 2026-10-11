/** Minimal observable store — used for HUD + screen state. */
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k in patch) {
        if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
      }
      if (changed) subs.forEach((fn) => fn(state));
      return changed;
    },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
}

/** Tiny event bus. */
export function createBus() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const set = map.get(evt);
      if (set) for (const fn of [...set]) fn(payload);
    },
  };
}
