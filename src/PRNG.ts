/**
 * PRNG — deterministic, splittable pseudo-random number generator based on
 * SplitMix64.
 *
 * When to use: property-based testing, deterministic shuffling, sampling, or
 * any scenario requiring reproducible random sequences with independent
 * sub-streams. For cryptographic randomness, use `crypto.getRandomValues`
 * instead.
 *
 * Internal design:
 *   kHi: number — upper 32 bits of the 64-bit SplitMix64 state (uint32).
 *   kLo: number — lower 32 bits of the state (uint32); both advance per draw.
 *
 * Design tradeoffs: SplitMix64 chosen over xoshiro256** because it has a
 * natural `split()` operation for independent sub-streams — exactly what PBT
 * needs. The 64-bit state lives in two uint32 Number fields and is mixed with
 * 16-bit-limb multiplication plus `Math.imul`, because BigInt arithmetic
 * allocates on every operation and stays out of the JIT's integer tiers: a
 * BigInt state cost ~2.5–3× per draw, and property tests run millions of
 * draws. Outputs are bit-identical to the reference BigInt SplitMix64, so
 * seeds and replay paths are stable. BigInt appears only at the edges
 * (`seed`, `nextBigInt`, ranges above 2^36 in `nextInt`).
 *
 * Prior art: Java's SplittableRandom (Steele, Lea, Flood 2014).
 *
 * @example
 * ```ts
 * import { seed, make, next, nextInt, split } from "@dolphin278/vjuga/PRNG";
 * const rng = make(seed(42n));
 * const f = next(rng);         // [0, 1) float64
 * const i = nextInt(rng, 1, 6); // 1–6 inclusive
 * const fork = split(rng);     // independent sub-stream
 * ```
 */

import { type Branded, brand } from "./FunctionUtils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Branded seed value for PRNG construction. */
export type Seed = Branded<bigint, "Seed">;

const kHi: unique symbol = Symbol("hi");
const kLo: unique symbol = Symbol("lo");

/** Mutable PRNG state: the 64-bit SplitMix64 state as two uint32 symbol fields. */
export interface PRNG {
  [kHi]: number;
  [kLo]: number;
}

// ---------------------------------------------------------------------------
// Constants (64-bit constants split into uint32 halves)
// ---------------------------------------------------------------------------

/** 64-bit mask — truncates bigint seeds to unsigned 64-bit range. */
const MASK64 = 0xffff_ffff_ffff_ffffn;

/** SplitMix64 golden-ratio increment 0x9e3779b97f4a7c15. */
const GOLDEN_HI = 0x9e37_79b9;
const GOLDEN_LO = 0x7f4a_7c15;

/** Stafford variant 13 — first mixing constant 0xbf58476d1ce4e5b9. */
const MIX_A_HI = 0xbf58_476d;
const MIX_A_LO = 0x1ce4_e5b9;

/** Stafford variant 13 — second mixing constant 0x94d049bb133111eb. */
const MIX_B_HI = 0x94d0_49bb;
const MIX_B_LO = 0x1331_11eb;

/** Increment 0x6a09e667f3bcc908 used by split to derive a divergent sub-stream. */
const SPLIT_HI = 0x6a09_e667;
const SPLIT_LO = 0xf3bc_c908;

/** 2^32 — weight of the high half. */
const TWO_32 = 0x1_0000_0000;

/** Largest range reduced in one step: (hi mod r)·2^32 + lo < 2^20·2^32 = 2^52. */
const ONE_STEP_RANGE = 0x10_0000;

/** Largest range reduced with 16-bit Horner steps: (r - 1)·2^16 + 0xffff < 2^52. */
const HORNER_RANGE = 0x10_0000_0000;

// ---------------------------------------------------------------------------
// Internal mixing
// ---------------------------------------------------------------------------

// Results of mul64 / mix64 / advance. Module-scope scratch instead of a
// returned [hi, lo] pair: the pair would allocate on every draw (escape
// analysis does not reliably remove it across non-inlined calls), and every
// caller reads the halves immediately, so there is no reentrancy.
let outHi = 0;
let outLo = 0;

/**
 * Low 64 bits of a 64×64 product into outHi/outLo. The lo×lo partial product
 * is formed from 16-bit limbs so every intermediate stays below 2^53 (exact
 * in a double); the cross terms only contribute to the high word mod 2^32,
 * which is exactly what `Math.imul` computes.
 */
function mul64(aHi: number, aLo: number, bHi: number, bLo: number): void {
  const a0 = aLo & 0xffff;
  const a1 = aLo >>> 16;
  const b0 = bLo & 0xffff;
  const b1 = bLo >>> 16;
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  outLo = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  outHi =
    (a1 * b1 +
      (p01 >>> 16) +
      (p10 >>> 16) +
      (mid >>> 16) +
      Math.imul(aHi, bLo) +
      Math.imul(aLo, bHi)) >>>
    0;
}

/**
 * Stafford variant 13 finalizer — bijective 64-bit → 64-bit mix.
 * Produces an avalanche-quality hash of the raw state into outHi/outLo.
 */
function mix64(hi: number, lo: number): void {
  // z = (z ^ (z >> 30)) * MIX_A
  mul64((hi ^ (hi >>> 30)) >>> 0, (lo ^ ((lo >>> 30) | (hi << 2))) >>> 0, MIX_A_HI, MIX_A_LO);
  hi = outHi;
  lo = outLo;
  // z = (z ^ (z >> 27)) * MIX_B
  mul64((hi ^ (hi >>> 27)) >>> 0, (lo ^ ((lo >>> 27) | (hi << 5))) >>> 0, MIX_B_HI, MIX_B_LO);
  hi = outHi;
  lo = outLo;
  // z ^ (z >> 31)
  outLo = (lo ^ ((lo >>> 31) | (hi << 1))) >>> 0;
  outHi = (hi ^ (hi >>> 31)) >>> 0;
}

/** Advances the state by one step; the mixed output lands in outHi/outLo. */
function advance(prng: PRNG): void {
  const lo = prng[kLo] + GOLDEN_LO;
  const hi = (prng[kHi] + GOLDEN_HI + (lo >= TWO_32 ? 1 : 0)) >>> 0;
  prng[kHi] = hi;
  prng[kLo] = lo >>> 0;
  mix64(hi, lo >>> 0);
}

/** Builds a PRNG object; the single construction site keeps one hidden class. */
function create(hi: number, lo: number): PRNG {
  const prng: PRNG = { [kHi]: hi, [kLo]: lo };
  // Write both fields a second time so V8 tracks them as mutable from the
  // first make(): advance() rewrites them on every draw, and a field V8
  // assumed constant would deoptimize every compiled draw function on the
  // first mutation.
  prng[kHi] = hi;
  prng[kLo] = lo;
  return prng;
}

/**
 * `x mod r` for integers 0 <= x < 2^52, 0 < r <= 2^36, without the double
 * `%` operator: V8 lowers a non-int32 `%` to a C `fmod` call whose cost grows
 * with the exponent gap (~100 ns for x near 2^52 on node 26), while
 * divide/floor/multiply is a few ns. `fl(x / r)` is within 1 of the exact
 * quotient Q (relative error 2^-53, Q < 2^52), and floor of it is floor(Q) or
 * floor(Q) + 1, so one `m < 0` correction makes the result exact; `q * r`
 * <= x + r < 2^53 is exact too.
 */
function modSmall(x: number, r: number): number {
  const m = x - Math.floor(x / r) * r;
  return m < 0 ? m + r : m;
}

/** The mixed output of the last draw as an unsigned 64-bit bigint. */
function outBigInt(): bigint {
  return (BigInt(outHi) << 32n) | BigInt(outLo);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Wraps a raw bigint as a branded Seed. */
export function seed(n: bigint): Seed {
  return brand<bigint, "Seed">(n & MASK64);
}

/** Creates a new PRNG from a branded seed. */
export function make(s: Seed): PRNG {
  // asUintN mirrors 64-bit masking of the state, so even an unmasked or
  // negative bigint cast to Seed lands on the same stream as seed(n).
  const v = s as bigint;
  return create(Number(BigInt.asUintN(32, v >> 32n)), Number(BigInt.asUintN(32, v)));
}

/** Returns the next value as a float64 in [0, 1). */
export function next(prng: PRNG): number {
  advance(prng);
  // Upper 53 bits of the output for the double mantissa: hi·2^21 + (lo >>> 11).
  return (outHi * 0x20_0000 + (outLo >>> 11)) / 0x20_0000_0000_0000;
}

/**
 * Returns the next value as an integer in [min, max] (inclusive), computed as
 * the 64-bit output modulo the range. `min` and `max` must be integers;
 * results are exact while both are safe integers (`max - min` below 2^53).
 * Wider ranges are reduced exactly in BigInt, but `min + offset` then rounds
 * like any double above 2^53. Returns `min` when `max <= min`. Throws
 * `RangeError` when `max - min + 1` is not an integer (fractional or
 * non-finite bounds).
 */
export function nextInt(prng: PRNG, min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 1) return min;
  if (!Number.isInteger(range)) {
    throw new RangeError(`nextInt: bounds must be integers (got ${min}, ${max})`);
  }
  // Uniform distribution via modulo of mixed 64-bit output.
  // Modulo bias is negligible for ranges << 2^64.
  advance(prng);
  // (hi·2^32 + lo) mod range, reduced in doubles while every intermediate
  // stays below 2^52 — BigInt only for ranges above 2^36.
  if (range <= ONE_STEP_RANGE) {
    return min + modSmall(modSmall(outHi, range) * TWO_32 + outLo, range);
  }
  if (range <= HORNER_RANGE) {
    const m = modSmall(modSmall(outHi, range) * 0x1_0000 + (outLo >>> 16), range);
    return min + modSmall(m * 0x1_0000 + (outLo & 0xffff), range);
  }
  // Above 2^53 the double `range` may have rounded; rebuild it exactly.
  const big = range <= Number.MAX_SAFE_INTEGER ? BigInt(range) : BigInt(max) - BigInt(min) + 1n;
  return min + Number(outBigInt() % big);
}

/** Returns the raw mixed 64-bit output as a bigint. */
export function nextBigInt(prng: PRNG): bigint {
  advance(prng);
  return outBigInt();
}

/**
 * Creates an independent sub-stream by deriving a new state from the current
 * one using a different mixing constant, then advancing the original.
 * Both the original and the fork diverge after this call.
 */
export function split(prng: PRNG): PRNG {
  const lo = prng[kLo];
  const hi = prng[kHi];
  const dLo = lo + SPLIT_LO;
  const dHi = (hi + SPLIT_HI + (dLo >= TWO_32 ? 1 : 0)) >>> 0;
  const nLo = lo + GOLDEN_LO;
  prng[kHi] = (hi + GOLDEN_HI + (nLo >= TWO_32 ? 1 : 0)) >>> 0;
  prng[kLo] = nLo >>> 0;
  mix64(dHi, dLo >>> 0);
  return create(outHi, outLo);
}

/**
 * Creates a Seed from a random source (crypto.getRandomValues).
 * Use when you don't need a fixed seed for reproducibility.
 */
export function randomSeed(): Seed {
  const buf = new BigUint64Array(1);
  crypto.getRandomValues(buf);
  return brand<bigint, "Seed">(buf[0]!);
}
