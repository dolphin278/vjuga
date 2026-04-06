import type { Fn0, Fn1 } from "./FunctionUtils.js";

export interface DebugMemoryPoolConfig<T> {
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
  /**
   * Called when `dispose()` is invoked on the pool and there are still
   * acquired (unreleased) objects.  Use this to detect leaks during testing.
   */
  onLeak?: Fn1<Set<T>, void>;
}

/**
 * `DebugMemoryPool` is a drop-in replacement for `MemoryPool` that adds
 * full ownership tracking and safety checks.  Use it during development and
 * testing, then swap to the bare `MemoryPool` for production.
 *
 * Additional guarantees over `MemoryPool`:
 * - Throws on double-release.
 * - Throws on releasing an object that does not belong to this pool.
 * - `acquiredCount` and `freeCount` are kept consistent and readable.
 * - Optional `onLeak` callback fires when `dispose()` detects live borrows.
 */
export interface DebugMemoryPool<T> {
  factory: Fn0<T>;
  reset: Fn1<T, void> | undefined;
  onLeak: Fn1<Set<T>, void> | undefined;
  maxSize: number;
  freeList: T[];
  acquiredSet: Set<T>;
}

export function make<T extends object>(options: DebugMemoryPoolConfig<T>): DebugMemoryPool<T> {
  const { factory, reset, onLeak, maxSize: _maxSize, minSize } = options;
  const maxSize = _maxSize ?? 1024;

  if (minSize !== undefined && minSize > maxSize) {
    throw new Error("minSize cannot be greater than maxSize");
  }

  const freeList: T[] = [];
  const acquiredSet = new Set<T>();

  if (minSize !== undefined) {
    for (let i = 0; i < minSize; i++) {
      freeList.push(factory());
    }
  }

  return {
    factory,
    reset,
    onLeak,
    maxSize,
    freeList,
    acquiredSet,
  };
}

export function acquire<T extends object>(pool: DebugMemoryPool<T>): T {
  const { freeList, acquiredSet } = pool;

  if (freeList.length > 0) {
    const instance = freeList.pop()!;
    acquiredSet.add(instance);
    return instance;
  }

  if (acquiredSet.size >= pool.maxSize) {
    throw new Error("DebugMemoryPool is full");
  }

  const instance = pool.factory();
  acquiredSet.add(instance);
  return instance;
}

export function release<T extends object>(pool: DebugMemoryPool<T>, instance: T): void {
  if (!pool.acquiredSet.has(instance)) {
    throw new Error(
      "DebugMemoryPool: instance does not belong to this pool or was already released",
    );
  }

  if (pool.reset !== undefined) {
    pool.reset(instance);
  }

  pool.acquiredSet.delete(instance);
  pool.freeList.push(instance);
}

export function withAcquire<T extends object, R>(
  pool: DebugMemoryPool<T>,
  fn: (instance: T) => R,
): R {
  const instance = acquire(pool);
  try {
    return fn(instance);
  } finally {
    release(pool, instance);
  }
}

/**
 * Checks for unreleased objects and fires `onLeak` if configured.
 * Call this at the end of a test or request lifecycle to detect leaks.
 */
export function dispose<T extends object>(pool: DebugMemoryPool<T>): void {
  if (pool.acquiredSet.size > 0 && pool.onLeak !== undefined) {
    pool.onLeak(pool.acquiredSet);
  }
}

/** Number of objects currently lent out. */
export function acquiredCount<T extends object>(pool: DebugMemoryPool<T>): number {
  return pool.acquiredSet.size;
}

/** Number of objects currently sitting in the free list. */
export function freeCount<T extends object>(pool: DebugMemoryPool<T>): number {
  return pool.freeList.length;
}
