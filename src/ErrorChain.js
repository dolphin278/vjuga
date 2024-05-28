/**
 * @template T
 * @typedef {import("./FunctionUtils.js").Predicate<T>} Predicate
 */

/**
 * Generator function that walks throgh the error cause fields and yields each
 * individual error.
 *
 * @param {Error} error
 */
export function* chain(error) {
  /** @type {unknown} */
  let current = error;
  while (current instanceof Error) {
    yield current;
    current = current.cause;
  }
}

/**
 * Reads error chain and return whole chain as an array.
 *
 * Introduced to avoid using `Array.from` and generator function.
 *
 * @param {Error} error
 */
export function toArray(error) {
  const chain = [];
  /** @type {unknown} */
  let current = error;
  while (current instanceof Error) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/**
 * Function takes predicate, walks throught the error chain and returns
 * true if the predicate matches any error in the chain.
 *
 * @param {Predicate<unknown>} predicate
 * @param {Error} error
 */
export function find(predicate, error) {
  /** @type {unknown} */
  let current = error;

  while (current instanceof Error) {
    if (predicate(current)) {
      return current;
    } else {
      current = current.cause;
    }
  }
}
