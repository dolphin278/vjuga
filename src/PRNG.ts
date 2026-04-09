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
 *   kState: bigint — 64-bit SplitMix64 state, advanced on every draw.
 *
 * Design tradeoffs: SplitMix64 chosen over xoshiro256** because it has a
 * natural `split()` operation for independent sub-streams — exactly what PBT
 * needs. BigInt arithmetic is not as JIT-friendly as Number ops, but at
 * 100–10 000 calls per property check the difference is negligible. The
 * alternative (two Uint32 fields + manual carry) adds complexity for zero
 * user-visible benefit.
 *
 * Prior art: Java's SplittableRandom (Steele, Lea, Flood 2014).
 *
 * @example
 * ```ts
 * import { seed, make, next, nextInt, split } from "vjuga/PRNG.js";
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

const kState: unique symbol = Symbol("state");

/** Mutable PRNG state. The symbol field holds the 64-bit SplitMix64 state. */
export interface PRNG {
  [kState]: bigint;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 64-bit mask — truncates bigint to unsigned 64-bit range. */
const MASK64 = 0xffff_ffff_ffff_ffffn;

/** SplitMix64 golden-ratio increment. */
const GOLDEN = 0x9e37_79b9_7f4a_7c15n;

/** Stafford variant 13 — first mixing constant. */
const MIX_A = 0xbf58_476d_1ce4_e5b9n;

/** Stafford variant 13 — second mixing constant. */
const MIX_B = 0x94d0_49bb_1331_11ebn;

/** Alternative increment used by split to derive a divergent sub-stream. */
const SPLIT_MIX = 0x6a09_e667_f3bc_c908n;

// ---------------------------------------------------------------------------
// Internal mixing
// ---------------------------------------------------------------------------

/**
 * Stafford variant 13 finalizer — bijective 64-bit → 64-bit mix.
 * Produces an avalanche-quality hash of the raw state.
 */
function mix64(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * MIX_A) & MASK64;
  z = ((z ^ (z >> 27n)) * MIX_B) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/**
 * Advances the state by one step and returns the mixed output.
 */
function advance(prng: PRNG): bigint {
  const s = (prng[kState] + GOLDEN) & MASK64;
  prng[kState] = s;
  return mix64(s);
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
  return { [kState]: s as bigint & Seed };
}

/** Returns the next value as a float64 in [0, 1). */
export function next(prng: PRNG): number {
  const bits = advance(prng);
  // Use upper 53 bits for double precision mantissa
  return Number(bits >> 11n) / 0x20_0000_0000_0000;
}

/** Returns the next value as an integer in [min, max] (inclusive). */
export function nextInt(prng: PRNG, min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 1) return min;
  // Uniform distribution via modulo of mixed 64-bit output.
  // Modulo bias is negligible for ranges << 2^64.
  const bits = advance(prng);
  return min + Number(bits % BigInt(range));
}

/** Returns the raw mixed 64-bit output as a bigint. */
export function nextBigInt(prng: PRNG): bigint {
  return advance(prng);
}

/**
 * Creates an independent sub-stream by deriving a new state from the current
 * one using a different mixing constant, then advancing the original.
 * Both the original and the fork diverge after this call.
 */
export function split(prng: PRNG): PRNG {
  const derived = (prng[kState] + SPLIT_MIX) & MASK64;
  prng[kState] = (prng[kState] + GOLDEN) & MASK64;
  return { [kState]: mix64(derived) };
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
