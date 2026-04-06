/**
 * Result<T, E> — discriminated-union type for computations that may fail.
 *
 * Representation: a two-element readonly tuple where index 0 is the boolean
 * discriminant (true = Ok, false = Err) and index 1 is the payload.
 *
 * The tuple representation is chosen over a plain object because:
 *   - Integer-index access (result[0], result[1]) avoids named-property lookup
 *     overhead in V8's Turboshaft pipeline.
 *   - The shape is always identical regardless of T or E, keeping all call-sites
 *     monomorphic — a single hidden class covers every Result.
 *   - The boolean discriminant at index 0 is Smi-like in V8 and is constant-folded
 *     by the JIT on monomorphic call sites.
 *   - Pairs naturally with destructuring: `const [ok, value] = result`.
 *
 * No symbols, no string literals as enum values (per Style Guide).
 */

export type Ok<T> = readonly [true, T];
export type Err<E> = readonly [false, E];
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Constructs an Ok result wrapping `value`.
 */
export function ok<T>(value: T): Ok<T> {
  return [true, value];
}

/**
 * Constructs an Err result wrapping `error`.
 */
export function err<E>(error: E): Err<E> {
  return [false, error];
}

/**
 * Type guard — narrows to Ok<T>.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result[0] === true;
}

/**
 * Type guard — narrows to Err<E>.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result[0] === false;
}

/**
 * Applies `fn` to the Ok value and wraps the result in a new Ok.
 * Passes Err through unchanged.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result[0]) {
    return ok(Reflect.apply(fn, undefined, [result[1]]) as U);
  }
  return result as Err<E>;
}

/**
 * Applies `fn` to the Err value and wraps the result in a new Err.
 * Passes Ok through unchanged.
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result[0]) {
    return err(Reflect.apply(fn, undefined, [result[1]]) as F);
  }
  return result as Ok<T>;
}

/**
 * Monadic bind. Applies `fn` to the Ok value, returning the resulting Result.
 * Passes Err through unchanged.
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result[0]) {
    return Reflect.apply(fn, undefined, [result[1]]) as Result<U, E>;
  }
  return result as Err<E>;
}

/**
 * Extracts the Ok value, or returns `fallback` if the result is Err.
 */
export function unwrapOr<T, E, U>(result: Result<T, E>, fallback: U): T | U {
  if (result[0]) {
    return result[1];
  }
  return fallback;
}

/**
 * Extracts the Ok value, or throws if the result is Err.
 *
 * This is an escape hatch — prefer `unwrapOr` or `flatMap` at boundaries.
 * If the Err payload is an Error instance it is re-thrown directly;
 * otherwise it is wrapped in a plain Error via String().
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result[0]) {
    return result[1];
  }
  const payload = result[1];
  if (payload instanceof Error) throw payload;
  throw new Error(String(payload), { cause: payload });
}

/**
 * Wraps a synchronously-throwing call in a Result.
 *
 * @param fn - Zero-argument function that may throw.
 * @param mapErrFn - Optional mapper applied to the caught value before
 *   wrapping it as Err. Defaults to identity (raw caught value, typed as `unknown`).
 */
export function fromThrowable<T, E = unknown>(
  fn: () => T,
  mapErrFn?: (error: unknown) => E,
): Result<T, E> {
  try {
    return ok(Reflect.apply(fn, undefined, []) as T);
  } catch (e) {
    return err(mapErrFn !== undefined ? (Reflect.apply(mapErrFn, undefined, [e]) as E) : (e as E));
  }
}

/**
 * Converts a `Promise<T>` to a `Promise<Result<T, E>>`.
 *
 * The returned promise always resolves — it never rejects.
 *
 * @param mapErrFn - Optional mapper applied to the rejection reason.
 *   Defaults to identity (raw caught value, typed as `unknown`).
 */
export function fromPromise<T, E = unknown>(
  promise: Promise<T>,
  mapErrFn?: (error: unknown) => E,
): Promise<Result<T, E>> {
  return promise.then(
    (value) => ok(value) as Result<T, E>,
    (e: unknown) =>
      err(
        mapErrFn !== undefined ? (Reflect.apply(mapErrFn, undefined, [e]) as E) : (e as E),
      ) as Result<T, E>,
  );
}

/**
 * Wraps an async function so it always resolves to `Result<T, E>` and never
 * rejects. The returned wrapper has the same signature as `fn`.
 *
 * @param mapErrFn - Optional mapper applied to the rejection reason.
 */
export function fromAsyncThrowable<Args extends readonly unknown[], T, E = unknown>(
  fn: (...args: Args) => Promise<T>,
  mapErrFn?: (error: unknown) => E,
): (...args: Args) => Promise<Result<T, E>> {
  return function asyncWrapped(...args: Args): Promise<Result<T, E>> {
    return fromPromise(
      Reflect.apply(fn, undefined, args as unknown as unknown[]) as Promise<T>,
      mapErrFn,
    );
  };
}
