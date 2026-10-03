/**
 * Reference BigInt SplitMix64 — the PRNG implementation shipped up to v10.0.0,
 * kept verbatim as a test oracle. The uint32 implementation in `src/PRNG.ts`
 * must stay bit-identical to it (seeds and replay paths depend on it).
 * `nextInt` here is only meaningful for integer ranges up to 2^53.
 */

export interface RefPRNG {
  state: bigint;
}

const MASK64 = 0xffff_ffff_ffff_ffffn;
const GOLDEN = 0x9e37_79b9_7f4a_7c15n;
const MIX_A = 0xbf58_476d_1ce4_e5b9n;
const MIX_B = 0x94d0_49bb_1331_11ebn;
const SPLIT_MIX = 0x6a09_e667_f3bc_c908n;

export function mix64(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * MIX_A) & MASK64;
  z = ((z ^ (z >> 27n)) * MIX_B) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function advance(prng: RefPRNG): bigint {
  const s = (prng.state + GOLDEN) & MASK64;
  prng.state = s;
  return mix64(s);
}

export function make(s: bigint): RefPRNG {
  return { state: s };
}

export function next(prng: RefPRNG): number {
  return Number(advance(prng) >> 11n) / 0x20_0000_0000_0000;
}

export function nextInt(prng: RefPRNG, min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 1) return min;
  const bits = advance(prng);
  return min + Number(bits % BigInt(range));
}

export function nextBigInt(prng: RefPRNG): bigint {
  return advance(prng);
}

export function split(prng: RefPRNG): RefPRNG {
  const derived = (prng.state + SPLIT_MIX) & MASK64;
  prng.state = (prng.state + GOLDEN) & MASK64;
  return { state: mix64(derived) };
}

/** Inverse of `mix64` — builds a state whose next draw is a chosen output. */
export function unmix64(z: bigint): bigint {
  const inv = (a: bigint): bigint => {
    let x = a;
    for (let i = 0; i < 7; i++) x = (x * (2n - a * x)) & MASK64;
    return x;
  };
  const unxorshift = (v: bigint, k: bigint): bigint => {
    let x = v;
    for (let i = 0; i < 10; i++) x = v ^ (x >> k);
    return x & MASK64;
  };
  z = unxorshift(z, 31n);
  z = (z * inv(MIX_B)) & MASK64;
  z = unxorshift(z, 27n);
  z = (z * inv(MIX_A)) & MASK64;
  return unxorshift(z, 30n);
}

/** Seed whose first draw (`next`/`nextInt`/`nextBigInt`) produces `output`. */
export function seedForOutput(output: bigint): bigint {
  return (unmix64(output) - GOLDEN) & MASK64;
}
