import type { Fn } from "./FunctionUtils.js";

/**
 * Options for memoize function.
 * Note: the cache is unbounded by default — callers should supply a bounded
 * Map (e.g., an LRU map) via the `cache` option when the key space is large.
 */
export interface MemoizationOptions<T extends readonly unknown[], R, K = string> {
  cacheKeyFn?: (args: T) => K;
  cache?: Map<K, R>;
}

/**
 * Function takes function and various options for cache and cache key calculation
 * and returns memoized function.
 */
export function memoize<T extends readonly unknown[], R, K = string>(
  fn: Fn<T, R>,
  options?: MemoizationOptions<T, R, K>,
): Fn<T, R> {
  const cacheKeyFn = (options?.cacheKeyFn ?? defaultCacheKeyFn) as unknown as (args: T) => K;
  const cache: Map<K, R> = options?.cache ?? new Map();

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
 */
export function once<T extends readonly unknown[], R>(fn: Fn<T, R>): Fn<T, R> {
  // definite assignment: result is always set before first read (guarded by `called`)
  let result!: R;
  let called = false;
  return function memoized(...args: T): R {
    if (!called) {
      called = true;
      result = Reflect.apply(fn, null, args) as R;
    }
    return result;
  };
}
