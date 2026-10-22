/**
 * UUID.v7 — internal: the Node implementation of `UUID.v7()` and its state.
 *
 * Not a public module: `package.json` blocks the `./UUID.v7` subpath, so
 * consumers cannot reach `resetV7State` (which would break v7 monotonicity).
 * `UUID.ts` re-exports the generator as `v7`; tests import this file directly
 * to reset the monotonic state after faking `Date.now()`.
 */

import { getRandomValues } from "node:crypto";

/** Hex lookup table for byte-to-hex conversion. */
const HEX: readonly string[] = /* @__PURE__ */ (() => {
  const table: string[] = Array(256);
  for (let i = 0; i < 256; i++) table[i] = (i + 0x100).toString(16).substring(1);
  return table;
})();

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
 * Forgets the last v7 timestamp so the next call reseeds from the current
 * clock. Lets tests that fake `Date.now()` restore real-clock behaviour.
 */
export function resetV7State(): void {
  lastMs = -1;
}

/** Monotonic v7 UUID string (layout documented on `UUID.v7`). */
export function v7Impl(): string {
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
  return (
    HEX[(ms / 0x10000000000) & 0xff] +
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
    HEX[pool[o + 9]]
  );
}
