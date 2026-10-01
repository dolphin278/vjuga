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
 * (all-zero) and Max (all-f) UUIDs are accepted as special cases. Input is
 * lower-cased when branded so equal UUIDs always compare `===`. v7 generation
 * uses random sub-millisecond fill rather than a monotonic counter — two UUIDs
 * generated within the same millisecond are not guaranteed to be ordered, but
 * are unique with overwhelming probability.
 *
 * @example
 * ```ts
 * import { uuid, v4, v7, version } from "@dolphin278/vjuga/UUID";
 * const id = uuid("550e8400-e29b-41d4-a716-446655440000"); // validated
 * const random = v4();                                      // crypto.randomUUID()
 * const timeSorted = v7();                                  // timestamp-sortable
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
const RANDOM_BYTES = 10; // bytes 6..15 of a v7 UUID
const pool = new Uint8Array(POOL_SIZE);
let poolPos = POOL_SIZE;

function _v7Impl(): UUID {
  const ms = Date.now();
  if (poolPos + RANDOM_BYTES > POOL_SIZE) {
    getRandomValues(pool);
    poolPos = 0;
  }
  const o = poolPos;
  poolPos += RANDOM_BYTES;

  // Version 7: high nibble of byte 6 = 0111; variant 1: high 2 bits of byte 8 = 10
  const b6 = (pool[o] & 0x0f) | 0x70;
  const b8 = (pool[o + 2] & 0x3f) | 0x80;

  // 48-bit timestamp (big-endian) in bytes 0-5, random in 6-15
  return (HEX[(ms / 0x10000000000) & 0xff] +
    HEX[(ms / 0x100000000) & 0xff] +
    HEX[(ms / 0x1000000) & 0xff] +
    HEX[(ms / 0x10000) & 0xff] +
    "-" +
    HEX[(ms / 0x100) & 0xff] +
    HEX[ms & 0xff] +
    "-" +
    HEX[b6] +
    HEX[pool[o + 1]] +
    "-" +
    HEX[b8] +
    HEX[pool[o + 3]] +
    "-" +
    HEX[pool[o + 4]] +
    HEX[pool[o + 5]] +
    HEX[pool[o + 6]] +
    HEX[pool[o + 7]] +
    HEX[pool[o + 8]] +
    HEX[pool[o + 9]]) as UUID;
}

/**
 * Generates a v7 UUID (timestamp-sortable) per RFC 9562.
 *
 * Layout (128 bits):
 *   48-bit ms timestamp | 4-bit version (0111) | 12-bit random |
 *   2-bit variant (10)  | 62-bit random
 *
 * Random bits come from a 4 KiB pool refilled via `crypto.getRandomValues`.
 * Delegates to `Bun.randomUUIDv7` when running under Bun; falls back to a
 * manual implementation otherwise.
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
