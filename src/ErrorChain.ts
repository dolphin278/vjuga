import { Predicate } from "./FunctionUtils.js";

/**
 * Generator function that walks throgh the error cause fields and yields each
 * individual error.
 */
export function* chain(error: Error) {
  let current: unknown = error;
  while (current instanceof Error) {
    yield current;
    current = current.cause;
  }
}

/**
 * Reads error chain and return whole chain as an array.
 *
 * Introduced to avoid using `Array.from` and generator function.
 */
export function toArray(error: Error) {
  const chain = [];
  let current: unknown = error;
  while (current instanceof Error) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/**
 * Function takes predicate, walks throught the error chain and returns
 * true if the predicate matches any error in the chain.
 */
export function find(predicate: Predicate<unknown>, error: Error) {
  let current: unknown = error;

  while (current instanceof Error) {
    if (predicate(current)) {
      return current;
    } else {
      current = current.cause;
    }
  }
}
