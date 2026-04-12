import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as BitSet from "../BitSet.js";

const CAPACITY = 1024;

// --- Warm-up ---
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

// Pre-built BitSets for bulk benchmarks
const hotFull = BitSet.make(CAPACITY);
const hotHalf = BitSet.make(CAPACITY);
for (let i = 0; i < CAPACITY; i++) BitSet.set(hotFull, i);
for (let i = 0; i < CAPACITY; i += 2) BitSet.set(hotHalf, i);

// --- Benchmarks ---

bench("BitSet.make (capacity=1024)", () => BitSet.make(CAPACITY));

bench("BitSet.set — sequential 1024 bits", () => {
  const bs = BitSet.make(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) BitSet.set(bs, i);
});

bench("BitSet.get — 1024 reads (all set)", () => {
  let n = 0;
  for (let i = 0; i < CAPACITY; i++) if (BitSet.get(hotFull, i)) n++;
  return n;
});

bench("BitSet.popcount — full 1024-bit set", () => BitSet.popcount(hotFull));

bench("BitSet.popcount — half-set 1024 bits", () => BitSet.popcount(hotHalf));

bench("BitSet.toArray — full 1024-bit set", () => BitSet.toArray(hotFull));

bench("BitSet.and — 1024 bits", () => BitSet.and(hotFull, hotHalf));

bench("BitSet.or — 1024 bits", () => BitSet.or(hotFull, hotHalf));

bench("BitSet.xor — 1024 bits", () => BitSet.xor(hotFull, hotHalf));

bench("BitSet.not — full 1024-bit set", () => BitSet.not(hotFull));

await run();

export {};
