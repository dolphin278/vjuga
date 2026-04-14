/**
 * BitSet benchmark — vjuga vs FastBitSet (npm).
 *
 * FastBitSet is a well-known, heavily optimised JavaScript BitSet that
 * dynamically resizes; it does not enforce a fixed capacity so bounds checks
 * are absent.  The comparison shows what our fixed-capacity + bounds-safe
 * design costs and where it wins.
 */
import { createRequire } from "node:module";
import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as BitSet from "../BitSet.js";

// FastBitSet is an untyped CommonJS package; use createRequire to import it
// without triggering TS7016.  The cast below narrows only the methods we use.
const _req = createRequire(import.meta.url);
const FastBitSet = _req("fastbitset") as new () => {
  add(i: number): void;
  has(i: number): boolean;
  remove(i: number): void;
  size(): number;
  array(): number[];
  new_intersection(b: unknown): unknown;
  new_union(b: unknown): unknown;
  new_difference(b: unknown): unknown;
};

const CAPACITY = 1024;

// ---------------------------------------------------------------------------
// Warm-up — bring vjuga BitSet hot functions to top JIT tier
// ---------------------------------------------------------------------------
{
  const bs = BitSet.make(CAPACITY);
  for (let i = 0; i < 100_000; i++) {
    BitSet.set(bs, i % CAPACITY);
    BitSet.get(bs, i % CAPACITY);
    BitSet.clear(bs, i % CAPACITY);
    BitSet.toggle(bs, i % CAPACITY);
  }
  BitSet.popcount(bs);
  BitSet.toArray(bs);
  const bs2 = BitSet.make(CAPACITY);
  BitSet.and(bs, bs2);
  BitSet.or(bs, bs2);
  BitSet.xor(bs, bs2);
  BitSet.not(bs);
  reportOptimizationStatus(BitSet.set, "BitSet.set");
  reportOptimizationStatus(BitSet.get, "BitSet.get");
  reportOptimizationStatus(BitSet.popcount, "BitSet.popcount");
}

// Warm up FastBitSet too
{
  const fb = new FastBitSet();
  for (let i = 0; i < 100_000; i++) fb.add(i % CAPACITY);
  fb.size();
  fb.array();
}

// Pre-built BitSets for read benchmarks
const hotFull = BitSet.make(CAPACITY);
const hotHalf = BitSet.make(CAPACITY);
for (let i = 0; i < CAPACITY; i++) BitSet.set(hotFull, i);
for (let i = 0; i < CAPACITY; i += 2) BitSet.set(hotHalf, i);

const fbFull = new FastBitSet();
const fbHalf = new FastBitSet();
for (let i = 0; i < CAPACITY; i++) fbFull.add(i);
for (let i = 0; i < CAPACITY; i += 2) fbHalf.add(i);

// ---------------------------------------------------------------------------
// make / construction
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.make (capacity=1024)", () => BitSet.make(CAPACITY));
bench("fbs    new FastBitSet (no capacity)", () => new FastBitSet());

// ---------------------------------------------------------------------------
// set / add — sequential 1024 bits
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.set — sequential 1024 bits", () => {
  const bs = BitSet.make(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) BitSet.set(bs, i);
});
bench("fbs    FastBitSet.add — sequential 1024 bits", () => {
  const fb = new FastBitSet();
  for (let i = 0; i < CAPACITY; i++) fb.add(i);
});

// ---------------------------------------------------------------------------
// get / has — 1024 reads
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.get — 1024 reads (all set)", () => {
  let n = 0;
  for (let i = 0; i < CAPACITY; i++) if (BitSet.get(hotFull, i)) n++;
  return n;
});
bench("fbs    FastBitSet.has — 1024 reads (all set)", () => {
  let n = 0;
  for (let i = 0; i < CAPACITY; i++) if (fbFull.has(i)) n++;
  return n;
});

// ---------------------------------------------------------------------------
// popcount
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.popcount — full 1024-bit set", () => BitSet.popcount(hotFull));
bench("vjuga  BitSet.popcount — half-set 1024 bits", () => BitSet.popcount(hotHalf));
bench("fbs    FastBitSet.size() — full 1024-bit set", () => fbFull.size());
bench("fbs    FastBitSet.size() — half-set 1024 bits", () => fbHalf.size());

// ---------------------------------------------------------------------------
// toArray
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.toArray — full 1024-bit set", () => BitSet.toArray(hotFull));
bench("fbs    FastBitSet.array() — full 1024-bit set", () => fbFull.array());

// ---------------------------------------------------------------------------
// Set algebra
// ---------------------------------------------------------------------------
bench("vjuga  BitSet.and — 1024 bits", () => BitSet.and(hotFull, hotHalf));
bench("vjuga  BitSet.or  — 1024 bits", () => BitSet.or(hotFull, hotHalf));
bench("vjuga  BitSet.xor — 1024 bits", () => BitSet.xor(hotFull, hotHalf));
bench("vjuga  BitSet.not — full 1024-bit set", () => BitSet.not(hotFull));
bench("fbs    FastBitSet.new_intersection — 1024 bits", () => fbFull.new_intersection(fbHalf));
bench("fbs    FastBitSet.new_union        — 1024 bits", () => fbFull.new_union(fbHalf));
bench("fbs    FastBitSet.new_difference   — 1024 bits (XOR approx)", () =>
  fbFull.new_difference(fbHalf));

await run();

export {};
