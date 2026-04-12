/**
 * LRUCache — a bounded cache with Least-Recently-Used eviction.
 *
 * Data structure: a doubly-linked list of fixed-capacity node slots backed by
 * four parallel typed/plain arrays plus a free-stack, combined with a native
 * Map<K, number> that maps cache keys to slot indices.
 *
 *   kPrev: Int32Array        — previous-node slot index (linked-list spine)
 *   kNext: Int32Array        — next-node slot index
 *   kKeys: (K|undefined)[]   — cache key stored at each slot
 *   kVals: (V|undefined)[]   — cache value stored at each slot
 *   kIndex: Map<K, number>   — O(1) key → slot lookup
 *   kFree: number[]          — stack of recycled slot indices
 *   kSize: number            — current number of entries
 *
 * The sentinel at slot 0 is the list head/tail anchor: next[SENTINEL] is the
 * MRU node, prev[SENTINEL] is the LRU node. Slot 0 is never used for real data
 * — user slots start at 1.
 *
 * All linked-list bookkeeping (prev/next) is purely numeric — Int32Array keeps
 * it cache-friendly and GC-pressure free. The keys/vals arrays hold JS values
 * and are plain arrays (not typed arrays) to support arbitrary K and V types
 * while remaining monomorphic at each call site.
 *
 * detach() and insertAfterSentinel() are module-level free functions (not per-
 * instance closures) so V8 ICs for those call sites remain monomorphic across
 * all LRUCache instances — every instance has the same struct shape.
 *
 * When to use: bounded caches where recency proxies usefulness — memoized
 * computations, DNS results, rendered templates, parsed queries. Always set
 * `capacity` explicitly; an unbounded `Map` is simpler when the key space is
 * known to be small. If cached values are large objects that should be
 * released under memory pressure, prefer `WeakCache`. To memoize with a
 * bounded LRU cache, pass an LRUCache-backed `Map` to `Memoization.memoize`
 * via `opts.cache`.
 */

const kPrev: unique symbol = Symbol("prev");
const kNext: unique symbol = Symbol("next");
const kKeys: unique symbol = Symbol("keys");
const kVals: unique symbol = Symbol("vals");
const kIndex: unique symbol = Symbol("index");
const kFree: unique symbol = Symbol("free");
const kSize: unique symbol = Symbol("size");

const SENTINEL = 0; // slot 0 is the head/tail anchor — never holds real data

export interface LRUCache<K, V> {
  [kPrev]: Int32Array;
  [kNext]: Int32Array;
  [kKeys]: (K | undefined)[];
  [kVals]: (V | undefined)[];
  [kIndex]: Map<K, number>;
  [kFree]: number[];
  [kSize]: number;
}

/**
 * Creates a new LRUCache with the given maximum `capacity`.
 *
 * `capacity` must be a positive integer. When the cache is full and a new key
 * is inserted, the least-recently-used entry is evicted to make room.
 */
export function make<K, V>(capacity: number): LRUCache<K, V> {
  if (capacity < 1 || (capacity | 0) !== capacity) {
    throw new RangeError(`LRUCache.make: capacity must be a positive integer, got ${capacity}`);
  }

  // +1 for the sentinel at slot 0.
  const slots = capacity + 1;
  const prev = new Int32Array(slots);
  const next = new Int32Array(slots);
  // Pre-allocate to `slots` length so V8 picks a stable element kind for these
  // arrays and does not resize the backing store on first use.
  const keys: (K | undefined)[] = Array(slots);
  const vals: (V | undefined)[] = Array(slots);

  // Sentinel: points to itself — empty list.
  prev[SENTINEL] = SENTINEL;
  next[SENTINEL] = SENTINEL;

  // Free stack: slots 1..capacity are all available initially.
  const free: number[] = Array(capacity);
  for (let i = 0; i < capacity; i++) {
    free[i] = i + 1;
  }

  const cache: LRUCache<K, V> = {
    [kPrev]: prev,
    [kNext]: next,
    [kKeys]: keys,
    [kVals]: vals,
    [kIndex]: new Map(),
    [kFree]: free,
    [kSize]: 0,
  };
  // Write kSize a second time so V8 marks the field as mutable from the first
  // make() call — same rationale as Queue's kCapacityMask double-write.
  cache[kSize] = 0;

  return cache;
}

/**
 * Returns the value associated with `key`, or `undefined` if not present.
 * Promotes the entry to the most-recently-used position.
 */
export function get<K, V>(cache: LRUCache<K, V>, key: K): V | undefined {
  const slot = cache[kIndex].get(key);
  if (slot === undefined) return void 0;
  detach(cache, slot);
  insertAfterSentinel(cache, slot);
  return cache[kVals][slot];
}

/**
 * Inserts or updates `key` with `value`.
 * On insert, if the cache is full the least-recently-used entry is evicted.
 * On update, the entry is promoted to most-recently-used.
 */
export function set<K, V>(cache: LRUCache<K, V>, key: K, value: V): void {
  const existing = cache[kIndex].get(key);
  if (existing !== undefined) {
    cache[kVals][existing] = value;
    detach(cache, existing);
    insertAfterSentinel(cache, existing);
    return;
  }

  let slot: number;
  if (cache[kFree].length > 0) {
    slot = cache[kFree].pop() as number;
    cache[kSize]++;
  } else {
    // Evict the LRU entry (prev[SENTINEL] is the tail = LRU node).
    slot = cache[kPrev][SENTINEL];
    cache[kIndex].delete(cache[kKeys][slot] as K);
    detach(cache, slot);
    // kSize stays the same — we are reusing a slot.
  }

  cache[kKeys][slot] = key;
  cache[kVals][slot] = value;
  cache[kIndex].set(key, slot);
  insertAfterSentinel(cache, slot);
}

/**
 * Returns `true` if `key` is present in the cache.
 * Does not affect the recency order.
 */
export function has<K, V>(cache: LRUCache<K, V>, key: K): boolean {
  return cache[kIndex].has(key);
}

/**
 * Removes `key` from the cache.
 * Returns `true` if the key was present, `false` otherwise.
 */
export function del<K, V>(cache: LRUCache<K, V>, key: K): boolean {
  const slot = cache[kIndex].get(key);
  if (slot === undefined) return false;
  cache[kIndex].delete(key);
  detach(cache, slot);
  cache[kKeys][slot] = void 0;
  cache[kVals][slot] = void 0;
  cache[kFree].push(slot);
  cache[kSize]--;
  return true;
}

/**
 * Returns the number of entries currently in the cache.
 */
export function size<K, V>(cache: LRUCache<K, V>): number {
  return cache[kSize];
}

// --- Internal helpers ---

function detach<K, V>(cache: LRUCache<K, V>, slot: number): void {
  const prev = cache[kPrev];
  const next = cache[kNext];
  const p = prev[slot];
  const n = next[slot];
  next[p] = n;
  prev[n] = p;
}

function insertAfterSentinel<K, V>(cache: LRUCache<K, V>, slot: number): void {
  const prev = cache[kPrev];
  const next = cache[kNext];
  const n = next[SENTINEL];
  next[SENTINEL] = slot;
  prev[slot] = SENTINEL;
  next[slot] = n;
  prev[n] = slot;
}
