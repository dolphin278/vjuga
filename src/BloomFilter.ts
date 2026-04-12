/**
 * BloomFilter — probabilistic set membership filter backed by `Uint32Array`.
 *
 * When to use: as a fast "definitely absent" pre-filter before expensive
 * lookups (cache miss, DB query, disk read). `mightContain` returns `true`
 * for all items ever added (no false negatives) and occasionally `true` for
 * items that were never added (false positives at rate ≤ fpr). Not suitable
 * for exact membership — use a plain `Set` when false positives are
 * unacceptable.
 *
 * Internal design:
 *   kBits:  Uint32Array — m/32 words; bit i at word[i>>>5] pos[i&31].
 *   kK:     number      — number of hash probes per item.
 *   kM:     number      — total bit count (always a power of 2, ≥ 32).
 *   kMask:  number      — m − 1; used as `pos & kMask` instead of `pos % m`.
 *   kCount: number      — number of items added (monotonically increasing).
 *
 * Design tradeoffs: bit array sized to next power of 2 (≥ rawM) so that
 * modulo reduces to a single bitwise AND (`pos & mask`), saving ~20 cycles per
 * hash probe versus integer division. Memory overhead is at most 2× vs the
 * theoretical minimum. Deletion is unsupported — a counting Bloom filter
 * supports it at 4× memory cost. Kirsch–Mitzenmacher (2006) derives k probe
 * positions from two 32-bit FNV-1a hashes in a single string scan, halving
 * hashing cost versus two independent passes.
 *
 * Prior art: Kirsch, A. & Mitzenmacher, M. "Less Hashing, Same Performance:
 * Building a Better Bloom Filter." ESA 2006.
 *
 * @example
 * ```ts
 * import * as BF from "vjuga/BloomFilter.js";
 * const bf = BF.make(10_000, 0.01);   // 10k items, 1% FPR
 * BF.add(bf, "user:42");
 * BF.mightContain(bf, "user:42");     // true (always)
 * BF.mightContain(bf, "user:99");     // false (very likely)
 * ```
 */

const kBits: unique symbol = Symbol("bits");
const kK: unique symbol = Symbol("k");
const kM: unique symbol = Symbol("m");
const kMask: unique symbol = Symbol("mask");
const kCount: unique symbol = Symbol("count");

export interface BloomFilter {
  [kBits]: Uint32Array;
  [kK]: number;
  [kM]: number;
  [kMask]: number;
  [kCount]: number;
}

// ---------------------------------------------------------------------------
// nextPow2 — smallest power of 2 that is ≥ max(32, n).
// Minimum of 32 guarantees bitCount() % 32 === 0 and gives ≥ 1 word.
// Uses float multiplication (not bit shifts) to avoid Int32 overflow for large n.
// ---------------------------------------------------------------------------
function nextPow2(n: number): number {
  let p = 32;
  while (p < n) p *= 2;
  return p;
}

// ---------------------------------------------------------------------------
// hashPair — compute two FNV-1a 32-bit hashes in a single string scan.
//
// Two FNV-1a runs with distinct seeds (FNV_SEED1 / FNV_SEED2) produce
// sufficiently independent hash streams for the Kirsch-Mitzenmacher trick.
// h2 is forced odd (`| 1`) to guarantee it is coprime with the power-of-2
// modulus, preventing all k probes from landing on the same residue class.
// ---------------------------------------------------------------------------
const FNV_PRIME = 0x01000193; // 32-bit FNV prime
const FNV_SEED1 = 0x811c9dc5; // FNV offset basis
const FNV_SEED2 = 0x9e3779b9; // golden-ratio constant (distinct start value)

function hashPair(s: string): readonly [number, number] {
  let h1 = FNV_SEED1;
  let h2 = FNV_SEED2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Both hashes share the same FNV prime; distinct seeds + different initial
    // state ensure low correlation.  Math.imul avoids 64-bit intermediate.
    h1 = Math.imul(h1 ^ c, FNV_PRIME);
    h2 = Math.imul(h2 ^ c, FNV_PRIME);
  }
  return [h1 >>> 0, (h2 | 1) >>> 0]; // h2 forced odd: gcd(h2, 2^k) = 1
}

/**
 * Creates a BloomFilter sized for `capacity` items at a false-positive rate
 * of `fpr` (default 0.01 = 1%). The bit array is sized to the next power of 2
 * ≥ the theoretical optimum, enabling fast bitwise-AND modulo.
 *
 * Throws `RangeError` for:
 * - `capacity` < 1 or non-integer
 * - `fpr` ≤ 0 or ≥ 1
 */
export function make(capacity: number, fpr: number = 0.01): BloomFilter {
  if (capacity < 1 || (capacity | 0) !== capacity) {
    throw new RangeError(`BloomFilter.make: capacity must be a positive integer, got ${capacity}`);
  }
  if (fpr <= 0 || fpr >= 1) {
    throw new RangeError(`BloomFilter.make: fpr must be in (0, 1), got ${fpr}`);
  }

  const LN2 = Math.LN2;
  // Optimal bit count: m = -n * ln(fpr) / (ln2)^2 — round up to next power of 2.
  const rawM = Math.ceil((-capacity * Math.log(fpr)) / (LN2 * LN2));
  const m = nextPow2(rawM); // always a power of 2, ≥ 32
  const mask = m - 1; // precomputed for `pos & mask` = `pos % m` (power-of-2 fast path)
  // Optimal hash count: k = (m/n) * ln2
  const k = Math.max(1, Math.round((m / capacity) * LN2));

  const bf: BloomFilter = {
    [kBits]: new Uint32Array(m >>> 5), // m/32 words
    [kK]: k,
    [kM]: m,
    [kMask]: mask,
    [kCount]: 0,
  };
  // Double-write mutable scalar fields so V8 marks them mutable from the first
  // make() call — prevents deoptimisation cascade on first mutation.
  bf[kMask] = mask;
  bf[kCount] = 0;
  return bf;
}

/**
 * Adds `item` to the filter. Always succeeds.
 * After `add(bf, item)`, `mightContain(bf, item)` is guaranteed to return `true`.
 */
export function add(bf: BloomFilter, item: string): void {
  const mask = bf[kMask]; // power-of-2 mask: replaces `% m` with `& mask`
  const k = bf[kK];
  const bits = bf[kBits];
  const [h1, h2] = hashPair(item); // single-pass dual hash
  for (let i = 0; i < k; i++) {
    // Kirsch-Mitzenmacher: position i = (h1 + i*h2) mod m.
    // `>>> 0` normalises signed/unsigned before the AND.
    const pos = ((h1 + Math.imul(i, h2)) >>> 0) & mask;
    bits[pos >>> 5] |= 1 << (pos & 31);
  }
  bf[kCount]++;
}

/**
 * Returns `true` if `item` was possibly added to the filter, `false` if it
 * was definitely not added. No false negatives; false positive rate ≤ fpr.
 */
export function mightContain(bf: BloomFilter, item: string): boolean {
  const mask = bf[kMask];
  const k = bf[kK];
  const bits = bf[kBits];
  const [h1, h2] = hashPair(item);
  for (let i = 0; i < k; i++) {
    const pos = ((h1 + Math.imul(i, h2)) >>> 0) & mask;
    // Early-exit on first unset bit — most misses exit after 1 probe.
    if ((bits[pos >>> 5] >>> (pos & 31) & 1) === 0) return false;
  }
  return true;
}

/**
 * Resets the filter to empty — clears all bits and resets the item count.
 */
export function clear(bf: BloomFilter): void {
  bf[kBits].fill(0);
  bf[kCount] = 0;
}

/** Returns the approximate number of items added since the last `clear`. */
export function count(bf: BloomFilter): number {
  return bf[kCount];
}

/** Returns the total number of bits in the filter (always a power of 2). */
export function bitCount(bf: BloomFilter): number {
  return bf[kM];
}

/** Returns the number of hash probes per item. */
export function hashCount(bf: BloomFilter): number {
  return bf[kK];
}
