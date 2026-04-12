/**
 * OrderedMap — sorted key-value map backed by an AVL tree.
 *
 * When to use: when you need sorted iteration, floor/ceiling lookups, or
 * range scans in addition to O(log n) get/set/has/del. For unordered lookup
 * only, use plain `Map` — it is O(1) average and has less overhead. For
 * string prefix queries, use `RadixTree`.
 *
 * Internal design (SOA-style parallel arrays for cache-friendly node access):
 *   kRoot:   number              — root node index; -1 = empty tree.
 *   kKeys:   (K|undefined)[]     — key stored at node i.
 *   kVals:   (V|undefined)[]     — value stored at node i.
 *   kLeft:   Int32Array          — left child index; -1 = no child.
 *   kRight:  Int32Array          — right child index; -1 = no child.
 *   kHeight: Int32Array          — AVL height (leaf=1, null-sentinel=0).
 *   kSize:   number              — total key-value pairs in the tree.
 *   kCmp:    (a:K,b:K)=>number   — comparator function.
 *   kFree:   number[]            — recycled node slots (free list).
 *   kLen:    number              — allocated slot count.
 *
 * Design tradeoffs: AVL chosen over red-black — simpler rotation logic with
 * equal O(log n) guarantees; chosen over skip list — deterministic height
 * without PRNG dependency. Initial allocation: 16 slots; grows by doubling.
 * All traversals use an explicit stack to avoid call-stack overflow on deep
 * trees. Int32Array for tree topology keeps GC pressure low. For dense range
 * scans, prefer `forRange(m, lo, hi, fn)` over `range(m, lo, hi)` — it avoids
 * generator-frame overhead and is ~5× faster in tight loops.
 *
 * @example
 * ```ts
 * import * as OM from "vjuga/OrderedMap.js";
 * const m = OM.make<string, number>();
 * OM.set(m, "b", 2); OM.set(m, "a", 1); OM.set(m, "c", 3);
 * [...OM.keys(m)];                // ["a", "b", "c"]
 * OM.floor(m, "bb");              // ["b", 2]
 * OM.ceiling(m, "bb");           // ["c", 3]
 * [...OM.range(m, "a", "b")];    // [["a",1],["b",2]]
 * ```
 */

const kRoot: unique symbol = Symbol("root");
const kKeys: unique symbol = Symbol("keys");
const kVals: unique symbol = Symbol("vals");
const kLeft: unique symbol = Symbol("left");
const kRight: unique symbol = Symbol("right");
const kHeight: unique symbol = Symbol("height");
const kSize: unique symbol = Symbol("size");
const kCmp: unique symbol = Symbol("cmp");
const kFree: unique symbol = Symbol("free");
const kLen: unique symbol = Symbol("len");

const INIT_CAP = 16; // start with 16 slots to reduce early doubling on small maps
const NULL = -1; // sentinel value for "no node"

export interface OrderedMap<K, V> {
  [kRoot]: number;
  [kKeys]: (K | undefined)[];
  [kVals]: (V | undefined)[];
  [kLeft]: Int32Array;
  [kRight]: Int32Array;
  [kHeight]: Int32Array;
  [kSize]: number;
  [kCmp]: (a: K, b: K) => number;
  [kFree]: number[];
  [kLen]: number;
}

/** Default comparator — works correctly for number and string keys. */
function defaultCmp<K>(a: K, b: K): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Creates an empty `OrderedMap`. Supply an optional `compare` function
 * (returns negative/0/positive for a<b/a=b/a>b). Default comparator works
 * for `string` and `number` keys.
 */
export function make<K, V>(compare?: (a: K, b: K) => number): OrderedMap<K, V> {
  const cmp = compare ?? (defaultCmp as (a: K, b: K) => number);
  const free: number[] = Array(INIT_CAP);
  for (let i = 0; i < INIT_CAP; i++) free[i] = i;

  const m: OrderedMap<K, V> = {
    [kRoot]: NULL,
    [kKeys]: Array(INIT_CAP),
    [kVals]: Array(INIT_CAP),
    [kLeft]: new Int32Array(INIT_CAP).fill(NULL),
    [kRight]: new Int32Array(INIT_CAP).fill(NULL),
    [kHeight]: new Int32Array(INIT_CAP),
    [kSize]: 0,
    [kCmp]: cmp,
    [kFree]: free,
    [kLen]: INIT_CAP,
  };
  // Double-write mutable scalar fields so V8 marks them mutable from
  // the first make() call — prevents deoptimization on first mutation.
  m[kRoot] = NULL;
  m[kSize] = 0;
  m[kLen] = INIT_CAP;
  return m;
}

// ---------------------------------------------------------------------------
// Node allocation / deallocation
// ---------------------------------------------------------------------------

function allocNode<K, V>(m: OrderedMap<K, V>): number {
  if (m[kFree].length > 0) {
    return m[kFree].pop() as number;
  }
  // Grow by doubling
  const oldLen = m[kLen];
  const newLen = oldLen * 2;
  const newLeft = new Int32Array(newLen);
  const newRight = new Int32Array(newLen);
  const newHeight = new Int32Array(newLen);
  newLeft.set(m[kLeft]);
  newRight.set(m[kRight]);
  newHeight.set(m[kHeight]);
  // Fill new slots with NULL sentinels
  newLeft.fill(NULL, oldLen);
  newRight.fill(NULL, oldLen);
  m[kLeft] = newLeft;
  m[kRight] = newRight;
  m[kHeight] = newHeight;
  m[kLen] = newLen;
  // Push new slots (except slot oldLen which we return immediately) onto free
  for (let i = oldLen + 1; i < newLen; i++) m[kFree].push(i);
  return oldLen;
}

function freeNode<K, V>(m: OrderedMap<K, V>, n: number): void {
  m[kKeys][n] = undefined;
  m[kVals][n] = undefined;
  m[kLeft][n] = NULL;
  m[kRight][n] = NULL;
  m[kHeight][n] = 0;
  m[kFree].push(n);
}

// ---------------------------------------------------------------------------
// AVL helpers
// ---------------------------------------------------------------------------

function nodeHeight<K, V>(m: OrderedMap<K, V>, n: number): number {
  return n === NULL ? 0 : m[kHeight][n];
}

function updateHeight<K, V>(m: OrderedMap<K, V>, n: number): void {
  const lh = nodeHeight(m, m[kLeft][n]);
  const rh = nodeHeight(m, m[kRight][n]);
  m[kHeight][n] = 1 + (lh > rh ? lh : rh);
}

function balanceFactor<K, V>(m: OrderedMap<K, V>, n: number): number {
  return nodeHeight(m, m[kLeft][n]) - nodeHeight(m, m[kRight][n]);
}

// rotateRight: n has a heavy left subtree
//      n              l
//     / \            / \
//    l   C    =>    A   n
//   / \                / \
//  A   B              B   C
function rotateRight<K, V>(m: OrderedMap<K, V>, n: number): number {
  const l = m[kLeft][n];
  const b = m[kRight][l];
  m[kRight][l] = n;
  m[kLeft][n] = b;
  updateHeight(m, n);
  updateHeight(m, l);
  return l;
}

// rotateLeft: n has a heavy right subtree
function rotateLeft<K, V>(m: OrderedMap<K, V>, n: number): number {
  const r = m[kRight][n];
  const b = m[kLeft][r];
  m[kLeft][r] = n;
  m[kRight][n] = b;
  updateHeight(m, n);
  updateHeight(m, r);
  return r;
}

function rebalance<K, V>(m: OrderedMap<K, V>, n: number): number {
  updateHeight(m, n);
  const bf = balanceFactor(m, n);
  if (bf > 1) {
    // Left-heavy
    if (balanceFactor(m, m[kLeft][n]) < 0) {
      // LR case: rotate left child left first
      m[kLeft][n] = rotateLeft(m, m[kLeft][n]);
    }
    return rotateRight(m, n);
  }
  if (bf < -1) {
    // Right-heavy
    if (balanceFactor(m, m[kRight][n]) > 0) {
      // RL case: rotate right child right first
      m[kRight][n] = rotateRight(m, m[kRight][n]);
    }
    return rotateLeft(m, n);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Insert (recursive AVL — depth is O(log n), bounded by AVL invariant)
// ---------------------------------------------------------------------------

function insertNode<K, V>(
  m: OrderedMap<K, V>,
  root: number,
  key: K,
  val: V,
): number {
  if (root === NULL) {
    const n = allocNode(m);
    m[kKeys][n] = key;
    m[kVals][n] = val;
    m[kLeft][n] = NULL;
    m[kRight][n] = NULL;
    m[kHeight][n] = 1;
    m[kSize]++;
    return n;
  }
  const cmp = m[kCmp](key, m[kKeys][root] as K);
  if (cmp < 0) {
    // Use a temp variable rather than `m[kLeft][root] = insertNode(...)` to
    // avoid the JS LHS-before-RHS evaluation trap: if allocNode() grows the
    // backing Int32Array mid-recursion, the LHS `m[kLeft]` reference is
    // captured BEFORE the call and the write goes to the stale array.
    const newChild = insertNode(m, m[kLeft][root], key, val);
    m[kLeft][root] = newChild;
  } else if (cmp > 0) {
    const newChild = insertNode(m, m[kRight][root], key, val);
    m[kRight][root] = newChild;
  } else {
    // Key already exists — update value in place, no size change.
    m[kVals][root] = val;
    return root;
  }
  return rebalance(m, root);
}

// ---------------------------------------------------------------------------
// Delete helpers
// ---------------------------------------------------------------------------

// Returns [newRoot, minNodeIndex] — minNodeIndex is detached from the tree.
function deleteMin<K, V>(m: OrderedMap<K, V>, root: number): [number, number] {
  if (m[kLeft][root] === NULL) {
    // This node is the minimum; its right child takes its structural place.
    return [m[kRight][root], root];
  }
  const [newLeft, minIdx] = deleteMin(m, m[kLeft][root]);
  m[kLeft][root] = newLeft;
  return [rebalance(m, root), minIdx];
}

// Returns [newRoot, wasDeleted: boolean]
function deleteNode<K, V>(m: OrderedMap<K, V>, root: number, key: K): [number, boolean] {
  if (root === NULL) return [NULL, false];
  const cmp = m[kCmp](key, m[kKeys][root] as K);
  if (cmp < 0) {
    const [newLeft, deleted] = deleteNode(m, m[kLeft][root], key);
    m[kLeft][root] = newLeft;
    if (!deleted) return [root, false];
    return [rebalance(m, root), true];
  }
  if (cmp > 0) {
    const [newRight, deleted] = deleteNode(m, m[kRight][root], key);
    m[kRight][root] = newRight;
    if (!deleted) return [root, false];
    return [rebalance(m, root), true];
  }
  // Found — delete this node
  m[kSize]--;
  const left = m[kLeft][root];
  const right = m[kRight][root];
  if (right === NULL) {
    freeNode(m, root);
    return [left, true];
  }
  if (left === NULL) {
    freeNode(m, root);
    return [right, true];
  }
  // Two children: replace with in-order successor (min of right subtree)
  const [newRight, successor] = deleteMin(m, right);
  m[kLeft][successor] = left;
  m[kRight][successor] = newRight;
  freeNode(m, root);
  return [rebalance(m, successor), true];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Inserts or updates `key` with `value`. O(log n). */
export function set<K, V>(m: OrderedMap<K, V>, key: K, value: V): void {
  m[kRoot] = insertNode(m, m[kRoot], key, value);
}

/** Returns the value associated with `key`, or `undefined` if not present. O(log n). */
export function get<K, V>(m: OrderedMap<K, V>, key: K): V | undefined {
  let n = m[kRoot];
  const cmp = m[kCmp];
  while (n !== NULL) {
    const c = cmp(key, m[kKeys][n] as K);
    if (c < 0) {
      n = m[kLeft][n];
    } else if (c > 0) {
      n = m[kRight][n];
    } else {
      return m[kVals][n] as V;
    }
  }
  return undefined;
}

/** Returns `true` if `key` is in the map. O(log n). */
export function has<K, V>(m: OrderedMap<K, V>, key: K): boolean {
  return get(m, key) !== undefined;
}

/**
 * Removes `key` from the map. Returns `true` if the key was present,
 * `false` otherwise. O(log n).
 */
export function del<K, V>(m: OrderedMap<K, V>, key: K): boolean {
  const [newRoot, deleted] = deleteNode(m, m[kRoot], key);
  m[kRoot] = newRoot;
  return deleted;
}

/** Returns the number of key-value pairs in the map. O(1). */
export function size<K, V>(m: OrderedMap<K, V>): number {
  return m[kSize];
}

/** Returns the [key, value] pair with the smallest key, or `undefined` if empty. */
export function min<K, V>(m: OrderedMap<K, V>): [K, V] | undefined {
  let n = m[kRoot];
  if (n === NULL) return undefined;
  while (m[kLeft][n] !== NULL) n = m[kLeft][n];
  return [m[kKeys][n] as K, m[kVals][n] as V];
}

/** Returns the [key, value] pair with the largest key, or `undefined` if empty. */
export function max<K, V>(m: OrderedMap<K, V>): [K, V] | undefined {
  let n = m[kRoot];
  if (n === NULL) return undefined;
  while (m[kRight][n] !== NULL) n = m[kRight][n];
  return [m[kKeys][n] as K, m[kVals][n] as V];
}

/**
 * Returns the [key, value] pair with the largest key ≤ `key`, or `undefined`
 * if all keys are greater than `key`. O(log n).
 */
export function floor<K, V>(m: OrderedMap<K, V>, key: K): [K, V] | undefined {
  let n = m[kRoot];
  const cmp = m[kCmp];
  let best: number = NULL;
  while (n !== NULL) {
    const c = cmp(key, m[kKeys][n] as K);
    if (c === 0) return [m[kKeys][n] as K, m[kVals][n] as V];
    if (c > 0) {
      best = n;
      n = m[kRight][n];
    } else {
      n = m[kLeft][n];
    }
  }
  if (best === NULL) return undefined;
  return [m[kKeys][best] as K, m[kVals][best] as V];
}

/**
 * Returns the [key, value] pair with the smallest key ≥ `key`, or `undefined`
 * if all keys are less than `key`. O(log n).
 */
export function ceiling<K, V>(m: OrderedMap<K, V>, key: K): [K, V] | undefined {
  let n = m[kRoot];
  const cmp = m[kCmp];
  let best: number = NULL;
  while (n !== NULL) {
    const c = cmp(key, m[kKeys][n] as K);
    if (c === 0) return [m[kKeys][n] as K, m[kVals][n] as V];
    if (c < 0) {
      best = n;
      n = m[kLeft][n];
    } else {
      n = m[kRight][n];
    }
  }
  if (best === NULL) return undefined;
  return [m[kKeys][best] as K, m[kVals][best] as V];
}

// ---------------------------------------------------------------------------
// In-order traversal — explicit stack, no recursion (avoids stack overflow).
// Pseudocode:
//   let cur = root; stack = []
//   while cur !== NULL || stack.length > 0:
//     while cur !== NULL: stack.push(cur); cur = left[cur]
//     cur = stack.pop()
//     yield keys[cur] / [keys[cur], vals[cur]]
//     cur = right[cur]
// ---------------------------------------------------------------------------

/**
 * Yields all keys in ascending order. Uses an explicit stack — safe for any
 * tree depth.
 */
export function* keys<K, V>(m: OrderedMap<K, V>): IterableIterator<K> {
  // Cache array references before the first yield — each m[kXxx] symbol
  // lookup inside the loop costs an extra property read vs a direct array
  // access. V8 stores generator locals in a frame object anyway so caching
  // here adds no extra allocation.
  const left = m[kLeft];
  const right = m[kRight];
  const mkeys = m[kKeys];
  const stack: number[] = [];
  let cur = m[kRoot];
  while (cur !== NULL || stack.length > 0) {
    while (cur !== NULL) {
      stack.push(cur);
      cur = left[cur];
    }
    cur = stack.pop() as number;
    yield mkeys[cur] as K;
    cur = right[cur];
  }
}

/**
 * Yields all values in key-ascending order.
 */
export function* values<K, V>(m: OrderedMap<K, V>): IterableIterator<V> {
  const left = m[kLeft];
  const right = m[kRight];
  const mvals = m[kVals];
  const stack: number[] = [];
  let cur = m[kRoot];
  while (cur !== NULL || stack.length > 0) {
    while (cur !== NULL) {
      stack.push(cur);
      cur = left[cur];
    }
    cur = stack.pop() as number;
    yield mvals[cur] as V;
    cur = right[cur];
  }
}

/**
 * Yields all [key, value] pairs in key-ascending order.
 */
export function* entries<K, V>(m: OrderedMap<K, V>): IterableIterator<[K, V]> {
  const left = m[kLeft];
  const right = m[kRight];
  const mkeys = m[kKeys];
  const mvals = m[kVals];
  const stack: number[] = [];
  let cur = m[kRoot];
  while (cur !== NULL || stack.length > 0) {
    while (cur !== NULL) {
      stack.push(cur);
      cur = left[cur];
    }
    cur = stack.pop() as number;
    yield [mkeys[cur] as K, mvals[cur] as V];
    cur = right[cur];
  }
}

/**
 * Calls `fn(key, value)` for every entry where `lo ≤ key ≤ hi` in ascending
 * key order. Returns the count of entries visited.
 *
 * Prefer `forRange` over `range` in hot paths: it avoids the generator-frame
 * allocation and `yield` suspend/resume overhead (~5× faster in tight loops).
 * Use `range` when lazy iteration or `break`ing early from a `for…of` loop
 * is more convenient than a callback.
 */
// Module-level traversal scratch buffer for forRange — avoids a heap
// allocation per call. Size 128 is safe: AVL height ≤ 1.44·log₂(n+2), so
// n ≈ 2^87 would overflow — effectively unbounded for JavaScript integers.
// Safe for single-threaded synchronous use; not safe if fn() re-enters
// forRange on the same global stack, so callbacks should not call forRange.
const _forRangeStack = new Int32Array(128);

export function forRange<K, V>(
  m: OrderedMap<K, V>,
  lo: K,
  hi: K,
  fn: (k: K, v: V) => void,
): number {
  const cmp = m[kCmp];
  const left = m[kLeft];
  const right = m[kRight];
  const mkeys = m[kKeys];
  const mvals = m[kVals];
  // Use pre-allocated Int32Array stack with manual top pointer: avoids the
  // dynamic number[] heap allocation and push/pop overhead on each call.
  let top = 0;
  let cur = m[kRoot];
  // Initialise to ceiling(lo) — same descent as range().
  while (cur !== NULL) {
    if (cmp(mkeys[cur] as K, lo) >= 0) {
      _forRangeStack[top++] = cur;
      cur = left[cur];
    } else {
      cur = right[cur];
    }
  }
  let count = 0;
  while (top > 0) {
    cur = _forRangeStack[--top];
    const k = mkeys[cur] as K;
    if (cmp(k, hi) > 0) return count;
    fn(k, mvals[cur] as V);
    count++;
    let r = right[cur];
    while (r !== NULL) {
      _forRangeStack[top++] = r;
      r = left[r];
    }
  }
  return count;
}

/**
 * Yields [key, value] pairs where `lo ≤ key ≤ hi`, in ascending key order.
 * Both bounds are inclusive.
 *
 * O(log n + k) where k is the number of results: the initialisation phase
 * descends the tree to the first key ≥ lo (like `ceiling`), then the iteration
 * phase visits only the in-range nodes, stopping as soon as a key > hi is seen.
 * A naive full in-order traversal would be O(n); the pruned version is ~n/k
 * times faster when the range is small relative to the map size.
 */
export function* range<K, V>(
  m: OrderedMap<K, V>,
  lo: K,
  hi: K,
): IterableIterator<[K, V]> {
  const cmp = m[kCmp];
  const left = m[kLeft];
  const right = m[kRight];
  // Cache mkeys/mvals: same symbol-lookup-elimination as keys()/values().
  const mkeys = m[kKeys];
  const mvals = m[kVals];
  const stack: number[] = [];
  // Initialise the stack to the path leading to the leftmost node ≥ lo.
  // Nodes with key < lo are skipped entirely (their subtrees cannot contain
  // in-range keys on the left side).
  let cur = m[kRoot];
  while (cur !== NULL) {
    if (cmp(mkeys[cur] as K, lo) >= 0) {
      // cur.key ≥ lo: might be in range; save it and descend left for smaller candidates.
      stack.push(cur);
      cur = left[cur];
    } else {
      // cur.key < lo: left subtree entirely below lo; skip right past cur.
      cur = right[cur];
    }
  }
  // Standard in-order continuation: each pop gives the next key ≥ lo.
  while (stack.length > 0) {
    cur = stack.pop() as number;
    const k = mkeys[cur] as K;
    // Early exit: once we pass hi there are no more in-range keys.
    if (cmp(k, hi) > 0) return;
    yield [k, mvals[cur] as V];
    // Descend the right subtree, pushing only nodes that could be ≤ hi.
    // The left-spine push mirrors the initialisation loop above.
    let r = right[cur];
    while (r !== NULL) {
      stack.push(r);
      r = left[r];
    }
  }
}
