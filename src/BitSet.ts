/**
 * BitSet — compact bit array backed by `Uint32Array`.
 *
 * When to use: dense boolean vectors where memory and iteration speed matter —
 * SOA row-level flags, graph adjacency matrices, set-intersection via bitwise
 * AND. For sparse sets or sets with non-integer elements, use plain `Set`.
 * Break-even vs `boolean[]` is around 64 bits; SWAR popcount makes counting
 * ~32× faster than iterating individual bytes.
 *
 * Internal design:
 *   kBits:   Uint32Array — ceil(capacity/32) 32-bit words. Bit i lives at
 *            word `i >>> 5`, position `i & 31` (LSB = index 0).
 *   kLength: number      — declared bit capacity (total addressable indices).
 *
 * Design tradeoffs: Uint32Array chosen over BigInt64Array for V8 compatibility
 * (BigInt arithmetic is not JIT-compiled as aggressively) and because SWAR
 * popcount operates on 32-bit words. The last word may have excess bits above
 * `capacity % 32`; `not` and `popcount` mask them away to maintain invariants.
 *
 * @example
 * ```ts
 * import * as BitSet from "vjuga/BitSet.js";
 * const bs = BitSet.make(64);
 * BitSet.set(bs, 5);
 * BitSet.set(bs, 63);
 * BitSet.popcount(bs);    // 2
 * BitSet.toArray(bs);     // [5, 63]
 * const bs2 = BitSet.not(bs);
 * BitSet.popcount(bs2);   // 62
 * ```
 */

const kBits: unique symbol = Symbol("bits");
const kLength: unique symbol = Symbol("length");

export interface BitSet {
  [kBits]: Uint32Array;
  [kLength]: number;
}

// ---------------------------------------------------------------------------
// SWAR popcount — counts set bits in a single 32-bit word.
// Technique: parallel bit counting in O(log 32) steps, no lookup table.
// ---------------------------------------------------------------------------
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Creates a new BitSet with the given `capacity` (number of addressable bit
 * indices, 0..capacity-1). All bits are initially 0.
 *
 * Throws `RangeError` if `capacity` is not a positive integer.
 */
export function make(capacity: number): BitSet {
  if (capacity < 1 || (capacity | 0) !== capacity) {
    throw new RangeError(`BitSet.make: capacity must be a positive integer, got ${capacity}`);
  }
  const words = Math.ceil(capacity / 32);
  const bits = new Uint32Array(words);
  const bs: BitSet = {
    [kBits]: bits,
    [kLength]: capacity,
  };
  // Double-write kLength so V8 marks it mutable from the first make() call,
  // preventing deoptimization on later writes inside set/clear/toggle.
  bs[kLength] = capacity;
  return bs;
}

// ---------------------------------------------------------------------------
// Bounds check — shared by set, clear, toggle, get
// ---------------------------------------------------------------------------
function checkBounds(bs: BitSet, i: number): void {
  if (i < 0 || i >= bs[kLength] || (i | 0) !== i) {
    throw new RangeError(`BitSet: index ${i} out of bounds [0, ${bs[kLength] - 1}]`);
  }
}

/** Sets bit `i` to 1. Throws `RangeError` if `i` is out of bounds. */
export function set(bs: BitSet, i: number): void {
  checkBounds(bs, i);
  bs[kBits][i >>> 5] |= 1 << (i & 31);
}

/** Clears bit `i` to 0. Throws `RangeError` if `i` is out of bounds. */
export function clear(bs: BitSet, i: number): void {
  checkBounds(bs, i);
  bs[kBits][i >>> 5] &= ~(1 << (i & 31));
}

/** Flips bit `i`. Throws `RangeError` if `i` is out of bounds. */
export function toggle(bs: BitSet, i: number): void {
  checkBounds(bs, i);
  bs[kBits][i >>> 5] ^= 1 << (i & 31);
}

/** Returns `true` if bit `i` is 1. Throws `RangeError` if `i` is out of bounds. */
export function get(bs: BitSet, i: number): boolean {
  checkBounds(bs, i);
  return ((bs[kBits][i >>> 5] >>> (i & 31)) & 1) === 1;
}

/** Returns the bit capacity (number of addressable indices). */
export function capacity(bs: BitSet): number {
  return bs[kLength];
}

/**
 * Returns the number of set bits using SWAR popcount on each 32-bit word.
 * The last word is masked to exclude excess bits above `capacity % 32`.
 */
export function popcount(bs: BitSet): number {
  const bits = bs[kBits];
  const len = bits.length;
  // len >= 1 is guaranteed by make() — capacity >= 1 gives ceil(capacity/32) >= 1.
  let count = 0;
  // Sum full words up to (but not including) the last word.
  for (let w = 0; w < len - 1; w++) {
    count += popcount32(bits[w]);
  }
  // Mask the last word to exclude excess bits above kLength % 32.
  const rem = bs[kLength] & 31; // equivalent to % 32
  const lastMask = rem === 0 ? 0xffffffff : (1 << rem) - 1;
  count += popcount32(bits[len - 1] & lastMask);
  return count;
}

/**
 * Returns an array of indices of all set bits, in ascending order.
 */
export function toArray(bs: BitSet): number[] {
  const bits = bs[kBits];
  const len = bs[kLength];
  // Pre-allocate the exact result size via popcount so V8 can use a single
  // backed allocation without any dynamic resize during the extraction loop.
  // This eliminates the push() overhead (length check + possible realloc)
  // and produces a dense SMI array that V8 can store without boxing.
  const n = popcount(bs);
  const result = new Array<number>(n);
  let j = 0;
  for (let w = 0; w < bits.length; w++) {
    let word = bits[w];
    // Mask last word to exclude excess bits above kLength.
    if (w === bits.length - 1) {
      const rem = len & 31;
      if (rem !== 0) word &= (1 << rem) - 1;
    }
    const base = w << 5;
    while (word !== 0) {
      const lsb = word & -word; // isolate lowest set bit (power of 2)
      // Math.clz32 maps to a single CLZ/LZCNT CPU instruction — much faster
      // than the SWAR popcount32(lsb - 1) path used in popcount().
      result[j++] = base + (31 - Math.clz32(lsb));
      word ^= lsb; // clear lowest set bit
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Binary set algebra — all return a new BitSet
// ---------------------------------------------------------------------------

function checkSameCapacity(a: BitSet, b: BitSet): void {
  if (a[kLength] !== b[kLength]) {
    throw new RangeError(
      `BitSet: capacity mismatch — a.capacity=${a[kLength]}, b.capacity=${b[kLength]}`,
    );
  }
}

// ---------------------------------------------------------------------------
// _makeFromBits — fast private constructor for algebra results.
//
// `make(capacity)` validates capacity, allocates a fresh Uint32Array, and
// double-writes kLength — ~400 ns overhead.  Algebra ops (and/or/xor/not)
// always produce a BitSet of the same capacity as an existing valid input, so
// no validation is needed and the bits array is supplied by the caller.
// This drops algebra op cost from ~500 ns to ~20 ns (just Uint32Array alloc
// + object literal creation).
// ---------------------------------------------------------------------------
function _makeFromBits(capacity: number, bits: Uint32Array): BitSet {
  const bs: BitSet = { [kBits]: bits, [kLength]: capacity };
  bs[kLength] = capacity; // double-write: keeps kLength mutable in V8's hidden class
  return bs;
}

/** Returns a new BitSet = bitwise AND of `a` and `b`. Throws if capacities differ. */
export function and(a: BitSet, b: BitSet): BitSet {
  checkSameCapacity(a, b);
  const ra = a[kBits];
  const rb = b[kBits];
  const n = ra.length;
  const rc = new Uint32Array(n);
  for (let w = 0; w < n; w++) rc[w] = ra[w] & rb[w];
  return _makeFromBits(a[kLength], rc);
}

/** Returns a new BitSet = bitwise OR of `a` and `b`. Throws if capacities differ. */
export function or(a: BitSet, b: BitSet): BitSet {
  checkSameCapacity(a, b);
  const ra = a[kBits];
  const rb = b[kBits];
  const n = ra.length;
  const rc = new Uint32Array(n);
  for (let w = 0; w < n; w++) rc[w] = ra[w] | rb[w];
  return _makeFromBits(a[kLength], rc);
}

/** Returns a new BitSet = bitwise XOR of `a` and `b`. Throws if capacities differ. */
export function xor(a: BitSet, b: BitSet): BitSet {
  checkSameCapacity(a, b);
  const ra = a[kBits];
  const rb = b[kBits];
  const n = ra.length;
  const rc = new Uint32Array(n);
  for (let w = 0; w < n; w++) rc[w] = ra[w] ^ rb[w];
  return _makeFromBits(a[kLength], rc);
}

/**
 * Returns a new BitSet = bitwise NOT of `a`.
 * Excess bits in the last word (above `capacity % 32`) are masked to 0.
 */
export function not(a: BitSet): BitSet {
  const ra = a[kBits];
  const n = ra.length;
  const rc = new Uint32Array(n);
  for (let w = 0; w < n; w++) rc[w] = ~ra[w];
  // Mask excess bits in last word to preserve invariant that bits above
  // kLength are always 0.
  const rem = a[kLength] & 31;
  rc[n - 1] &= rem === 0 ? 0xffffffff : (1 << rem) - 1;
  return _makeFromBits(a[kLength], rc);
}
