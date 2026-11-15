/**
 * Text — branded strings for text that must not be empty or blank.
 *
 * `NonEmptyString` has at least one UTF-16 code unit. `NonBlank` starts and
 * ends with a non-whitespace character: not empty and already trimmed
 * (`/^\S(?:[\s\S]*\S)?$/`; anything, line breaks included, may sit between).
 * A `NonBlank` is also a `NonEmptyString`.
 *
 * Each type has the standard four functions: a Result constructor
 * (`nonBlank`), a throwing one (`nonBlankExn`), a guard (`isNonBlank`) and an
 * assertion (`assertNonBlank`). Guards and assertions check and never repair,
 * so a stored value that was never trimmed is caught, not hidden; `nonBlank`
 * and `nonBlankExn` are the normalising constructors (they trim first).
 *
 * When to use: names, titles, labels, messages: text your program writes or
 * accepts from a person and must not be empty or padded. Two strings that
 * differ only by surrounding whitespace become one value.
 *
 * Design tradeoffs: `isNonBlank` reads only the first and last code units
 * (O(1), no regex). Whitespace is exactly what `\s` and `String.prototype.trim`
 * use (ECMAScript WhiteSpace + LineTerminator, all in the BMP), so a lone
 * surrogate counts as non-whitespace, as it does for `\S`.
 *
 * @example
 * ```ts
 * import { nonBlank, isNonBlank, type NonBlank } from "@dolphin278/vjuga/Text";
 * nonBlank("  The bridge reopens. "); // [true, "The bridge reopens."]
 * nonBlank("   ");                    // [false, "blank"]
 * isNonBlank(" padded");              // false: guards never trim
 * ```
 */

import { brandError, type Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";

/** A string with at least one UTF-16 code unit. */
export type NonEmptyString = Branded<string, "NonEmptyString">;

/** A string that starts and ends with a non-whitespace character. */
export type NonBlank = Branded<NonEmptyString, "NonBlank">;

/** Why a string is not a `NonEmptyString`. */
export type NonEmptyStringError = "empty";

/** Why a string is not a `NonBlank` once trimmed: nothing but whitespace was left. */
export type NonBlankError = "blank";

/**
 * Guard: `value` is a string of length >= 1. Accepts `unknown`.
 *
 * @example
 * ```ts
 * import { isNonEmptyString } from "@dolphin278/vjuga/Text";
 * isNonEmptyString(" "); // true
 * isNonEmptyString("");  // false
 * ```
 */
export function isNonEmptyString(value: unknown): value is NonEmptyString {
  return typeof value === "string" && value.length > 0;
}

/**
 * Result constructor for `NonEmptyString`. Never normalises.
 *
 * @example
 * ```ts
 * import { nonEmptyString } from "@dolphin278/vjuga/Text";
 * nonEmptyString("a"); // [true, "a"]
 * nonEmptyString("");  // [false, "empty"]
 * ```
 */
export function nonEmptyString(value: string): Result<NonEmptyString, NonEmptyStringError> {
  return isNonEmptyString(value) ? ok(value) : err("empty");
}

/**
 * Throwing constructor for `NonEmptyString`: RangeError with `cause` `"empty"`.
 *
 * @example
 * ```ts
 * import { nonEmptyStringExn } from "@dolphin278/vjuga/Text";
 * const s = nonEmptyStringExn("a"); // NonEmptyString
 * ```
 */
export function nonEmptyStringExn(value: string): NonEmptyString {
  if (!isNonEmptyString(value)) throw brandError("NonEmptyString", "empty", value);
  return value;
}

/**
 * Assertion for `NonEmptyString`: TypeError for a non-string, RangeError
 * (`cause` `"empty"`) for `""`.
 *
 * @example
 * ```ts
 * import { assertNonEmptyString } from "@dolphin278/vjuga/Text";
 * const v: unknown = "x";
 * assertNonEmptyString(v); // v: NonEmptyString from here on
 * ```
 */
export function assertNonEmptyString(value: unknown): asserts value is NonEmptyString {
  if (!isNonEmptyString(value)) {
    throw brandError("NonEmptyString", typeof value === "string" ? "empty" : undefined, value);
  }
}

/**
 * ECMAScript WhiteSpace or LineTerminator, the set `\s` and `trim()` share:
 * U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F,
 * U+205F, U+3000, U+FEFF. ASCII is tested first: it is the common case.
 */
function isSpace(c: number): boolean {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 160) return false;
  return (
    c === 160 ||
    c === 5760 ||
    (c >= 8192 && c <= 8202) ||
    c === 8232 ||
    c === 8233 ||
    c === 8239 ||
    c === 8287 ||
    c === 12288 ||
    c === 65279
  );
}

/**
 * Guard: `value` is a string that starts and ends with a non-whitespace
 * character. Checks, never trims. Accepts `unknown`.
 *
 * @example
 * ```ts
 * import { isNonBlank } from "@dolphin278/vjuga/Text";
 * isNonBlank("a b");  // true
 * isNonBlank("a ");   // false: not trimmed
 * isNonBlank("");     // false
 * ```
 */
export function isNonBlank(value: unknown): value is NonBlank {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !isSpace(value.charCodeAt(0)) &&
    !isSpace(value.charCodeAt(value.length - 1))
  );
}

/**
 * Result constructor for `NonBlank`: trims `raw` (`String.prototype.trim`),
 * then checks. Use it on text as a person or a program wrote it; use
 * `isNonBlank` on text that should already be in its final form.
 *
 * @example
 * ```ts
 * import { nonBlank } from "@dolphin278/vjuga/Text";
 * nonBlank(" a\n"); // [true, "a"]
 * nonBlank("\t");   // [false, "blank"]
 * ```
 */
export function nonBlank(raw: string): Result<NonBlank, NonBlankError> {
  // Already-trimmed input (the common case) skips `trim()`.
  if (isNonBlank(raw)) return ok(raw);
  const trimmed = raw.trim();
  return isNonBlank(trimmed) ? ok(trimmed) : err("blank");
}

/**
 * Throwing constructor for `NonBlank`: trims, then returns the value or
 * throws a RangeError with `cause` `"blank"`.
 *
 * @example
 * ```ts
 * import { nonBlankExn } from "@dolphin278/vjuga/Text";
 * nonBlankExn("  title "); // "title" as NonBlank
 * ```
 */
export function nonBlankExn(raw: string): NonBlank {
  if (isNonBlank(raw)) return raw;
  const trimmed = raw.trim();
  if (!isNonBlank(trimmed)) throw brandError("NonBlank", "blank", raw);
  return trimmed;
}

/**
 * Assertion for `NonBlank`; never trims. TypeError for a non-string,
 * RangeError otherwise with `cause` `"empty"` for `""` or `"untrimmed"` for
 * a string with whitespace at either end (all-whitespace included).
 *
 * @example
 * ```ts
 * import { assertNonBlank } from "@dolphin278/vjuga/Text";
 * const v: unknown = "ok";
 * assertNonBlank(v); // v: NonBlank from here on
 * ```
 */
export function assertNonBlank(value: unknown): asserts value is NonBlank {
  if (!isNonBlank(value)) {
    let code: string | undefined;
    if (typeof value === "string") code = value.length === 0 ? "empty" : "untrimmed";
    throw brandError("NonBlank", code, value);
  }
}
