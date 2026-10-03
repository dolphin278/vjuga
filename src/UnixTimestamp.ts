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
 * The brand does NOT enforce seconds or integrality: any finite number is
 * accepted, so a millisecond value such as `Date.now()` passes validation.
 * Pass seconds (`now()` / `fromDate()` produce them); fractional seconds are
 * allowed and `toDate` / `toISO` keep exact millisecond precision (`1.005`
 * is 1005 ms although `1.005 * 1000` is 1004.999…; sub-ms is truncated).
 * `toISO` throws `RangeError` outside years 0000–9999.
 *
 * Design tradeoffs: uses `number` rather than `bigint` —
 * `Number.MAX_SAFE_INTEGER` seconds from epoch reaches year ~285,616, and
 * all `Date` APIs operate on numbers. `bigint` would force conversions at
 * every interop point for no practical gain.
 *
 * @example
 * ```ts
 * import { unixTimestamp, fromDate, toDate, now } from "@dolphin278/vjuga/UnixTimestamp";
 * const ts = unixTimestamp(1705312200);   // branded
 * const date = toDate(ts);                // Date object
 * const back = fromDate(date);            // UnixTimestamp (floored)
 * const current = now();                  // current epoch seconds
 * ```
 */

import type { Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";
import { type ISOTimestamp, fromEpochMs, toDate as isoToDate } from "./ISOTimestamp.js";

/** Branded number guaranteed to be a finite Unix epoch timestamp in seconds. */
export type UnixTimestamp = Branded<number, "UnixTimestamp">;

/**
 * Validates and brands a number as a UnixTimestamp.
 * Accepts any finite number (negative values = pre-epoch; no unit or range
 * check, so milliseconds are not rejected). Throws RangeError if the value is
 * NaN, Infinity, or -Infinity.
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

/**
 * Seconds to epoch ms without losing a millisecond to floating-point error.
 * `ts * 1000` is often just below the intended integer (`1.005 * 1000` is
 * 1004.999…) and `Date` truncates it, so snap to the integer `r` whose
 * `r / 1000` is exactly `ts` (division is correctly rounded, so this holds
 * only when `ts` is that millisecond's own double). `Math.round` is off by
 * +1 only beyond 2^52 ms, hence the `r - 1` retry. Anything else is a real
 * sub-ms value and is truncated like `Date` does.
 */
function toEpochMs(ts: number): number {
  const ms = ts * 1000;
  const r = Math.round(ms);
  if (r / 1000 === ts) return r;
  if ((r - 1) / 1000 === ts) return r - 1;
  return Math.trunc(ms);
}

/**
 * Converts a UnixTimestamp to a Date object, exact to the millisecond
 * (sub-ms fractions are truncated).
 */
export function toDate(ts: UnixTimestamp): Date {
  return new Date(toEpochMs(ts));
}

/** Returns the current time as a branded UnixTimestamp (seconds, floored). */
export function now(): UnixTimestamp {
  return Math.floor(Date.now() / 1000) as UnixTimestamp;
}

/** Converts an ISOTimestamp to a UnixTimestamp. */
export function fromISO(ts: ISOTimestamp): UnixTimestamp {
  return Math.floor(isoToDate(ts).getTime() / 1000) as UnixTimestamp;
}

/**
 * Converts a UnixTimestamp to an ISOTimestamp, exact to the millisecond
 * (sub-ms fractions are truncated). Throws RangeError outside years
 * 0000–9999, which the ISOTimestamp brand cannot represent.
 */
export function toISO(ts: UnixTimestamp): ISOTimestamp {
  return fromEpochMs(toEpochMs(ts));
}

/** Returns a `Validator<UnixTimestamp>` that validates unknown values as Unix timestamps. */
export function validator(): Validator<UnixTimestamp> {
  return function validateUnixTimestamp(value: unknown): Result<UnixTimestamp, ValidationError> {
    if (typeof value !== "number" || !Number.isFinite(value))
      return err(new ValidationError("finite number (Unix timestamp)", value));
    return ok(value as UnixTimestamp);
  };
}
