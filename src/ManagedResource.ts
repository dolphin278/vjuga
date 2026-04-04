/**
 * This module should become obsolete with introduction of
 * native support for `using` statement in JavaScript.
 */

import type { Fn0, Fn1 } from "./FunctionUtils.js";

/**
 * Function takes resource definition and function that takes instance of
 * the resource. `withResource` will create resource and dispose it when
 * function finishes.
 *
 * `withResource` makes best effort attempt to catch all exceptions and
 * expose them via custom `Error` subclasses, so you can easily distinguish
 * between errors caused by resource and errors caused by user code.
 */
export async function withResource<T>(
  {
    factory,
    dispose,
  }: {
    factory: Fn0<T | Promise<T>>;
    dispose: Fn1<T, void | Promise<void>>;
  },
  fn: Fn1<T, void | Promise<void>>,
): Promise<void> {
  const resource = await factory();
  try {
    await Reflect.apply(fn, undefined, [resource]);
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToRunResourceConsumingFunctionError(err);
    }
    throw err;
  } finally {
    await Reflect.apply(dispose, undefined, [resource]);
  }
}

export class UnableToRunResourceConsumingFunctionError extends Error {
  constructor(error: Error) {
    super(`Unable to run resource consuming function: ${error.message}`, {
      cause: error,
    });
  }
}
