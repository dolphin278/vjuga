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
 * import { unixTimestampExn, fromDate, toDate, now } from "@dolphin278/vjuga/UnixTimestamp";
 * const ts = unixTimestampExn(1705312200); // branded
 * const date = toDate(ts);                // Date object
 * const back = fromDate(date);            // UnixTimestamp (floored)
 * const current = now();                  // current epoch seconds
 * ```
 */

import { brandError, type Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";
import { type ISOTimestamp, fromEpochMs, toDate as isoToDate } from "./ISOTimestamp.js";

/** Branded number guaranteed to be a finite Unix epoch timestamp in seconds. */
export type UnixTimestamp = Branded<number, "UnixTimestamp">;

/** Why a number is not a `UnixTimestamp`: NaN or ±Infinity. */
export type UnixTimestampError = "not-finite";

/**
 * Guard: `value` is a finite number (negative = pre-epoch; no unit or range
 * check, so milliseconds pass). Accepts `unknown`.
 *
 * @example
 * ```ts
 * import { isUnixTimestamp } from "@dolphin278/vjuga/UnixTimestamp";
 * isUnixTimestamp(1705312200); // true
 * isUnixTimestamp(NaN);        // false
 * ```
 */
export function isUnixTimestamp(value: unknown): value is UnixTimestamp {
  return Number.isFinite(value);
}

/**
 * Result constructor: `value` as a UnixTimestamp, or `"not-finite"`.
 *
 * @example
 * ```ts
 * import { unixTimestamp } from "@dolphin278/vjuga/UnixTimestamp";
 * unixTimestamp(1705312200); // [true, 1705312200]
 * unixTimestamp(Infinity);   // [false, "not-finite"]
 * ```
 */
export function unixTimestamp(value: number): Result<UnixTimestamp, UnixTimestampError> {
  return isUnixTimestamp(value) ? ok(value) : err("not-finite");
}

/**
 * Throwing constructor: `value` as a UnixTimestamp, or a RangeError whose
 * `cause` is `"not-finite"`.
 *
 * @example
 * ```ts
 * import { unixTimestampExn } from "@dolphin278/vjuga/UnixTimestamp";
 * const ts = unixTimestampExn(1705312200);
 * ```
 */
export function unixTimestampExn(value: number): UnixTimestamp {
  if (!isUnixTimestamp(value)) throw brandError("UnixTimestamp", "not-finite", value);
  return value;
}

/**
 * Assertion: TypeError for a non-number, RangeError (`cause` `"not-finite"`)
 * for NaN and ±Infinity.
 *
 * @example
 * ```ts
 * import { assertUnixTimestamp } from "@dolphin278/vjuga/UnixTimestamp";
 * const v: unknown = 0;
 * assertUnixTimestamp(v); // v: UnixTimestamp from here on
 * ```
 */
export function assertUnixTimestamp(value: unknown): asserts value is UnixTimestamp {
  if (!isUnixTimestamp(value)) {
    throw brandError("UnixTimestamp", typeof value === "number" ? "not-finite" : undefined, value);
  }
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
 * only when `ts` is that millisecond's own double). For |ms| in
 * [2^51, 2^52), where doubles are 0.5 apart, `ts * 1000` can land on a .5
 * tie that `Math.round` rounds up, hence the `r - 1` retry (never needed
 * elsewhere; verified by sampling the whole Date range). Anything else is a
 * real sub-ms value and is truncated like `Date` does.
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
    if (isUnixTimestamp(value)) return ok(value);
    return err(new ValidationError("finite number (Unix timestamp)", value));
  };
}
