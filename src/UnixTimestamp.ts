/**
 * UnixTimestamp — branded number type for Unix epoch seconds.
 *
 * Wraps a plain number with a compile-time brand so that Unix timestamps
 * cannot be confused with arbitrary numbers or millisecond-based timestamps.
 * The underlying value is seconds since 1970-01-01T00:00:00Z (negative values
 * represent pre-epoch dates).
 *
 * When to use: API boundaries and data layers that serialize timestamps as
 * integer seconds (POSIX time). If your system uses milliseconds throughout,
 * consider working with `Date.now()` directly and branding only at the edges.
 *
 * Design tradeoffs: uses `number` rather than `bigint` —
 * `Number.MAX_SAFE_INTEGER` seconds from epoch reaches year ~285,616, and
 * all `Date` APIs operate on numbers. `bigint` would force conversions at
 * every interop point for no practical gain.
 *
 * @example
 * ```ts
 * import { unixTimestamp, fromDate, toDate, now } from "vjuga/UnixTimestamp";
 * const ts = unixTimestamp(1705312200);   // branded
 * const date = toDate(ts);                // Date object
 * const back = fromDate(date);            // UnixTimestamp (floored)
 * const current = now();                  // current epoch seconds
 * ```
 */

import type { Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./Validator.js";
import { type ISOTimestamp, fromEpochMs } from "./ISOTimestamp.js";

/** Branded number guaranteed to be a finite Unix epoch timestamp in seconds. */
export type UnixTimestamp = Branded<number, "UnixTimestamp">;

/**
 * Validates and brands a number as a UnixTimestamp.
 * Accepts any finite number (negative values = pre-epoch). Throws RangeError
 * if the value is NaN, Infinity, or -Infinity.
 */
export function unixTimestamp(value: number): UnixTimestamp {
  if (!Number.isFinite(value))
    throw new RangeError(`Expected finite number for Unix timestamp, got ${value}`);
  return value as UnixTimestamp;
}

/** Converts a Date to a branded UnixTimestamp (seconds, floored). */
export function fromDate(date: Date): UnixTimestamp {
  return Math.floor(date.getTime() / 1000) as UnixTimestamp;
}

/** Converts a UnixTimestamp to a Date object. */
export function toDate(ts: UnixTimestamp): Date {
  return new Date(ts * 1000);
}

/** Returns the current time as a branded UnixTimestamp (seconds, floored). */
export function now(): UnixTimestamp {
  return Math.floor(Date.now() / 1000) as UnixTimestamp;
}

/** Converts an ISOTimestamp to a UnixTimestamp. */
export function fromISO(ts: ISOTimestamp): UnixTimestamp {
  return Math.floor(new Date(ts as string).getTime() / 1000) as UnixTimestamp;
}

/** Converts a UnixTimestamp to an ISOTimestamp. */
export function toISO(ts: UnixTimestamp): ISOTimestamp {
  return fromEpochMs(ts * 1000);
}

/** Returns a `Validator<UnixTimestamp>` for use with the Validator module. */
export function validator(): Validator<UnixTimestamp> {
  return function validateUnixTimestamp(value: unknown): Result<UnixTimestamp, ValidationError> {
    if (typeof value !== "number" || !Number.isFinite(value))
      return err(new ValidationError("finite number (Unix timestamp)", value));
    return ok(value as UnixTimestamp);
  };
}
