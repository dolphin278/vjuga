/**
 * This moodule should become obsolete with intduction of
 * native support for `using` statement in JavaScript.
 */

/**
 * @template T
 * @typedef {import('./FunctionUtils.js').Fn0<T>} Fn0
 */

/**
 * @template T, U
 * @typedef {import('./FunctionUtils.js').Fn1<T, U>} Fn1
 */

/**
 * Function takes resource definition and function that takes instance of
 * the resource. `withResource` will create resource and dispose it when
 * function finishes.
 *
 * `withResource` makes best effor attempt to catch all exceptions and
 * expose them via custom `Error` subclasses, so you can easily distinguish
 * between errors caused by resource and errors caused by user code.
 *
 * @template T
 * @param {{
 *  factory: Fn0<T | Promise<T>>,
 *  dispose: Fn1<T, void | Promise<void>>,
 * }} param0
 * @param {Fn1<T, void | Promise<void>>} fn
 */
export async function withResource({ factory, dispose }, fn) {
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
  /**
   * @param {Error} error
   */
  constructor(error) {
    super(`Unable to run resource consuming function: ${error.message}`, {
      cause: error,
    });
  }
}
