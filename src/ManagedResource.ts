import { Fn0, Fn1 } from "./FunctionUtils.js";

/**
 * Function takes resource definition and function that takes instance of
 * the resource. `withResource` will create resource and dispose it when
 * function finishes.
 *
 * `withResource` makes best effor attempt to catch all exceptions and
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
  fn: Fn1<T, void | Promise<void>>
) {
  const resource = await factory();
  try {
    await fn(resource);
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToRunResourceConsumingFunctionError(err);
    }
    throw err;
  } finally {
    await dispose(resource);
  }
}

/**
 * Function takes resource definition and function that takes instance of
 * the resource. `withSyncResource` will create resource and dispose it when
 * function finishes.
 *
 * `withSyncResource` makes best effor attempt to catch all exceptions and
 * expose them via custom `Error` subclasses, so you can easily distinguish
 * between errors caused by resource and errors caused by user code.
 */
export function withSyncResource<T, R>(
  { factory, dispose }: { factory: Fn0<T>; dispose: Fn1<T> },
  fn: Fn1<T, R>
): ReturnType<typeof fn> {
  const resource = factory();
  try {
    return fn(resource);
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToRunResourceConsumingFunctionError(err);
    }
    throw err;
  } finally {
    dispose(resource);
  }
}

export class UnableToRunResourceConsumingFunctionError extends Error {
  constructor(error: Error) {
    super(`Unable to run resource consuming function: ${error.message}`, {
      cause: error,
    });
  }
}
