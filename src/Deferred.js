/**
 * @template T
 * @typedef {import('./FunctionUtils.js').Fn1<T>} Fn1
 */

/**
 * Function creates Deferred object with promise and resolve/reject
 * functions.
 *
 * This an equivalent of coming `Promise.withResolvers` proposal.
 *
 * @template T
 */
export function make() {
  /** @type {Fn1<T>} */
  let resolve;
  /** @type {Fn1<any>} */
  let reject;

  /** @type {Promise<T>} */
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // @ts-expect-error
  return { resolve: resolve, reject: reject, promise };
}

/**
 * @template T
 * @typedef {ReturnType<typeof make<T>>} Deferred
 */
