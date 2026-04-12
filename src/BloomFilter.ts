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
 *   kBits:  Uint32Array — ceil(m/32) words; bit i at word[i>>>5] pos[i&31].
 *   kK:     number      — number of hash probes per item.
 *   kM:     number      — total bit count (capacity of the bit array).
 *   kCount: number      — number of items added (monotonically increasing).
 *
 * Design tradeoffs: deletion is intentionally unsupported — the standard
 * Bloom filter cannot remove items without false-negative risk. A counting
 * Bloom filter supports deletion at 4× memory cost; use that if needed.
 * Kirsch–Mitzenmacher (2006) derives k positions from two 32-bit FNV-1a
 * hashes, avoiding k independent hash functions while preserving theoretical
 * guarantees.
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
const kCount: unique symbol = Symbol("count");

export interface BloomFilter {
  [kBits]: Uint32Array;
  [kK]: number;
  [kM]: number;
  [kCount]: number;
}

// ---------------------------------------------------------------------------
// FNV-1a 32-bit hash — two different seeds give two independent hash streams.
// seed1 = FNV offset basis; seed2 = golden-ratio-derived constant (different
// prime multiplication path gives sufficient independence for K-M trick).
// ---------------------------------------------------------------------------
const FNV_PRIME = 0x01000193;
const FNV_SEED1 = 0x811c9dc5;
const FNV_SEED2 = 0x9e3779b9;

function fnv1a(s: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Creates a BloomFilter sized for `capacity` items at a false-positive rate
 * of `fpr` (default 0.01 = 1%).
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
  const LN2_SQ = LN2 * LN2;
  // Optimal bit count: m = -n * ln(fpr) / (ln2)^2
  const rawM = Math.ceil((-capacity * Math.log(fpr)) / LN2_SQ);
  // Round up to next multiple of 32 so Uint32Array is fully utilized.
  const m = Math.ceil(rawM / 32) * 32;
  // Optimal hash count: k = (m/n) * ln2
  const k = Math.max(1, Math.round((m / capacity) * LN2));

  const bf: BloomFilter = {
    [kBits]: new Uint32Array(m >>> 5),
    [kK]: k,
    [kM]: m,
    [kCount]: 0,
  };
  // Double-write kCount so V8 marks it mutable from construction.
  bf[kCount] = 0;
  return bf;
}

/**
 * Adds `item` to the filter. Always returns void; never fails.
 * Calling `mightContain(bf, item)` after `add(bf, item)` always returns true.
 */
export function add(bf: BloomFilter, item: string): void {
  const m = bf[kM];
  const k = bf[kK];
  const bits = bf[kBits];
  const h1 = fnv1a(item, FNV_SEED1);
  const h2 = fnv1a(item, FNV_SEED2);
  // Kirsch-Mitzenmacher: position i = (h1 + i * h2) % m
  for (let i = 0; i < k; i++) {
    const pos = ((h1 + Math.imul(i, h2)) >>> 0) % m;
    bits[pos >>> 5] |= 1 << (pos & 31);
  }
  bf[kCount]++;
}

/**
 * Returns `true` if `item` was possibly added to the filter, `false` if it
 * was definitely not added. No false negatives; false positive rate ≤ fpr.
 */
export function mightContain(bf: BloomFilter, item: string): boolean {
  const m = bf[kM];
  const k = bf[kK];
  const bits = bf[kBits];
  const h1 = fnv1a(item, FNV_SEED1);
  const h2 = fnv1a(item, FNV_SEED2);
  for (let i = 0; i < k; i++) {
    const pos = ((h1 + Math.imul(i, h2)) >>> 0) % m;
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

/** Returns the total number of bits in the filter (diagnostic). */
export function bitCount(bf: BloomFilter): number {
  return bf[kM];
}

/** Returns the number of hash probes per item (diagnostic). */
export function hashCount(bf: BloomFilter): number {
  return bf[kK];
}
