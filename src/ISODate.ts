/**
 * ISODate — branded string type for calendar dates (`YYYY-MM-DD`).
 *
 * Wraps a plain string with a compile-time brand so that date-only values
 * (frontmatter dates, ledger days, `check-after:` fields) cannot be confused
 * with arbitrary strings or with full timestamps. The grammar is RFC 3339
 * `full-date` (= ISO 8601 extended calendar date): exactly four year digits
 * 0000–9999, two month digits and two day digits, with a real proleptic
 * Gregorian calendar check (`2023-02-29` and `2026-13-01` are rejected).
 *
 * When to use: values that name a day, not an instant. All conversions are in
 * UTC, so `fromDate`/`today` never depend on the host time zone. Use
 * `ISOTimestamp` for instants.
 *
 * Design tradeoffs: validation is a single allocation-free char-code scan (no
 * regex, no `Date.parse`, which rolls `02-30` over). `addDays` is pure integer
 * calendar arithmetic (Hinnant's days-from-civil / civil-from-days), so it
 * never drifts across DST or leap years. `daysInMonth` is the one calendar
 * check (`ISOTimestamp` reuses it); `isISODate` matches JSON Schema
 * `format: "date"` (JSON-Schema-Test-Suite `date.json`).
 *
 * Prior art: RFC 3339 section 5.6; Howard Hinnant's date algorithms.
 *
 * @example
 * ```ts
 * import { isoDate, fromDate, today, addDays, toDate } from "@dolphin278/vjuga/ISODate";
 * const d = isoDate("2024-02-28");          // branded
 * addDays(d, 1);                            // "2024-02-29"
 * addDays(d, -59);                          // "2023-12-31"
 * fromDate(new Date("2024-03-01T23:30:00-05:00")); // "2024-03-02" (UTC)
 * toDate(d);                                // Date at 2024-02-28T00:00:00.000Z
 * today();                                  // current UTC date
 * ```
 */

import type { Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";

/** Branded string guaranteed to be a valid `YYYY-MM-DD` calendar date. */
export type ISODate = Branded<string, "ISODate">;

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Number of days in `month` (1–12) of `year` (proleptic Gregorian). Returns 0
 * for a month outside 1–12.
 *
 * @example
 * ```ts
 * import { daysInMonth } from "@dolphin278/vjuga/ISODate";
 * daysInMonth(2024, 2); // 29
 * daysInMonth(1900, 2); // 28
 * ```
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/** Two ASCII digits at `i` as a number, or -1 (also past the end of `s`). */
function num2(s: string, i: number): number {
  const a = s.charCodeAt(i) - 48;
  const b = s.charCodeAt(i + 1) - 48;
  return a >= 0 && a <= 9 && b >= 0 && b <= 9 ? a * 10 + b : -1;
}

/**
 * Allocation-free predicate for RFC 3339 `full-date` (`YYYY-MM-DD`, ASCII
 * digits only, month 01–12, day within the month incl. leap years). Exact
 * match: no surrounding whitespace, sign or extra digits. This is the
 * grammar behind `isoDate`, and it matches JSON Schema `format: "date"`.
 *
 * @example
 * ```ts
 * import { isISODate } from "@dolphin278/vjuga/ISODate";
 * isISODate("2020-02-29"); // true
 * isISODate("2021-02-29"); // false
 * ```
 */
export function isISODate(value: string): value is ISODate {
  if (value.length !== 10 || value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45) {
    return false;
  }
  const hi = num2(value, 0);
  const lo = num2(value, 2);
  const month = num2(value, 5);
  const day = num2(value, 8);
  return hi >= 0 && lo >= 0 && day >= 1 && day <= daysInMonth(hi * 100 + lo, month);
}

/**
 * Validates and brands a string as an ISODate.
 * Throws RangeError for a wrong shape or an impossible calendar date.
 */
export function isoDate(value: string): ISODate {
  if (!isISODate(value))
    throw new RangeError(`Expected ISO 8601 date (YYYY-MM-DD), got "${value}"`);
  return value;
}

const MS_PER_DAY = 86_400_000;
/** Days since 1970-01-01 of 0000-01-01 and 9999-12-31 (the brandable range). */
const MIN_DAY = -719_528;
const MAX_DAY = 2_932_896;

/** Hinnant days_from_civil for a branded date. */
function toDays(date: ISODate): number {
  const m = num2(date, 5);
  const d = num2(date, 8);
  const y = num2(date, 0) * 100 + num2(date, 2) - (m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = (((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) | 0) + d - 1;
  const doe = yoe * 365 + ((yoe / 4) | 0) - ((yoe / 100) | 0) + doy;
  return era * 146_097 + doe - 719_468;
}

const PAD2: readonly string[] = /* @__PURE__ */ (() => {
  const t: string[] = Array(32);
  for (let i = 0; i < 32; i++) t[i] = String(i).padStart(2, "0");
  return t;
})();

/** Hinnant civil_from_days; `days` must lie in [MIN_DAY, MAX_DAY]. */
function fromDays(days: number): ISODate {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = ((doe - ((doe / 1460) | 0) + ((doe / 36524) | 0) - ((doe / 146096) | 0)) / 365) | 0;
  const doy = doe - (365 * yoe + ((yoe / 4) | 0) - ((yoe / 100) | 0));
  const mp = ((5 * doy + 2) / 153) | 0;
  const d = doy - (((153 * mp + 2) / 5) | 0) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const ys = y >= 1000 ? String(y) : String(y).padStart(4, "0");
  return (ys + "-" + PAD2[m] + "-" + PAD2[d]) as ISODate;
}

function checkRange(days: number): number {
  if (!(days >= MIN_DAY && days <= MAX_DAY)) {
    throw new RangeError("ISODate out of range (0000-01-01 .. 9999-12-31)");
  }
  return days;
}

/**
 * The UTC calendar date of `date`. Throws RangeError for an invalid Date or a
 * year outside 0000–9999.
 */
export function fromDate(date: Date): ISODate {
  return fromDays(checkRange(Math.floor(date.getTime() / MS_PER_DAY)));
}

/** The current UTC calendar date. */
export function today(): ISODate {
  return fromDays(Math.floor(Date.now() / MS_PER_DAY));
}

/**
 * Adds `n` calendar days (negative `n` subtracts) with month, year and leap
 * rollover. Throws RangeError if `n` is not a safe integer or the result
 * leaves 0000–9999.
 */
export function addDays(date: ISODate, n: number): ISODate {
  if (!Number.isSafeInteger(n)) throw new RangeError(`addDays: n must be an integer, got ${n}`);
  return fromDays(checkRange(toDays(date) + n));
}

/** A Date at UTC midnight of `date`. */
export function toDate(date: ISODate): Date {
  return new Date(toDays(date) * MS_PER_DAY);
}

/** Returns a `Validator<ISODate>` that validates unknown values as ISO dates. */
export function validator(): Validator<ISODate> {
  return function validateISODate(value: unknown): Result<ISODate, ValidationError> {
    if (typeof value === "string" && isISODate(value)) return ok(value);
    return err(new ValidationError("ISO 8601 date string (YYYY-MM-DD)", value));
  };
}
