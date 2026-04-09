import type { Fn0, Fn1 } from "./FunctionUtils.js";

export interface MemoryPoolConfig<T> {
  factory: Fn0<T>;
  /**
   * Called on an object before it is returned to the free list.
   * Use this to clear mutable state so the next borrower starts clean.
   */
  reset?: Fn1<T, void>;
  /**
   * Maximum total objects this pool may ever create (pre-allocated + lazily
   * allocated).  Defaults to 1024.
   */
  maxSize?: number;
  /**
   * Number of objects to pre-allocate at pool creation time.
   */
  minSize?: number;
}

const kFactory: unique symbol = Symbol("factory");
const kReset: unique symbol = Symbol("reset");
const kMaxSize: unique symbol = Symbol("maxSize");
const kFreeList: unique symbol = Symbol("freeList");
const kAcquiredCount: unique symbol = Symbol("acquiredCount");

/**
 * `MemoryPool` is a simple memory pool for objects. Using it allows you to
 * avoid allocating new objects when you can reuse them.
 *
 * The free list is a plain array used as a stack (LIFO) for maximum
 * performance — measured 13× faster than a Queue-backed free list in
 * micro-benchmarks.
 *
 * This implementation intentionally has no ownership tracking or double-release
 * guards.  If ownership tracking is needed during development, wrap the pool in
 * a Set-based borrow-checker at the call site.
 *
 * `maxSize` is the maximum number of objects this pool will ever *create*
 * (pre-allocated + lazily allocated).  Acquiring beyond that limit throws.
 *
 * @example Application-level singleton (consumer-owned):
 *
 * ```ts
 * // my-app/pools.ts
 * export const ArrayPool = MemoryPool.make({ factory: () => [], reset: (a) => { a.length = 0; } });
 * export const MapPool   = MemoryPool.make({ factory: () => new Map(), reset: (m) => m.clear() });
 * export const SetPool   = MemoryPool.make({ factory: () => new Set(), reset: (s) => s.clear() });
 * ```
 */
export interface MemoryPool<T> {
  [kFactory]: Fn0<T>;
  [kReset]: Fn1<T, void> | undefined;
  [kMaxSize]: number;
  [kFreeList]: T[];
  [kAcquiredCount]: number;
}

export class MemoryPoolExhaustedError extends Error {
  constructor() {
    super("MemoryPool is full");
    this.name = "MemoryPoolExhaustedError";
  }
}

export class MemoryPoolMinSizeError extends Error {
  constructor() {
    super("minSize cannot be greater than maxSize");
    this.name = "MemoryPoolMinSizeError";
  }
}

export function make<T extends object>(options: MemoryPoolConfig<T>): MemoryPool<T> {
  const { factory, reset, maxSize: _maxSize, minSize } = options;
  const maxSize = _maxSize ?? 1024;

  if (minSize !== undefined && minSize > maxSize) {
    throw new MemoryPoolMinSizeError();
  }

  const freeList: T[] = [];

  if (minSize !== undefined) {
    for (let i = 0; i < minSize; i++) {
      freeList.push(factory());
    }
  }

  const pool: MemoryPool<T> = {
    [kFactory]: factory,
    [kReset]: reset,
    [kMaxSize]: maxSize,
    [kFreeList]: freeList,
    [kAcquiredCount]: 0,
  };
  // Write kAcquiredCount a second time so V8 marks it as a mutable field from
  // the very first make() call. acquire()/release() write to kAcquiredCount on
  // every call; without this, the first mutation triggers a cascade
  // deoptimization of every compiled MemoryPool function.
  pool[kAcquiredCount] = 0;

  return pool;
}

export function acquire<T extends object>(pool: MemoryPool<T>): T {
  const freeList = pool[kFreeList];

  if (freeList.length > 0) {
    pool[kAcquiredCount]++;
    return freeList.pop()!;
  }

  if (pool[kAcquiredCount] >= pool[kMaxSize]) {
    throw new MemoryPoolExhaustedError();
  }

  pool[kAcquiredCount]++;
  return pool[kFactory]();
}

export function release<T extends object>(pool: MemoryPool<T>, instance: T): void {
  if (pool[kReset] !== undefined) {
    Reflect.apply(pool[kReset], undefined, [instance]);
  }

  pool[kAcquiredCount]--;
  pool[kFreeList].push(instance);
}

export function withAcquire<T extends object, R>(pool: MemoryPool<T>, fn: (instance: T) => R): R {
  const instance = acquire(pool);
  try {
    return fn(instance);
  } finally {
    release(pool, instance);
  }
}
