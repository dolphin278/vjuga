/**
 * @template {readonly unknown []}T, R
 * @typedef {import("./FunctionUtils.js").Fn<T, R>} Fn
 */

/**
 * @template {readonly unknown[]} T
 * @template R
 * @template [K=string]
 * @typedef MemoizationOptions
 * @property {(args: T) => K} [cacheKeyFn]
 * @property {Map<K, R>} [cache]
 */

/**
 * Function takes function and various options for cache and cache key calculation
 * and returns memoized function.
 *
 * @template {readonly unknown[]} T
 * @template R
 * @template [K=string]
 * @param {Fn<T, R>} fn
 * @param {MemoizationOptions<T, R, K>} [options]
 * @returns {Fn<T, R>}
 */
export function memoize(fn, options) {
  const cacheKeyFn = options?.cacheKeyFn ?? defaultCacheKeyFn;
  /** @type {Map<K, R>} */
  const cache = options?.cache ?? new Map();

  /**
   * @param {T} args
   */
  return function memoized(...args) {
    /** @type {K} */
    const key = Reflect.apply(cacheKeyFn, undefined, args);
    if (cache.has(key)) {
      const value = cache.get(key);
      if (value === undefined) throw new Error("Undefined value in cache");
      return value;
    }
    /** @type {R} */
    const result = Reflect.apply(fn, undefined, args);
    cache.set(key, result);
    return result;
  };
}

/**
 *
 * @template {readonly unknown[]} T
 * @param  {T} args
 * @returns
 */
function defaultCacheKeyFn(...args) {
  return JSON.stringify(args);
}

/**
 *
 * @template {readonly unknown[]} T
 * @template R
 * @param {Fn<T, R>} fn
 * @returns {Fn<T, R>}
 */
export function once(fn) {
  /** @type {R} */
  let result;
  let called = false;
  return function memoized(...args) {
    if (!called) {
      called = true;
      result = Reflect.apply(fn, null, args);
    }
    return result;
  };
}
