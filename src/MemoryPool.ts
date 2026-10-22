/**
 * MemoryPool — object pool with LIFO free list for allocation-free hot paths.
 *
 * Pre-allocates or lazily creates objects via a `factory` function and recycles
 * them through a stack-based (LIFO) free list. An optional `reset` callback
 * clears mutable state before returning objects to the pool.
 *
 * When to use: hot loops that create and discard thousands of same-shape
 * objects per tick (request handlers, parsers, batch processors). For very
 * short stacks of reusable objects (fewer than ~10 items), a plain array with
 * `.push()` / `.pop()` is faster — the pool's factory/reset/maxSize
 * bookkeeping adds overhead that only pays off at scale.
 *
 * Design tradeoffs:
 *   - LIFO array stack rather than a ring buffer: the most recently released
 *     (cache-hot) object is handed out next, with no index wraparound.
 *   - `maxSize` must be a non-negative number and `minSize` a non-negative
 *     integer; otherwise `make` throws `RangeError`. A throwing `factory`
 *     does not consume a slot; a throwing `reset` drops that instance (it is
 *     not recycled) and frees its slot, and the error propagates.
 *   - `withAcquire` is settle-aware: if `fn` returns a thenable, the instance
 *     is released when it settles (the call then returns a new Promise), so
 *     async borrowers never share an instance or see `reset` mid-use.
 *   - No ownership tracking or double-release guards — intentionally simple.
 *     If ownership tracking is needed during development, wrap the pool in a
 *     Set-based borrow-checker at the call site.
 *
 * @example
 * ```ts
 * import * as MemoryPool from "@dolphin278/vjuga/MemoryPool";
 * const pool = MemoryPool.make({ factory: (): number[] => [], reset: (a) => { a.length = 0; } });
 * const arr = MemoryPool.acquire(pool);
 * arr.push(1, 2, 3);
 * MemoryPool.release(pool, arr); // reset clears it, returned to free list
 * ```
 */

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

  // `!(x >= 0)` also rejects NaN, which would otherwise silently mean "unlimited".
  if (!(maxSize >= 0)) {
    throw new RangeError("maxSize must be a non-negative number");
  }
  if (minSize !== undefined && !(Number.isInteger(minSize) && minSize >= 0)) {
    throw new RangeError("minSize must be a non-negative integer");
  }
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

  // Count only after the factory succeeds: a throwing factory must not leak a slot.
  const instance = pool[kFactory]();
  pool[kAcquiredCount]++;
  return instance;
}

export function release<T extends object>(pool: MemoryPool<T>, instance: T): void {
  const reset = pool[kReset];
  if (reset !== undefined) {
    try {
      reset(instance);
    } catch (error) {
      // The instance may be half-reset, so drop it instead of recycling, but
      // free its slot so the pool does not shrink permanently.
      pool[kAcquiredCount]--;
      throw error;
    }
  }

  pool[kAcquiredCount]--;
  pool[kFreeList].push(instance);
}

/**
 * Acquires an instance, calls `fn(instance)` and releases the instance
 * afterwards, also when `fn` throws (`fn`'s error wins over a throwing
 * `reset`).
 *
 * If `fn` returns a thenable (e.g. an `async` function), the instance stays
 * borrowed until it settles, and `withAcquire` returns a new Promise that
 * settles the same way after the release: fulfilment with `fn`'s value (or
 * rejection with a throwing `reset`'s error), rejection with `fn`'s reason
 * (which wins over a throwing `reset`). Concurrent async borrowers therefore
 * hold distinct instances and count against `maxSize`. Acquisition errors
 * (`MemoryPoolExhaustedError`, a throwing `factory`) are thrown synchronously
 * even for an async `fn`, which is then not called.
 */
export function withAcquire<T extends object, R>(
  pool: MemoryPool<T>,
  fn: (instance: T) => PromiseLike<R>,
): Promise<R>;
export function withAcquire<T extends object, R>(pool: MemoryPool<T>, fn: (instance: T) => R): R;
export function withAcquire<T extends object, R>(pool: MemoryPool<T>, fn: (instance: T) => R): R {
  const instance = acquire(pool);
  let result: R;
  let then: unknown;
  try {
    result = fn(instance);
    // Read `.then` inside the try: a throwing getter must still release.
    then = isObjectLike(result) ? (result as { then?: unknown }).then : undefined;
  } catch (error) {
    releaseQuietly(pool, instance);
    throw error;
  }
  if (typeof then === "function") {
    return releaseOnSettle(pool, instance, result as PromiseLike<unknown>) as R;
  }
  release(pool, instance);
  return result;
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Release, swallowing a `reset` error so the caller's error takes precedence. */
function releaseQuietly<T extends object>(pool: MemoryPool<T>, instance: T): void {
  try {
    release(pool, instance);
  } catch {
    // The caller's error takes precedence.
  }
}

// Off the sync hot path: only reached when `fn` returned a thenable.
// `await` adopts any thenable once (a misbehaving `then` that calls back
// twice or throws still settles exactly once), so `release` runs once.
async function releaseOnSettle<T extends object>(
  pool: MemoryPool<T>,
  instance: T,
  thenable: PromiseLike<unknown>,
): Promise<unknown> {
  let value: unknown;
  try {
    value = await thenable;
  } catch (error) {
    releaseQuietly(pool, instance);
    throw error;
  }
  release(pool, instance);
  return value;
}
