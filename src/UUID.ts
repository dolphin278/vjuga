/**
 * UUID — branded string type for RFC 9562 Universally Unique Identifiers.
 *
 * Wraps a plain string with a compile-time brand so that UUIDs cannot be
 * confused with arbitrary strings. Provides validated construction, v4
 * (random) and v7 (timestamp-sortable) generation, and version extraction.
 *
 * When to use: any API or data layer that handles UUIDs as strings. The brand
 * prevents accidental misuse (passing a name where an ID is expected). For
 * internal opaque IDs where format does not matter, a plain string may suffice.
 *
 * Design tradeoffs: validation checks both structural format and RFC 4122
 * variant-1 bits (the first nibble of group 4 must be 8/9/a/b); the Nil
 * (all-zero) and Max (all-f) UUIDs are accepted as special cases. This is
 * stricter than schema `format: "uuid"` (`Formats.isUuid`), which accepts
 * any variant nibble, so a schema-valid value can still fail `uuid()`. Input
 * is lower-cased when branded so equal UUIDs always compare `===`. v7 is
 * monotonic per thread (module instance): consecutive `v7()` calls return
 * strictly increasing values, even within one millisecond or if the clock
 * steps back (RFC 9562 section 6.2, method 1: a 42-bit counter seeded
 * randomly each new millisecond, followed by 32 random bits). Separate
 * `worker_threads` have separate counters, so their ids may interleave.
 *
 * @example
 * ```ts
 * import { uuidExn, v4, v7, version } from "@dolphin278/vjuga/UUID";
 * const id = uuidExn("550e8400-e29b-41d4-a716-446655440000"); // validated
 * const random = v4();                                      // crypto.randomUUID()
 * const timeSorted = v7();                                  // monotonic, time-ordered
 * version(random); // 4
 * ```
 */

import { brandError, type Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";
import { randomUUID } from "node:crypto";
import { v7Impl } from "./UUID.v7.js";

/** The Nil UUID (RFC 9562 section 5.9). */
export const NIL = "00000000-0000-0000-0000-000000000000" as UUID;
/** The Max UUID (RFC 9562 section 5.10). */
export const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff" as UUID;

/** Branded string guaranteed to be a valid UUID. */
export type UUID = Branded<string, "UUID">;

declare const Bun: { randomUUIDv7: () => string } | undefined;

/**
 * Why a string is not a `UUID`: not 8-4-4-4-12 hex digits (`"malformed"`),
 * or the right shape with a variant nibble (first digit of group 4) outside
 * 8/9/a/b and not Nil/Max (`"invalid-variant"`).
 */
export type UUIDError = "malformed" | "invalid-variant";

/** Canonical (lower-case) form with variant-1 bits: what the brand holds. */
const UUID_LOWER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Shape only, any case and variant: tells "malformed" from "invalid-variant". */
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard: `value` is a UUID in canonical form: lower-case hex, variant-1 bits,
 * or Nil / Max. Never normalises, so an upper-case UUID is refused here even
 * though `uuid()` accepts it (and lower-cases it). Accepts `unknown`.
 *
 * @example
 * ```ts
 * import { isUUID } from "@dolphin278/vjuga/UUID";
 * isUUID("550e8400-e29b-41d4-a716-446655440000"); // true
 * isUUID("550E8400-E29B-41D4-A716-446655440000"); // false: not canonical
 * ```
 */
export function isUUID(value: unknown): value is UUID {
  return typeof value === "string" && (UUID_LOWER_RE.test(value) || value === NIL || value === MAX);
}

/** The rule a lower-cased string that is not a UUID breaks. */
function uuidError(lower: string): UUIDError {
  return UUID_SHAPE_RE.test(lower) ? "invalid-variant" : "malformed";
}

/**
 * Result constructor: `value` lower-cased as a UUID, or the rule it breaks.
 * Accepts any UUID version with variant-1 bits, plus Nil and Max, in any
 * case; the branded value is always lower-case, so equal UUIDs compare `===`.
 *
 * @example
 * ```ts
 * import { uuid } from "@dolphin278/vjuga/UUID";
 * uuid("550E8400-E29B-41D4-A716-446655440000"); // [true, "550e8400-e29b-41d4-a716-446655440000"]
 * uuid("550e8400-e29b-41d4-c716-446655440000"); // [false, "invalid-variant"]
 * ```
 */
export function uuid(value: string): Result<UUID, UUIDError> {
  const lower = value.toLowerCase();
  return isUUID(lower) ? ok(lower) : err(uuidError(lower));
}

/**
 * Throwing constructor: like `uuid`, but returns the UUID or throws a
 * RangeError whose `cause` is the `UUIDError` literal.
 *
 * @example
 * ```ts
 * import { uuidExn } from "@dolphin278/vjuga/UUID";
 * const id = uuidExn("550e8400-e29b-41d4-a716-446655440000");
 * ```
 */
export function uuidExn(value: string): UUID {
  const lower = value.toLowerCase();
  if (!isUUID(lower)) throw brandError("UUID", uuidError(lower), value);
  return lower;
}

/**
 * Assertion: TypeError for a non-string, RangeError for any other value that
 * `isUUID` refuses. Its `cause` is `"malformed"`, `"invalid-variant"`, or
 * `"not-lowercase"` for a valid UUID that is not in canonical form.
 *
 * @example
 * ```ts
 * import { assertUUID } from "@dolphin278/vjuga/UUID";
 * const v: unknown = "00000000-0000-0000-0000-000000000000";
 * assertUUID(v); // v: UUID from here on
 * ```
 */
export function assertUUID(value: unknown): asserts value is UUID {
  if (!isUUID(value)) {
    let code: string | undefined;
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      code = isUUID(lower) ? "not-lowercase" : uuidError(lower);
    }
    throw brandError("UUID", code, value);
  }
}

/** Generates a random v4 UUID using `crypto.randomUUID()`. */
export function v4(): UUID {
  return randomUUID() as UUID;
}

/**
 * Generates a v7 UUID (timestamp-sortable) per RFC 9562.
 *
 * Layout (128 bits, Node implementation):
 *   48-bit ms timestamp | 4-bit version (0111) | 12-bit counter (high) |
 *   2-bit variant (10)  | 30-bit counter (low) | 32-bit random
 *
 * Monotonic per thread (each Worker loads its own copy of this module): each
 * value is strictly greater (as a string and as a 128-bit number) than the
 * previous one from the same thread. The counter is reseeded
 * randomly each new millisecond and incremented within one; if the clock
 * steps back, the last timestamp is reused and the counter keeps counting.
 * Random bits come from a 4 KiB pool refilled via `crypto.getRandomValues`.
 * Delegates to `Bun.randomUUIDv7` when running under Bun (also monotonic in
 * a thread, but its 12-bit counter allows 4096 ids per millisecond and then
 * runs the timestamp ahead of the clock); falls back to the manual
 * implementation otherwise.
 */
// Bun path is exercised by `npm run test:bun`; Node tests always take v7Impl
// (internal module `UUID.v7`, blocked in package exports).
/* node:coverage ignore next 4 */
export const v7: () => UUID =
  typeof Bun !== "undefined" && typeof Bun.randomUUIDv7 === "function"
    ? () => Bun.randomUUIDv7() as UUID
    : (v7Impl as () => UUID);

/** Extracts the version number (4-bit nibble at position 12) from a UUID. */
export function version(id: UUID): number {
  return parseInt(id[14], 16);
}

/** Returns a `Validator<UUID>` that validates unknown values as UUIDs. */
export function validator(): Validator<UUID> {
  return function validateUUID(value: unknown): Result<UUID, ValidationError> {
    if (typeof value !== "string") return err(new ValidationError("UUID", value));
    const lower = value.toLowerCase();
    if (isUUID(lower)) return ok(lower);
    return err(new ValidationError("UUID", value));
  };
}
