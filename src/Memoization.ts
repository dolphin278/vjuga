import { Fn } from "./FunctionUtils.js";

type MemoizationOptions<T extends readonly unknown[], R, K = string> = {
  cacheKeyFn?: (...args: T) => K;
  cache?: Map<K, R>;
};

/**
 * Function takes function and various options for cache and cache key calculation
 * and returns memoized function.
 */
export function memoize<T extends readonly unknown[], R, K = string>(
  fn: Fn<T, R>,
  options?: MemoizationOptions<T, R, K>
): Fn<T, R> {
  const cacheKeyFn = options?.cacheKeyFn ?? defaultCacheKeyFn;
  const cache = options?.cache ?? new Map<K, R>();

  return function memoized(...args: T) {
    const key = Reflect.apply(cacheKeyFn, null, args) as K;
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = Reflect.apply(fn, null, args) as R;
    cache.set(key, result);
    return result;
  };
}

function defaultCacheKeyFn<T extends readonly unknown[]>(...args: T) {
  return JSON.stringify(args);
}

export function memoizeOnce<T extends readonly unknown[], R>(
  fn: Fn<T, R>
): Fn<T, R> {
  let result: R;
  let called = false;
  return function memoizedOnce(...args) {
    if (!called) {
      called = true;
      result = Reflect.apply(fn, null, args);
    }
    return result;
  };
}
