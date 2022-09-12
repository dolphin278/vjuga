import { Fn0, Fn1 } from "./FunctionUtils.js";

/**
 * Function takes resource definition and function that takes instance of
 * the resource. `withAsyncResource` will create resource and dispose it when
 * function finishes.
 *
 * `withAsyncResource` makes best effor attempt to catch all exceptions and
 * expose them via custom `Error` subclasses, so you can easily distinguish
 * between errors caused by resource and errors caused by user code.
 */
export async function withAsyncResource<T>(
  {
    factory,
    dispose,
  }: {
    factory: Fn0<T | Promise<T>>;
    dispose: Fn1<T, void | Promise<void>>;
  },
  fn: Fn1<T, void | Promise<void>>
) {
  let resource: T;

  try {
    resource = await factory();
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToCreateResourceError(err);
    }
  }

  try {
    if (resource! === void 0) {
      throw new Error("Unreachable");
    }
    await fn(resource);
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToRunResourceConsumingFunctionError(err);
    }
    throw err;
  } finally {
    try {
      await dispose(resource!);
    } catch (err) {
      if (err instanceof Error) {
        throw new UnableToDisposeResourceError(err);
      }
      throw err;
    }
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
export function withSyncResource<T>(
  { factory, dispose }: { factory: Fn0<T>; dispose: Fn1<T> },
  fn: Fn1<T>
) {
  let resource: T | undefined;

  try {
    resource = factory();
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToCreateResourceError(err);
    }
  }

  try {
    if (resource === void 0) {
      throw new Error("Unreachable");
    }
    fn(resource);
  } catch (err) {
    if (err instanceof Error) {
      throw new UnableToRunResourceConsumingFunctionError(err);
    }
    throw err;
  } finally {
    try {
      dispose(resource!);
    } catch (err) {
      if (err instanceof Error) {
        throw new UnableToDisposeResourceError(err);
      }
      throw err;
    }
  }
}

export class UnableToCreateResourceError extends Error {
  constructor(error: Error) {
    super(`Unable to create resource: ${error.message}`, { cause: error });
  }
}

export class UnableToRunResourceConsumingFunctionError extends Error {
  constructor(error: Error) {
    super(`Unable to run resource consuming function: ${error.message}`, {
      cause: error,
    });
  }
}

export class UnableToDisposeResourceError extends Error {
  constructor(error: Error) {
    super(`Unable to dispose resource: ${error.message}`, { cause: error });
  }
}
