/**
 * PriorityQueue — binary min-heap backed by a plain `T[]`.
 *
 * The heap array is 1-indexed: the root occupies index 1 and the array at
 * index 0 is never used. This simplifies the parent/child arithmetic:
 *
 *   parent(i)      = i >> 1
 *   leftChild(i)   = i << 1       (= 2i)
 *   rightChild(i)  = (i << 1) | 1 (= 2i+1)
 *
 * A comparator function determines priority. The heap is a *min-heap*: the
 * element for which `comparator(a, b) < 0` is "less than" b is considered
 * higher priority and will be returned first by `pop`.
 *
 * The backing array follows the same on-demand growth strategy as Queue's
 * internal kList: it starts small and doubles on overflow, keeping the heap
 * cache-friendly without pre-allocating an upper bound.
 */

const kData: unique symbol = Symbol("data");
const kSize: unique symbol = Symbol("size");
const kCmp: unique symbol = Symbol("comparator");

export interface PriorityQueue<T> {
  [kData]: T[];
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
  // Index 0 is unused; the heap root lives at index 1.
  const data: T[] = [void 0 as unknown as T];
  const pq: PriorityQueue<T> = {
    [kData]: data,
    [kSize]: 0,
    [kCmp]: comparator,
  };
  // Write kSize a second time so V8 marks the field as mutable from the first
  // make() call — same rationale as Queue's kCapacityMask double-write.
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
  return pq[kData][1];
}

/**
 * Inserts `value` into the heap in O(log n).
 */
export function push<T>(pq: PriorityQueue<T>, value: T): void {
  const data = pq[kData];
  const i = pq[kSize] + 1;
  pq[kSize] = i;
  data[i] = value;
  siftUp(pq, i);
}

/**
 * Removes and returns the minimum element in O(log n).
 * Returns `undefined` if the heap is empty.
 */
export function pop<T>(pq: PriorityQueue<T>): T | undefined {
  if (pq[kSize] === 0) return void 0;
  const data = pq[kData];
  const min = data[1];
  const last = pq[kSize];
  pq[kSize] = last - 1;
  if (last > 1) {
    data[1] = data[last];
    data[last] = void 0 as unknown as T; // release reference
    siftDown(pq, 1);
  } else {
    data[1] = void 0 as unknown as T; // release reference
  }
  return min;
}

/**
 * Builds a heap from `items` in O(n) using the bottom-up heapify algorithm.
 * Replaces any existing contents of `pq`.
 */
export function heapify<T>(pq: PriorityQueue<T>, items: Iterable<T>): void {
  const data = pq[kData];
  // Reset — keep index 0 as the unused sentinel.
  data.length = 1;
  for (const item of items) {
    data.push(item);
  }
  pq[kSize] = data.length - 1;

  // Bottom-up sift: start from the last non-leaf node (floor(n/2)) down to 1.
  for (let i = pq[kSize] >> 1; i >= 1; i--) {
    siftDown(pq, i);
  }
}

// --- Internal helpers ---

function siftUp<T>(pq: PriorityQueue<T>, i: number): void {
  const data = pq[kData];
  const cmp = pq[kCmp];
  const value = data[i];
  while (i > 1) {
    const parent = i >> 1;
    if (Reflect.apply(cmp, undefined, [value, data[parent]]) < 0) {
      data[i] = data[parent];
      i = parent;
    } else {
      break;
    }
  }
  data[i] = value;
}

function siftDown<T>(pq: PriorityQueue<T>, i: number): void {
  const data = pq[kData];
  const cmp = pq[kCmp];
  const n = pq[kSize];
  const value = data[i];
  while (true) {
    const left = i << 1;
    if (left > n) break;
    const right = left | 1;
    // Pick the smaller child.
    const child =
      right <= n && Reflect.apply(cmp, undefined, [data[right], data[left]]) < 0 ? right : left;
    if (Reflect.apply(cmp, undefined, [data[child], value]) < 0) {
      data[i] = data[child];
      i = child;
    } else {
      break;
    }
  }
  data[i] = value;
}
