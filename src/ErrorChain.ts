/**
 * ErrorChain — utilities for walking ES2022 `Error.cause` chains.
 *
 * Provides generator-based (`chain`) and eager (`toArray`) traversal of the
 * `Error.cause` chain, plus a `find` helper that short-circuits on the first
 * match.
 *
 * When to use: when you need to inspect or search a wrapped error chain (e.g.,
 * finding a specific error type deep in a cause chain). If you only need the
 * immediate cause, access `error.cause` directly.
 *
 * @example
 * ```ts
 * import * as ErrorChain from "vjuga/ErrorChain";
 * const root = new Error("root", { cause: new Error("inner") });
 * ErrorChain.toArray(root);  // [Error("root"), Error("inner")]
 * ErrorChain.find(root, (e) => e.message === "inner"); // Error("inner")
 * ```
 */

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
