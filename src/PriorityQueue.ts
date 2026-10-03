/**
 * PriorityQueue — binary min-heap backed by a plain array.
 *
 * The heap is 0-indexed:
 *
 *   parent(i)      = (i - 1) >> 1
 *   leftChild(i)   = (i << 1) + 1    (= 2i + 1)
 *   rightChild(i)  = (i << 1) + 2    (= 2i + 2)
 *   root           = index 0
 *
 * A comparator function determines priority. The heap is a *min-heap*: the
 * element for which `comparator(a, b) < 0` is "less than" b is considered
 * higher priority and will be returned first by `pop`.
 *
 * When to use: any scenario requiring repeated extraction of the
 * minimum-priority element — task scheduling, Dijkstra's algorithm, timer
 * heaps, rate-limited queues. For simple FIFO/LIFO, use `Queue` (lower
 * overhead). For top-k extraction from a large set, `heapify` + k pops is
 * O(n + k log n) — faster than sorting the full array.
 *
 * Internal design:
 *   kItems: Array<T | undefined>  — heap array, first kSize slots are live;
 *                                   `pop` shrinks it below 25% use (> 10 000
 *                                   slots; checked every 1024th size)
 *   kSize:  number                — number of live elements
 *   kCmp:   (a, b) => number      — comparator, called directly (no Reflect)
 *
 * Sifting moves a "hole" and writes the held value once at the end. If the
 * comparator throws, the moves are undone, so `push`/`pop`/`heapify` are
 * atomic: the heap is exactly as before the call. The heap is NOT stable: elements that
 * compare equal may come out in any order — encode a sequence number in the
 * comparator if FIFO tie-breaking is needed.
 *
 * @example
 * ```ts
 * import * as PQ from "@dolphin278/vjuga/PriorityQueue";
 * const q = PQ.make<number>((a, b) => a - b);
 * PQ.push(q, 3);
 * PQ.pop(q);
 * ```
 */

const kItems: unique symbol = Symbol("items");
const kSize: unique symbol = Symbol("size");
const kCmp: unique symbol = Symbol("comparator");

export interface PriorityQueue<T> {
  [kItems]: (T | undefined)[];
  [kSize]: number;
  [kCmp]: (a: T, b: T) => number;
}

/** Comparator type — returns negative if a < b (higher priority), 0 if equal, positive if a > b. */
export type Comparator<T> = (a: T, b: T) => number;

/**
 * Creates a new empty PriorityQueue with the given comparator.
 *
 * @param comparator - Determines element ordering. `comparator(a, b) < 0` means
 *   `a` has higher priority than `b` (min-heap semantics).
 * @param items - Optional iterable of initial elements. They are inserted via
 *   the O(n) `heapify` algorithm rather than n individual pushes.
 */
export function make<T>(comparator: Comparator<T>, items?: Iterable<T>): PriorityQueue<T> {
  const pq: PriorityQueue<T> = {
    [kItems]: [],
    [kSize]: 0,
    [kCmp]: comparator,
  };
  // Write kItems and kSize a second time so V8 marks them as mutable fields
  // from the very first make() call. push()/pop() mutate these on every call;
  // without this, the first mutation triggers a cascade deoptimization.
  pq[kItems] = [];
  pq[kSize] = 0;

  if (items !== undefined) {
    heapify(pq, items);
  }

  return pq;
}

/**
 * Returns the number of elements in the heap.
 */
export function size<T>(pq: PriorityQueue<T>): number {
  return pq[kSize];
}

/**
 * Returns the minimum element without removing it.
 * Returns `undefined` if the heap is empty.
 */
export function peek<T>(pq: PriorityQueue<T>): T | undefined {
  if (pq[kSize] === 0) return void 0;
  return pq[kItems][0];
}

/**
 * Inserts `value` into the heap in O(log n).
 */
export function push<T>(pq: PriorityQueue<T>, value: T): void {
  const items = pq[kItems];
  const n = pq[kSize];
  items[n] = value;
  pq[kSize] = n + 1;
  siftUp(pq, n);
}

/**
 * Removes and returns the minimum element in O(log n).
 * Returns `undefined` if the heap is empty. When the backing array exceeds
 * 10 000 slots and fewer than a quarter are live, it is truncated to twice
 * the live size (amortized O(1)). The check runs only when the new size is a
 * multiple of 1024, so truncation can lag by up to 1023 pops.
 */
export function pop<T>(pq: PriorityQueue<T>): T | undefined {
  const n = pq[kSize];
  if (n === 0) return void 0;
  const items = pq[kItems];
  const min = items[0] as T;
  const newSize = n - 1;
  if (newSize === 0) {
    items[0] = void 0;
    pq[kSize] = 0;
  } else {
    items[0] = items[newSize];
    items[newSize] = void 0;
    pq[kSize] = newSize;
    try {
      siftDown(pq, 0);
    } catch (e) {
      // siftDown restored the root; put the minimum back so pop is atomic.
      items[newSize] = items[0];
      items[0] = min;
      pq[kSize] = n;
      throw e;
    }
  }
  // Shrink: once a large heap (> 10 000 slots) drops below 25% utilization,
  // truncate the array to twice the live size so drained heaps release memory.
  // Checked only every 1024th size (a register-only AND, no `items.length`
  // load on the other 1023 pops) so the common pop path stays unchanged; the
  // truncation lags by < 1024 pops. Halving at <25% keeps it amortized O(1);
  // slots past kSize already hold undefined, so no live element is dropped.
  if ((newSize & 1023) === 0 && items.length > 10000 && newSize < items.length >> 2) {
    items.length = newSize << 1;
  }
  return min;
}

/**
 * Builds a heap from `items` in O(n) using the bottom-up heapify algorithm.
 * Replaces any existing contents of `pq`.
 */
export function heapify<T>(pq: PriorityQueue<T>, items: Iterable<T>): void {
  const arr: (T | undefined)[] = [];
  let n = 0;
  for (const item of items) {
    arr[n++] = item;
  }
  // Sift on a scratch heap so `pq` is untouched if the comparator throws.
  const tmp: PriorityQueue<T> = { [kItems]: arr, [kSize]: n, [kCmp]: pq[kCmp] };
  // Bottom-up sift: start from the last non-leaf node ((n/2)-1) down to 0.
  for (let i = (n >> 1) - 1; i >= 0; i--) {
    siftDown(tmp, i);
  }
  pq[kItems] = arr;
  pq[kSize] = n;
}

// --- Internal helpers ---

// Sifting is exception-safe: if the comparator throws, the catch block undoes
// the moves along the (deterministic) parent chain, restoring the exact state
// from before the sift. Costs nothing on the non-throwing path.
function siftUp<T>(pq: PriorityQueue<T>, start: number): void {
  const items = pq[kItems];
  const cmp = pq[kCmp];
  const value = items[start] as T;
  let i = start;
  try {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (cmp(value, items[parent] as T) < 0) {
        items[i] = items[parent];
        i = parent;
      } else {
        break;
      }
    }
  } catch (e) {
    // Shift the displaced ancestors back down, then drop the new element.
    let carry: T | undefined = value;
    for (let j = start; j !== i; j = (j - 1) >> 1) {
      const t = items[j];
      items[j] = carry;
      carry = t;
    }
    items[start] = void 0;
    pq[kSize] = start;
    throw e;
  }
  items[i] = value;
}

function siftDown<T>(pq: PriorityQueue<T>, start: number): void {
  const items = pq[kItems];
  const cmp = pq[kCmp];
  const n = pq[kSize];
  const value = items[start] as T;
  let i = start;
  try {
    while (true) {
      const left = (i << 1) + 1;
      if (left >= n) break;
      const right = left + 1;
      // Pick the smaller child.
      const child = right < n && cmp(items[right] as T, items[left] as T) < 0 ? right : left;
      if (cmp(items[child] as T, value) < 0) {
        items[i] = items[child];
        i = child;
      } else {
        break;
      }
    }
  } catch (e) {
    // Shift the promoted children back down, restoring `value` at `start`.
    for (let j = i; j !== start; j = (j - 1) >> 1) items[j] = items[(j - 1) >> 1];
    items[start] = value;
    throw e;
  }
  items[i] = value;
}
