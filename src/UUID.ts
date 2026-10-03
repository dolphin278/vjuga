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
 * monotonic within a process on Node and Bun: consecutive `v7()` values are
 * strictly increasing, even within one millisecond or if the clock steps
 * back (RFC 9562 section 6.2, method 1: a 42-bit counter seeded randomly
 * each new millisecond, followed by 32 random bits).
 *
 * @example
 * ```ts
 * import { uuid, v4, v7, version } from "@dolphin278/vjuga/UUID";
 * const id = uuid("550e8400-e29b-41d4-a716-446655440000"); // validated
 * const random = v4();                                      // crypto.randomUUID()
 * const timeSorted = v7();                                  // monotonic, time-ordered
 * version(random); // 4
 * ```
 */

import type { Branded } from "./FunctionUtils.js";
import { type Result, ok, err } from "./Result.js";
import { ValidationError, type Validator } from "./schema/ValidationError.js";
import { randomUUID, getRandomValues } from "node:crypto";

/** The Nil UUID (RFC 9562 section 5.9). */
export const NIL = "00000000-0000-0000-0000-000000000000" as UUID;
/** The Max UUID (RFC 9562 section 5.10). */
export const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff" as UUID;

/** Branded string guaranteed to be a valid UUID. */
export type UUID = Branded<string, "UUID">;

declare const Bun: { randomUUIDv7: () => string } | undefined;

/**
 * RFC 4122 structural regex with variant-1 constraint.
 * 8-4-4-4-12 hex groups, group 4 starts with 8/9/a/b.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hex lookup table for byte-to-hex conversion. */
const HEX: readonly string[] = /* @__PURE__ */ (() => {
  const table: string[] = Array(256);
  for (let i = 0; i < 256; i++) table[i] = (i + 0x100).toString(16).substring(1);
  return table;
})();

/**
 * Validates and brands a string as a UUID.
 * Accepts any UUID version with variant-1 bits, plus Nil and Max. Case-insensitive
 * on input; the returned brand is always lower-case.
 * Throws RangeError if the string is not a valid UUID.
 */
export function uuid(value: string): UUID {
  const id = normalize(value);
  if (id === undefined) throw new RangeError(`Expected UUID, got "${value}"`);
  return id;
}

function normalize(value: string): UUID | undefined {
  const lower = value.toLowerCase();
  if (UUID_RE.test(lower) || lower === NIL || lower === MAX) return lower as UUID;
  return undefined;
}

/** Generates a random v4 UUID using `crypto.randomUUID()`. */
export function v4(): UUID {
  return randomUUID() as UUID;
}

// Pooled random bytes: one getRandomValues syscall-ish call per POOL_SIZE / 10
// UUIDs instead of one per UUID (the dominant cost of v7).
const POOL_SIZE = 4096;
const RANDOM_BYTES = 10; // 6 counter-seed bytes + 4 tail bytes per v7 UUID
const pool = new Uint8Array(POOL_SIZE);
let poolPos = POOL_SIZE;

// Monotonic state (RFC 9562 section 6.2, method 1). `counter` is a 42-bit
// integer held in a double (exact below 2^53, and a plain `c++` needs no carry
// branch): its high 12 bits fill `rand_a`, its low 30 bits the top of
// `rand_b` after the variant. It is reseeded with 41 random bits (top bit
// clear) whenever the clock passes `lastMs`, leaving >= 2^41 increments of
// headroom before it could overflow — unreachable while the clock stalls.
// A clock that steps back keeps `lastMs` and keeps counting, so output never
// goes backwards.
let lastMs = -1;
let counter = 0;

/**
 * Forgets the last v7 timestamp so the next `v7()` reseeds from the current
 * clock. Lets tests that fake `Date.now()` restore real-clock behaviour.
 *
 * @internal Exported for testing only — not part of the public API contract.
 */
export function resetV7State(): void {
  lastMs = -1;
}

function _v7Impl(): UUID {
  const now = Date.now();
  if (poolPos + RANDOM_BYTES > POOL_SIZE) {
    getRandomValues(pool);
    poolPos = 0;
  }
  const o = poolPos;
  poolPos += RANDOM_BYTES;

  if (now > lastMs) {
    lastMs = now;
    // 11 + 30 random bits; the 42nd (top) bit starts clear.
    counter =
      (((pool[o] & 0x07) << 8) | pool[o + 1]) * 0x40000000 +
      (((pool[o + 2] & 0x3f) << 24) | (pool[o + 3] << 16) | (pool[o + 4] << 8) | pool[o + 5]);
  } else {
    counter++;
  }
  const ms = lastMs;
  const hi = (counter / 0x40000000) & 0xfff; // counter bits 41..30 -> rand_a
  const lo = counter & 0x3fffffff; // ToInt32 keeps the low 32 bits exactly

  // 48-bit timestamp (big-endian) in bytes 0-5. Version 7: high nibble of
  // byte 6 = 0111; variant 1: high 2 bits of byte 8 = 10. Bytes 6-11 carry the
  // counter, bytes 12-15 are random.
  return (HEX[(ms / 0x10000000000) & 0xff] +
    HEX[(ms / 0x100000000) & 0xff] +
    HEX[(ms / 0x1000000) & 0xff] +
    HEX[(ms / 0x10000) & 0xff] +
    "-" +
    HEX[(ms / 0x100) & 0xff] +
    HEX[ms & 0xff] +
    "-" +
    HEX[0x70 | (hi >>> 8)] +
    HEX[hi & 0xff] +
    "-" +
    HEX[0x80 | (lo >>> 24)] +
    HEX[(lo >>> 16) & 0xff] +
    "-" +
    HEX[(lo >>> 8) & 0xff] +
    HEX[lo & 0xff] +
    HEX[pool[o + 6]] +
    HEX[pool[o + 7]] +
    HEX[pool[o + 8]] +
    HEX[pool[o + 9]]) as UUID;
}

/**
 * Generates a v7 UUID (timestamp-sortable) per RFC 9562.
 *
 * Layout (128 bits, Node implementation):
 *   48-bit ms timestamp | 4-bit version (0111) | 12-bit counter (high) |
 *   2-bit variant (10)  | 30-bit counter (low) | 32-bit random
 *
 * Monotonic within the process: each value is strictly greater (as a string
 * and as a 128-bit number) than the previous one. The counter is reseeded
 * randomly each new millisecond and incremented within one; if the clock
 * steps back, the last timestamp is reused and the counter keeps counting.
 * Random bits come from a 4 KiB pool refilled via `crypto.getRandomValues`.
 * Delegates to `Bun.randomUUIDv7` (also monotonic) when running under Bun;
 * falls back to the manual implementation otherwise.
 */
// Bun path is exercised by `npm run test:bun`; Node tests always take _v7Impl.
/* node:coverage ignore next 4 */
export const v7: () => UUID =
  typeof Bun !== "undefined" && typeof Bun.randomUUIDv7 === "function"
    ? () => Bun.randomUUIDv7() as UUID
    : _v7Impl;

/** Extracts the version number (4-bit nibble at position 12) from a UUID. */
export function version(id: UUID): number {
  return parseInt(id[14], 16);
}

/** Returns a `Validator<UUID>` that validates unknown values as UUIDs. */
export function validator(): Validator<UUID> {
  return function validateUUID(value: unknown): Result<UUID, ValidationError> {
    if (typeof value !== "string") return err(new ValidationError("UUID", value));
    const id = normalize(value);
    if (id === undefined) return err(new ValidationError("UUID", value));
    return ok(id);
  };
}
