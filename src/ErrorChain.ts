import type { Predicate } from "./FunctionUtils.js";

/**
 * Generator function that walks through the error cause fields and yields each
 * individual error.
 */
export function* chain(error: Error): Generator<Error> {
  let current: unknown = error;
  while (current instanceof Error) {
    yield current;
    current = current.cause;
  }
}

/**
 * Reads error chain and returns whole chain as an array.
 *
 * Introduced to avoid using `Array.from` and generator function.
 */
export function toArray(error: Error): Error[] {
  const result: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    result.push(current);
    current = current.cause;
  }
  return result;
}

/**
 * Function takes predicate, walks through the error chain and returns
 * the error if the predicate matches any error in the chain.
 */
export function find(predicate: Predicate<unknown>, error: Error): Error | undefined {
  let current: unknown = error;

  while (current instanceof Error) {
    if (predicate(current)) {
      return current;
    } else {
      current = current.cause;
    }
  }
  return undefined;
}
