/**
 * Memoization — function memoization with pluggable cache and key strategies.
 *
 * Default cache is an unbounded `Map`; callers should supply a bounded cache
 * (e.g., an LRUCache adapter) via the `cache` option when the key space is
 * large. `cache` only needs `get`/`has`/`set` (see `MemoizationCache`).
 *
 * Caveats:
 *   - Default key is `JSON.stringify(args)`: `null`/`undefined`/`NaN` collide,
 *     `0`/`-0` collide, all Maps/Sets collide, BigInt throws. Pass `cacheKeyFn`
 *     for such arguments.
 *   - Async results are cached as promises, so a rejection is cached forever;
 *     `this` is not forwarded to `fn`.
 *   - `once` retries after a throw and releases `fn` after the first success;
 *     a re-entrant call during the first run throws TypeError (see `once`).
 *
 * When to use: pure functions with repeated identical arguments (with a
 * bounded cache for large key spaces); `once` for argument-free lazy init.
 *
 * Design notes:
 *   - The two-lookup trick (`cache.get` then `cache.has`) keeps the common
 *     non-undefined case to a single Map lookup while correctly handling
 *     cached `undefined` values.
 *   - `defaultCacheKeyFn` is variadic (not single-array) to match the
 *     `Reflect.apply` call shape and keep the call site monomorphic.
 *
 * @example
 * ```ts
 * import * as Memoization from "@dolphin278/vjuga/Memoization";
 * const expensive = Memoization.memoize((n: number) => fibonacci(n));
 * expensive(40); // computed
 * expensive(40); // cached
 * const init = Memoization.once(() => loadConfig());
 * // Bounded cache: wrap an LRUCache handle in { get, has, set }:
 * // const lru = LRUCache.make<string, number>(100);
 * // Memoization.memoize(fn, { cache: {
 * //   get: (k) => LRUCache.get(lru, k),
 * //   has: (k) => LRUCache.has(lru, k),
 * //   set: (k, v) => LRUCache.set(lru, k, v),
 * // } });
 * ```
 */

import type { Fn } from "./FunctionUtils.js";

/** Minimal cache interface accepted by `memoize` (a `Map` satisfies it). */
export interface MemoizationCache<K, R> {
  get(key: K): R | undefined;
  has(key: K): boolean;
  set(key: K, value: R): unknown;
}

/**
 * Options for memoize function.
 * Note: the cache is unbounded by default — callers should supply a bounded
 * cache (e.g., an LRUCache adapter) via the `cache` option when the key space
 * is large.
 */
export interface MemoizationOptions<T extends readonly unknown[], R, K = string> {
  cacheKeyFn?: (...args: T) => K;
  cache?: MemoizationCache<K, R>;
}

/**
 * Function takes function and various options for cache and cache key calculation
 * and returns memoized function.
 */
export function memoize<T extends readonly unknown[], R, K = string>(
  fn: Fn<T, R>,
  options?: MemoizationOptions<T, R, K>,
): Fn<T, R> {
  const cacheKeyFn = (options?.cacheKeyFn ?? defaultCacheKeyFn) as (...args: T) => K;
  const cache: MemoizationCache<K, R> = options?.cache ?? new Map();

  return function memoized(...args: T): R {
    const key: K = Reflect.apply(cacheKeyFn, undefined, args) as K;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    // Two-lookup trick: `cache.get` returns `undefined` for both a missing key
    // and a key whose cached result is `undefined`. The second `cache.has` lookup
    // disambiguates — it is only reached when `cache.get` returned `undefined`,
    // i.e. when `fn` itself returned `undefined`. This keeps the common
    // (non-undefined) case to a single Map lookup.
    if (cache.has(key)) return undefined as R;
    const result: R = Reflect.apply(fn, undefined, args) as R;
    cache.set(key, result);
    return result;
  };
}

// `defaultCacheKeyFn` is declared as variadic (`...args: T`) rather than as a
// single-array argument (`(args: T) => string`) because `memoized` calls it via
// `Reflect.apply(cacheKeyFn, undefined, args)` — which spreads the argument
// array as individual positional arguments. A variadic signature receives them
// correctly, whereas a single-array signature would receive the entire args
// tuple as its first element, producing the same JSON but via a different
// (and less monomorphic) call shape. The two signatures are functionally
// equivalent here; the variadic form keeps the Reflect.apply call site
// monomorphic.
function defaultCacheKeyFn<T extends readonly unknown[]>(...args: T): string {
  return JSON.stringify(args);
}

/**
 * Returns a memoized version of `fn` that only calls the original function once.
 * If `fn` throws, the error propagates and the next call retries.
 * Throws TypeError if the wrapper is called again (directly or indirectly)
 * from inside `fn` while that first run is still in progress: there is no
 * result to return yet, and running `fn` again would break the "once"
 * guarantee. An async `fn` that re-enters after its first `await` gets the
 * cached promise. One that re-enters before its first `await` (still inside
 * the first run) gets the TypeError thrown into its body: unless it catches
 * it, the returned promise rejects with it, and that promise is cached like
 * any other result (`once` does not inspect results).
 */
export function once<T extends readonly unknown[], R>(fn: Fn<T, R>): Fn<T, R> {
  // definite assignment: result is always set before first read (guarded by `f`)
  let result!: R;
  // `f` doubles as the "not yet succeeded" flag; it is released after success
  // so `fn`'s closure can be collected. A throw leaves it set, so the next call
  // retries.
  let f: Fn<T, R> | undefined = fn;
  // Re-entrancy guard, only consulted before the first success; the
  // initialized fast path stays a single `f !== undefined` check.
  let running = false;
  return function memoized(...args: T): R {
    if (f !== undefined) {
      if (running) throw new TypeError("once: re-entrant call while fn is still running");
      running = true;
      try {
        result = Reflect.apply(f, null, args) as R;
        f = undefined;
      } finally {
        running = false;
      }
    }
    return result;
  };
}
