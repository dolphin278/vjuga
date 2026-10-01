/**
 * ErrorChain — utilities for walking ES2022 `Error.cause` chains.
 *
 * Provides generator-based (`chain`) and eager (`toArray`) traversal of the
 * `Error.cause` chain, plus a `find` helper that short-circuits on the first
 * match. Traversal stops at the first non-`Error` cause. Cyclic chains
 * (`a.cause = b; b.cause = a`) terminate: Brent's cycle detection, with no
 * allocation, ends the walk after one lap.
 *
 * When to use: when you need to inspect or search a wrapped error chain (e.g.,
 * finding a specific error type deep in a cause chain). If you only need the
 * immediate cause, access `error.cause` directly.
 *
 * @example
 * ```ts
 * import * as ErrorChain from "@dolphin278/vjuga/ErrorChain";
 * const root = new Error("root", { cause: new Error("inner") });
 * ErrorChain.toArray(root);  // [Error("root"), Error("inner")]
 * ErrorChain.find((e) => e.message === "inner", root); // Error("inner")
 * ```
 */

import type { Predicate } from "./FunctionUtils.js";

/**
 * Given a cycle of length `lambda` reachable from `error`, returns the number
 * of distinct errors (tail length + `lambda`). Floyd phase two: advance a
 * second pointer `lambda` steps, then step both until they meet.
 */
function distinctCount(error: Error, lambda: number): number {
  let hare: Error = error;
  for (let i = 0; i < lambda; i++) hare = hare.cause as Error;
  let tortoise: Error = error;
  let mu = 0;
  while (tortoise !== hare) {
    tortoise = tortoise.cause as Error;
    hare = hare.cause as Error;
    mu++;
  }
  return mu + lambda;
}

/**
 * Number of distinct errors reachable from `error` via `cause` (Brent's cycle
 * detection; no allocation).
 */
function distinctLength(error: Error): number {
  let mark: unknown = error;
  let current: unknown = error.cause;
  let steps = 1;
  let power = 1;
  let n = 1;
  while (current instanceof Error) {
    if (current === mark) return distinctCount(error, steps);
    n++;
    if (steps === power) {
      mark = current;
      power *= 2;
      steps = 0;
    }
    current = current.cause;
    steps++;
  }
  return n;
}

/**
 * Generator function that walks through the error cause fields and yields each
 * individual error once (a cyclic chain is cut after one lap).
 */
export function* chain(error: Error): Generator<Error> {
  const n = distinctLength(error);
  let current: Error = error;
  for (let i = 0; i < n; i++) {
    yield current;
    current = current.cause as Error;
  }
}

/**
 * Reads error chain and returns whole chain as an array (each error once).
 *
 * Introduced to avoid using `Array.from` and generator function.
 */
export function toArray(error: Error): Error[] {
  const result: Error[] = [];
  let mark: unknown = error;
  let current: unknown = error;
  let steps = 0;
  let power = 1;
  while (current instanceof Error) {
    result.push(current);
    current = current.cause;
    steps++;
    if (current === mark) {
      // Cycle: the walk has repeated errors; keep only one lap.
      result.length = distinctCount(error, steps);
      break;
    }
    if (steps === power) {
      mark = current;
      power *= 2;
      steps = 0;
    }
  }
  return result;
}

/**
 * Function takes predicate, walks through the error chain and returns
 * the first error for which the predicate matches (note the argument order:
 * predicate first, then the error). Terminates on cyclic chains; on a cycle
 * with no match the predicate may be called more than once for the same error.
 */
export function find(predicate: Predicate<Error>, error: Error): Error | undefined {
  let mark: unknown = error;
  let current: unknown = error;
  let steps = 0;
  let power = 1;
  while (current instanceof Error) {
    if (predicate(current)) return current;
    current = current.cause;
    steps++;
    if (current === mark) return undefined;
    if (steps === power) {
      mark = current;
      power *= 2;
      steps = 0;
    }
  }
  return undefined;
}
