/**
 * WeakCache — a cache that stores values via WeakRef, automatically cleaned up
 * by the garbage collector.
 *
 * Uses a `Map<K, WeakRef<V>>` for key-to-value lookups and a
 * `FinalizationRegistry<K>` that removes stale entries from the map when values
 * are reclaimed by the GC. Inspired by Pino's use of WeakRef +
 * FinalizationRegistry for memory-efficient instance tracking.
 *
 * Trade-offs:
 *   - `size()` returns the number of entries in the internal map, which may
 *     include stale refs not yet cleaned up by the GC — the
 *     FinalizationRegistry callback is non-deterministic and may fire in a
 *     later microtask or not at all before process exit.
 *   - `get()` and `has()` eagerly clean up stale entries they encounter,
 *     keeping the map as accurate as possible on the read path.
 *   - `remove()` calls `registry.unregister(value)` when possible to prevent
 *     the finalization callback from firing for explicitly removed entries.
 *     Because `unregister` requires the original object (used as the
 *     unregister token), a stale WeakRef (already collected) cannot be
 *     unregistered — the entry is simply deleted from the map.
 *
 * All private state uses module-scope unique symbols so every WeakCache
 * instance shares the same hidden class — keeping call sites monomorphic
 * across all instances.
 *
 * When to use: caching large objects (parsed ASTs, compiled schemas, decoded
 * images) where you want the GC to reclaim entries automatically when they
 * are no longer referenced elsewhere. Do not rely on WeakCache for guaranteed
 * cache hits — entries can disappear at any GC cycle once all external
 * references are dropped. For deterministic capacity-bounded caching, use
 * `LRUCache`. Values must be objects; primitives are rejected by `WeakRef`.
 */

const kEntries: unique symbol = Symbol("entries");
const kRegistry: unique symbol = Symbol("registry");
const kSize: unique symbol = Symbol("size");

export interface WeakCache<K, V extends object> {
  [kEntries]: Map<K, WeakRef<V>>;
  [kRegistry]: FinalizationRegistry<K>;
  [kSize]: number;
}

/**
 * Creates a new empty WeakCache.
 *
 * Values must be objects (`V extends object`) because `WeakRef` only supports
 * GC-observable targets — primitives are not eligible.
 */
export function make<K, V extends object>(): WeakCache<K, V> {
  const entries: Map<K, WeakRef<V>> = new Map();

  // The FinalizationRegistry callback fires (non-deterministically) when a
  // cached value is reclaimed by the GC.  It receives the key that was
  // registered alongside the value and removes the stale map entry.
  // The callback delegates to `cleanupStaleEntry` — a module-level function
  // rather than an inline closure — so the cleanup logic is testable without
  // requiring --expose-gc and is inlinable by the JIT.
  // FinalizationRegistry callback is invoked non-deterministically by the GC
  // — cannot be reliably triggered in unit tests without --expose-gc and
  // non-portable GC heuristics.  The logic it delegates to (cleanupStaleEntry)
  // is tested separately.
  // GC-triggered callback; tested via cleanupStaleEntry
  /* node:coverage ignore next 3 */
  const registry = new FinalizationRegistry<K>((key: K) => {
    cleanupStaleEntry(entries, key);
  });

  const cache: WeakCache<K, V> = {
    [kEntries]: entries,
    [kRegistry]: registry,
    [kSize]: 0,
  };
  // Write kSize a second time so V8 marks the field as mutable from the first
  // make() call — avoids a deoptimization cascade on the first mutation.
  cache[kSize] = 0;

  return cache;
}

/**
 * Returns the value associated with `key`, or `undefined` if not present or if
 * the value has been reclaimed by the GC.
 *
 * When a stale WeakRef is encountered (deref returns undefined), the entry is
 * eagerly removed from the map to keep `size()` as accurate as possible.
 */
export function get<K, V extends object>(cache: WeakCache<K, V>, key: K): V | undefined {
  const ref = cache[kEntries].get(key);
  if (ref === undefined) return void 0;

  const value = ref.deref();
  if (value === undefined) {
    // The value was reclaimed by the GC but the FinalizationRegistry callback
    // has not yet fired.  Eagerly clean up the stale entry.
    cache[kEntries].delete(key);
    cache[kSize]--;
    return void 0;
  }
  return value;
}

/**
 * Stores `value` under `key`, replacing any previous entry for that key.
 *
 * The value is wrapped in a `WeakRef` and registered with the
 * `FinalizationRegistry` so the entry is automatically removed when the value
 * is garbage-collected.
 */
export function set<K, V extends object>(cache: WeakCache<K, V>, key: K, value: V): void {
  const existing = cache[kEntries].get(key);
  if (existing !== undefined) {
    // Attempt to unregister the old value from the FinalizationRegistry so its
    // cleanup callback does not fire after we overwrite the entry.  unregister
    // requires the original object as the token — if the old ref is already
    // stale (collected), the call is a harmless no-op.
    const old = existing.deref();
    if (old !== undefined) {
      cache[kRegistry].unregister(old);
    }
  } else {
    cache[kSize]++;
  }

  const ref = new WeakRef(value);
  cache[kEntries].set(key, ref);
  // Register the value with the FinalizationRegistry.  The value itself is
  // used as the unregister token so `remove()` can cancel the callback.
  cache[kRegistry].register(value, key, value);
}

/**
 * Returns `true` if `key` is present and its value has not been reclaimed.
 *
 * Like `get()`, eagerly removes stale entries when encountered.
 */
export function has<K, V extends object>(cache: WeakCache<K, V>, key: K): boolean {
  const ref = cache[kEntries].get(key);
  if (ref === undefined) return false;

  if (ref.deref() === undefined) {
    // Stale ref — eagerly clean up.
    cache[kEntries].delete(key);
    cache[kSize]--;
    return false;
  }
  return true;
}

/**
 * Removes the entry for `key` from the cache.
 *
 * Returns `true` if the key was present, `false` otherwise. If the value has
 * not yet been collected, it is unregistered from the FinalizationRegistry to
 * prevent a spurious cleanup callback.
 */
export function remove<K, V extends object>(cache: WeakCache<K, V>, key: K): boolean {
  const ref = cache[kEntries].get(key);
  if (ref === undefined) return false;

  const value = ref.deref();
  if (value !== undefined) {
    // Unregister so the FinalizationRegistry callback does not fire for this
    // explicitly removed entry.
    cache[kRegistry].unregister(value);
  }

  cache[kEntries].delete(key);
  cache[kSize]--;
  return true;
}

/**
 * Returns the number of entries in the cache.
 *
 * Note: this count may include entries whose values have been reclaimed by the
 * GC but whose FinalizationRegistry callback has not yet fired.  The count is
 * decremented eagerly by `get()`, `has()`, and `remove()` when they encounter
 * stale refs, but between those calls the count can be stale.
 */
export function size<K, V extends object>(cache: WeakCache<K, V>): number {
  return cache[kSize];
}

// --- Internal helpers ---

/**
 * Removes a stale entry from the map if the key still points to a dead
 * WeakRef.  Called by the FinalizationRegistry callback when a cached value
 * is reclaimed by the GC.
 *
 * Guard: only deletes if the entry still points to a dead ref.  Between the
 * time the value was collected and this callback fires, `set()` may have
 * stored a new value under the same key — deleting blindly would lose it.
 *
 * Exported for testing only — not part of the public API contract.
 */
export function cleanupStaleEntry<K, V extends object>(entries: Map<K, WeakRef<V>>, key: K): void {
  const ref = entries.get(key);
  if (ref !== undefined && ref.deref() === undefined) {
    entries.delete(key);
  }
}
