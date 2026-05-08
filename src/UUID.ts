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
 * variant-1 bits (the first nibble of group 4 must be 8/9/a/b). v7 generation
 * uses random sub-millisecond fill rather than a monotonic counter — two UUIDs
 * generated within the same millisecond are not guaranteed to be ordered, but
 * are unique with overwhelming probability.
 *
 * @example
 * ```ts
 * import { uuid, v4, v7, version } from "vjuga/UUID";
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
 * Accepts any UUID version with variant-1 bits. Case-insensitive.
 * Throws RangeError if the string is not a valid UUID.
 */
export function uuid(value: string): UUID {
  if (!UUID_RE.test(value)) throw new RangeError(`Expected UUID, got "${value}"`);
  return value as UUID;
}

/** Generates a random v4 UUID using `crypto.randomUUID()`. */
export function v4(): UUID {
  return randomUUID() as UUID;
}

/**
 * Generates a v7 UUID (timestamp-sortable) per RFC 9562.
 *
 * Layout (128 bits):
 *   48-bit ms timestamp | 4-bit version (0111) | 12-bit random |
 *   2-bit variant (10)  | 62-bit random
 */
function _v7Impl(): UUID {
  const ms = Date.now();
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);

  // 48-bit timestamp (big-endian) in bytes 0–5
  bytes[0] = (ms / 0x10000000000) & 0xff;
  bytes[1] = (ms / 0x100000000) & 0xff;
  bytes[2] = (ms / 0x1000000) & 0xff;
  bytes[3] = (ms / 0x10000) & 0xff;
  bytes[4] = (ms / 0x100) & 0xff;
  bytes[5] = ms & 0xff;

  // Version 7: high nibble of byte 6 = 0111
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // Variant 1: high 2 bits of byte 8 = 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return (HEX[bytes[0]] +
    HEX[bytes[1]] +
    HEX[bytes[2]] +
    HEX[bytes[3]] +
    "-" +
    HEX[bytes[4]] +
    HEX[bytes[5]] +
    "-" +
    HEX[bytes[6]] +
    HEX[bytes[7]] +
    "-" +
    HEX[bytes[8]] +
    HEX[bytes[9]] +
    "-" +
    HEX[bytes[10]] +
    HEX[bytes[11]] +
    HEX[bytes[12]] +
    HEX[bytes[13]] +
    HEX[bytes[14]] +
    HEX[bytes[15]]) as UUID;
}

// Bun path is exercised by `npm run test:bun`; Node tests always take _v7Impl.
/* node:coverage ignore next 2 */
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
    if (!UUID_RE.test(value)) return err(new ValidationError("UUID", value));
    return ok(value as UUID);
  };
}
