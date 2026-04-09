/**
 * PriorityQueue — binary min-heap backed by a `Queue<T>`.
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
 * The backing Queue handles growth/shrink automatically, including memory
 * recovery when the heap shrinks below 25% of a large buffer.
 */

import * as Queue from "./Queue.js";

const kQueue: unique symbol = Symbol("queue");
const kCmp: unique symbol = Symbol("comparator");

export interface PriorityQueue<T> {
  [kQueue]: Queue.Queue<T>;
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
    [kQueue]: Queue.make<T>(),
    [kCmp]: comparator,
  };

  if (items !== undefined) {
    heapify(pq, items);
  }

  return pq;
}

/**
 * Returns the number of elements in the heap.
 */
export function size<T>(pq: PriorityQueue<T>): number {
  return Queue.size(pq[kQueue]);
}

/**
 * Returns the minimum element without removing it.
 * Returns `undefined` if the heap is empty.
 */
export function peek<T>(pq: PriorityQueue<T>): T | undefined {
  if (Queue.size(pq[kQueue]) === 0) return void 0;
  return Queue.get(pq[kQueue], 0);
}

/**
 * Inserts `value` into the heap in O(log n).
 */
export function push<T>(pq: PriorityQueue<T>, value: T): void {
  const queue = pq[kQueue];
  Queue.push(queue, value);
  siftUp(pq, Queue.size(queue) - 1);
}

/**
 * Removes and returns the minimum element in O(log n).
 * Returns `undefined` if the heap is empty.
 */
export function pop<T>(pq: PriorityQueue<T>): T | undefined {
  const queue = pq[kQueue];
  const n = Queue.size(queue);
  if (n === 0) return void 0;
  const min = Queue.get(queue, 0);
  if (n === 1) {
    Queue.pop(queue);
  } else {
    // Move last element to root, remove last, then sift down.
    Queue.set(queue, 0, Queue.get(queue, n - 1));
    Queue.pop(queue);
    siftDown(pq, 0);
  }
  return min;
}

/**
 * Builds a heap from `items` in O(n) using the bottom-up heapify algorithm.
 * Replaces any existing contents of `pq`.
 */
export function heapify<T>(pq: PriorityQueue<T>, items: Iterable<T>): void {
  const queue = pq[kQueue];
  // Drain existing queue.
  Queue.dumpToArray(queue);
  // Push all items.
  for (const item of items) {
    Queue.push(queue, item);
  }
  const n = Queue.size(queue);
  // Bottom-up sift: start from the last non-leaf node ((n/2)-1) down to 0.
  for (let i = (n >> 1) - 1; i >= 0; i--) {
    siftDown(pq, i);
  }
}

// --- Internal helpers ---

function siftUp<T>(pq: PriorityQueue<T>, i: number): void {
  const queue = pq[kQueue];
  const cmp = pq[kCmp];
  const value = Queue.get(queue, i);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (Reflect.apply(cmp, undefined, [value, Queue.get(queue, parent)]) < 0) {
      Queue.set(queue, i, Queue.get(queue, parent));
      i = parent;
    } else {
      break;
    }
  }
  Queue.set(queue, i, value);
}

function siftDown<T>(pq: PriorityQueue<T>, i: number): void {
  const queue = pq[kQueue];
  const cmp = pq[kCmp];
  const n = Queue.size(queue);
  const value = Queue.get(queue, i);
  while (true) {
    const left = (i << 1) + 1;
    if (left >= n) break;
    const right = left + 1;
    // Pick the smaller child.
    const child =
      right < n &&
      Reflect.apply(cmp, undefined, [Queue.get(queue, right), Queue.get(queue, left)]) < 0
        ? right
        : left;
    if (Reflect.apply(cmp, undefined, [Queue.get(queue, child), value]) < 0) {
      Queue.set(queue, i, Queue.get(queue, child));
      i = child;
    } else {
      break;
    }
  }
  Queue.set(queue, i, value);
}
