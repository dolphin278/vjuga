/**
 * ISOTimestamp — branded string type for ISO 8601 datetime values.
 *
 * Wraps a plain string with a compile-time brand so that ISO timestamps cannot
 * be confused with arbitrary strings. Covers the datetime profile that
 * `Date.toISOString()` and JSON APIs produce: `YYYY-MM-DDTHH:mm:ss.sssZ` with
 * optional seconds, optional fractional seconds of any length (Postgres,
 * Python `isoformat()`, Go `RFC3339Nano`), uppercase `T`/`Z` and either `Z`
 * or `±HH:MM`. Durations, intervals and week dates are out of scope.
 *
 * When to use: any API boundary or data layer that serializes timestamps as
 * strings. Prefer `Date` internally for arithmetic; use this type at the edges
 * where strings cross trust boundaries. `ISODate` covers date-only values.
 *
 * Design tradeoffs: validation is one allocation-free char-code scan with
 * explicit field ranges and a real calendar check (`Date.parse` alone accepts
 * `"Tuesday"` and silently rolls `2023-02-29` and `T24:00` over). `toDate`
 * truncates fractions beyond milliseconds. `fromDate` / `fromEpochMs` throw
 * `RangeError` outside years 0000–9999 rather than brand an expanded-year
 * string. `now()` bypasses `toISOString()` via Hinnant's civil-from-days
 * algorithm with pre-built pad tables: ~20–25% faster on Node, ~5–20% slower
 * on Bun (whose native `toISOString` is already fast). `isRfc3339DateTime` /
 * `isRfc3339Time` are separate, stricter predicates for JSON Schema
 * `date-time` / `time` (RFC 3339 section 5.6).
 *
 * @example
 * ```ts
 * import { isoTimestamp, fromDate, toDate, now } from "@dolphin278/vjuga/ISOTimestamp";
 * const ts = isoTimestamp("2024-01-15T10:30:00.123456Z"); // branded
 * const date = toDate(ts);                 // Date (…00.123Z, truncated)
 * const back = fromDate(date);             // ISOTimestamp
 * const current = now();                   // current time
 * ```
 */

import type { Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";
import { daysInMonth } from "./ISODate.js";

/** Branded string guaranteed to be a valid ISO 8601 datetime. */
export type ISOTimestamp = Branded<string, "ISOTimestamp">;

// ---------------------------------------------------------------------------
// Pre-built pad lookup tables for zero-cost number→string formatting.
// ---------------------------------------------------------------------------
const PAD2: readonly string[] = /* @__PURE__ */ (() => {
  const t: string[] = Array(60);
  for (let i = 0; i < 60; i++) t[i] = String(i).padStart(2, "0");
  return t;
})();

const PAD3: readonly string[] = /* @__PURE__ */ (() => {
  const t: string[] = Array(1000);
  for (let i = 0; i < 1000; i++) t[i] = String(i).padStart(3, "0");
  return t;
})();

const PAD4: readonly string[] = /* @__PURE__ */ (() => {
  const t: string[] = Array(10000);
  for (let i = 0; i < 10000; i++) t[i] = String(i).padStart(4, "0");
  return t;
})();

/** Two ASCII digits at `i` as a number, or -1 (also past the end of `s`). */
function num2(s: string, i: number): number {
  const a = s.charCodeAt(i) - 48;
  const b = s.charCodeAt(i + 1) - 48;
  return a >= 0 && a <= 9 && b >= 0 && b <= 9 ? a * 10 + b : -1;
}

/** RFC 3339 full-date (`YYYY-MM-DD`, real calendar) at index 0..9 of `s`. */
function fullDate(s: string): boolean {
  if (s.charCodeAt(4) !== 45 || s.charCodeAt(7) !== 45) return false;
  const hi = num2(s, 0);
  const lo = num2(s, 2);
  const day = num2(s, 8);
  return hi >= 0 && lo >= 0 && day >= 1 && day <= daysInMonth(hi * 100 + lo, num2(s, 5));
}

/** Index after a run of ASCII digits starting at `i`. */
function skipDigits(s: string, i: number): number {
  let c = s.charCodeAt(i);
  while (c >= 48 && c <= 57) c = s.charCodeAt(++i);
  return i;
}

/**
 * Offset at `p` running to the end of `s`: `Z` (uppercase only unless `lower`)
 * or `±HH:MM` with HH <= 23, MM <= 59. Returns the signed offset in minutes,
 * or NaN when malformed.
 */
function offsetMinutes(s: string, p: number, lower: boolean): number {
  const c = s.charCodeAt(p);
  if (c === 90 || (lower && c === 122)) return p + 1 === s.length ? 0 : NaN;
  if ((c !== 43 && c !== 45) || p + 6 !== s.length || s.charCodeAt(p + 3) !== 58) return NaN;
  const oh = num2(s, p + 1);
  const om = num2(s, p + 4);
  if (oh < 0 || oh > 23 || om < 0 || om > 59) return NaN;
  return c === 45 ? -(oh * 60 + om) : oh * 60 + om;
}

/**
 * The documented ISO 8601 profile: date + `T` + `HH:mm`, optional `:ss` with
 * optional `.fraction` (>= 1 digit), then `Z` or `±HH:MM`. Ranges: hour 0–23,
 * minute/second 0–59, offset hour 0–23 / minute 0–59, real calendar day.
 */
function isValid(value: string): boolean {
  if (value.length < 17 || value.charCodeAt(10) !== 84 || value.charCodeAt(13) !== 58) return false;
  if (!fullDate(value)) return false;
  const hour = num2(value, 11);
  const minute = num2(value, 14);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  let p = 16;
  if (value.charCodeAt(p) === 58) {
    const sec = num2(value, 17);
    if (sec < 0 || sec > 59) return false;
    p = 19;
    if (value.charCodeAt(p) === 46) {
      p = skipDigits(value, 20);
      if (p === 20) return false;
    }
  }
  const off = offsetMinutes(value, p, false);
  return off === off; // NaN marks a malformed offset
}

/**
 * RFC 3339 `partial-time` + `time-offset` starting at index `i` and running
 * to the end of `s` (JSON Schema `time` semantics). A leap second (`:60`) is
 * accepted only when the instant is 23:59 UTC, on any date.
 */
function rfcTimeAt(s: string, i: number): boolean {
  if (s.charCodeAt(i + 2) !== 58 || s.charCodeAt(i + 5) !== 58) return false;
  const hour = num2(s, i);
  const minute = num2(s, i + 3);
  const sec = num2(s, i + 6);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || sec < 0 || sec > 60) return false;
  let p = i + 8;
  if (s.charCodeAt(p) === 46) {
    p = skipDigits(s, p + 1);
    if (p === i + 9) return false;
  }
  const off = offsetMinutes(s, p, true);
  if (off !== off) return false;
  if (sec < 60) return true;
  // Leap second: the UTC minute-of-day must be 23:59.
  return (((hour * 60 + minute - off) % 1440) + 1440) % 1440 === 1439;
}

/**
 * Allocation-free predicate for RFC 3339 section 5.6 `date-time`, with the
 * JSON Schema 2020-12 `format: "date-time"` semantics: seconds required, any
 * number (>= 1) of fraction digits, `Z` or `±hh:mm` offset (hh <= 23,
 * mm <= 59), case-insensitive `T` and `Z`, real calendar date, leap second
 * `:60` only at 23:59 UTC. Stricter than `isoTimestamp` in requiring seconds,
 * looser in accepting lowercase and leap seconds.
 *
 * Deliberately stricter than ajv-formats' full mode: rejects a space
 * separator, offsets without a colon or minutes (`+0130`, `+01`), and
 * `24:59:60+01:00`-style out-of-range fields; accepts fractions such as
 * `59.999999999999999` that ajv rounds up to 60.
 *
 * @example
 * ```ts
 * import { isRfc3339DateTime } from "@dolphin278/vjuga/ISOTimestamp";
 * isRfc3339DateTime("1963-06-19t08:30:06.283185z"); // true
 * isRfc3339DateTime("1985-04-12T23:20Z");           // false (no seconds)
 * ```
 */
export function isRfc3339DateTime(value: string): boolean {
  const t = value.charCodeAt(10);
  return value.length >= 20 && (t === 84 || t === 116) && fullDate(value) && rfcTimeAt(value, 11);
}

/**
 * Allocation-free predicate for RFC 3339 `full-time` (`partial-time` +
 * `time-offset`), i.e. JSON Schema 2020-12 `format: "time"`: `HH:MM:SS`, any
 * number (>= 1) of fraction digits, required `Z`/`z` or `±hh:mm` offset, leap
 * second `:60` only when the time is 23:59 UTC. Same ajv-formats divergences
 * as `isRfc3339DateTime`.
 *
 * @example
 * ```ts
 * import { isRfc3339Time } from "@dolphin278/vjuga/ISOTimestamp";
 * isRfc3339Time("15:59:60-08:00"); // true (23:59:60 UTC)
 * isRfc3339Time("12:00:00");       // false (no offset)
 * ```
 */
export function isRfc3339Time(value: string): boolean {
  return value.length >= 9 && rfcTimeAt(value, 0);
}

/**
 * Validates and brands a string as an ISOTimestamp.
 * Throws RangeError if the string is not a valid ISO 8601 datetime.
 */
export function isoTimestamp(value: string): ISOTimestamp {
  if (!isValid(value)) throw new RangeError(`Expected ISO 8601 datetime, got "${value}"`);
  return value as ISOTimestamp;
}

/**
 * Converts a Date to a branded ISOTimestamp via `toISOString()`. Throws
 * RangeError for an invalid Date or a year outside 0000–9999 (`toISOString`
 * would give an expanded `+010000-…` / `-000001-…` year that the brand's
 * grammar, and `isoTimestamp`, reject).
 */
export function fromDate(date: Date): ISOTimestamp {
  checkRange(date.getTime());
  return date.toISOString() as ISOTimestamp;
}

/**
 * Converts an ISOTimestamp back to a Date object. A Date has millisecond
 * resolution, so fraction digits beyond the third are truncated, never
 * rounded: `…:59.9999Z` stays in the same second (and day) rather than rolling
 * over. The input is normalised before parsing, so the result does not depend
 * on how an engine treats non-standard fraction lengths.
 */
export function toDate(ts: ISOTimestamp): Date {
  // Only 4-digit-year forms with seconds carry a fraction at index 19
  // (an expanded-year `+010000-…` string has ":" there).
  if (ts.charCodeAt(19) === 46) {
    const end = skipDigits(ts, 20);
    if (end > 23) return new Date(ts.slice(0, 23) + ts.slice(end));
  }
  return new Date(ts);
}

/** 9999-12-31T23:59:59.999Z + 1 ms — upper bound of the 4-digit-year fast path. */
const MAX_FAST_MS = 253402300800000;
/** 0000-01-01T00:00:00.000Z — the earliest instant with a 4-digit year. */
const MIN_MS = -62167219200000;

/**
 * Throws unless `ms` formats with a 4-digit year. `Date` truncates fractional
 * ms toward zero, so anything above `MIN_MS - 1` still lands in year 0000.
 * NaN fails both comparisons.
 */
function checkRange(ms: number): void {
  if (!(ms > MIN_MS - 1 && ms < MAX_FAST_MS)) {
    throw new RangeError(
      `ISOTimestamp out of range (0000-01-01T00:00:00.000Z .. 9999-12-31T23:59:59.999Z), got ${ms} ms`,
    );
  }
}

/**
 * Converts epoch milliseconds to an ISO 8601 UTC datetime string using
 * Hinnant's civil-from-days algorithm (integer arithmetic only) and pre-built
 * pad lookup tables. Avoids both Date allocation and the native toISOString()
 * C++ → JS string bridge. Negative and fractional inputs fall back to
 * `new Date(ms).toISOString()` (output identical to native). Throws
 * RangeError for NaN and for instants outside years 0000–9999, which the
 * brand cannot represent.
 *
 * @see https://howardhinnant.github.io/date_algorithms.html
 */
export function fromEpochMs(ms: number): ISOTimestamp {
  // Fast path covers integer ms in years 1970-9999; everything else (negative,
  // fractional, out of range, NaN) is range-checked here, off the hot path,
  // then formatted natively.
  if (!(ms >= 0 && ms < MAX_FAST_MS) || ms % 1 !== 0) {
    checkRange(ms);
    return new Date(ms).toISOString() as ISOTimestamp;
  }
  const rem_ms = ms % 1000;
  const totalSec = (ms - rem_ms) / 1000;
  const rem_sec = totalSec % 60;
  const totalMin = (totalSec - rem_sec) / 60;
  const rem_min = totalMin % 60;
  const totalHr = (totalMin - rem_min) / 60;
  const rem_hr = totalHr % 24;
  const z = (totalHr - rem_hr) / 24 + 719468;

  // Hinnant civil_from_days — all integer arithmetic.
  // z is always >= 719468 for non-negative ms, so the era branch for z < 0 is elided.
  const era = (z / 146097) | 0;
  const doe = z - era * 146097;
  const yoe = ((doe - ((doe / 1460) | 0) + ((doe / 36524) | 0) - ((doe / 146096) | 0)) / 365) | 0;
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + ((yoe / 4) | 0) - ((yoe / 100) | 0));
  const mp = ((5 * doy + 2) / 153) | 0;
  const d = doy - (((153 * mp + 2) / 5) | 0) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const yr = y + (m <= 2 ? 1 : 0);

  return (PAD4[yr] +
    "-" +
    PAD2[m] +
    "-" +
    PAD2[d] +
    "T" +
    PAD2[rem_hr] +
    ":" +
    PAD2[rem_min] +
    ":" +
    PAD2[rem_sec] +
    "." +
    PAD3[rem_ms] +
    "Z") as ISOTimestamp;
}

/**
 * Returns the current time as a branded ISOTimestamp. About 20–25% faster than
 * `new Date().toISOString()` on Node; about 5–20% slower on Bun.
 */
export function now(): ISOTimestamp {
  return fromEpochMs(Date.now());
}

/** Returns a `Validator<ISOTimestamp>` that validates unknown values as ISO timestamps. */
export function validator(): Validator<ISOTimestamp> {
  return function validateISOTimestamp(value: unknown): Result<ISOTimestamp, ValidationError> {
    if (typeof value !== "string")
      return err(new ValidationError("ISO 8601 datetime string", value));
    if (!isValid(value)) return err(new ValidationError("ISO 8601 datetime string", value));
    return ok(value as ISOTimestamp);
  };
}
