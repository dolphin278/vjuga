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
 * Returns `undefined` if the heap is empty.
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
    siftDown(pq, 0);
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
  pq[kItems] = arr;
  pq[kSize] = n;
  // Bottom-up sift: start from the last non-leaf node ((n/2)-1) down to 0.
  for (let i = (n >> 1) - 1; i >= 0; i--) {
    siftDown(pq, i);
  }
}

// --- Internal helpers ---

function siftUp<T>(pq: PriorityQueue<T>, i: number): void {
  const items = pq[kItems];
  const cmp = pq[kCmp];
  const value = items[i] as T;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (Reflect.apply(cmp, undefined, [value, items[parent]]) < 0) {
      items[i] = items[parent];
      i = parent;
    } else {
      break;
    }
  }
  items[i] = value;
}

function siftDown<T>(pq: PriorityQueue<T>, i: number): void {
  const items = pq[kItems];
  const cmp = pq[kCmp];
  const n = pq[kSize];
  const value = items[i] as T;
  while (true) {
    const left = (i << 1) + 1;
    if (left >= n) break;
    const right = left + 1;
    // Pick the smaller child.
    const child =
      right < n && Reflect.apply(cmp, undefined, [items[right], items[left]]) < 0 ? right : left;
    if (Reflect.apply(cmp, undefined, [items[child], value]) < 0) {
      items[i] = items[child];
      i = child;
    } else {
      break;
    }
  }
  items[i] = value;
}
