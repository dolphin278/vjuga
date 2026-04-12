import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as BF from "../BloomFilter.js";

const CAPACITY = 10_000;
const FPR = 0.01;

// --- Warm-up ---
{
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 100_000; i++) {
    BF.add(bf, `item-${i % CAPACITY}`);
    BF.mightContain(bf, `item-${i % CAPACITY}`);
  }
  reportOptimizationStatus(BF.add, "BF.add");
  reportOptimizationStatus(BF.mightContain, "BF.mightContain");
}

// Pre-built filter with CAPACITY items for hit benchmarks.
const hotBF = BF.make(CAPACITY, FPR);
for (let i = 0; i < CAPACITY; i++) BF.add(hotBF, `item-${i}`);

// --- Benchmarks ---

bench(`BloomFilter.make (capacity=${CAPACITY}, fpr=${FPR})`, () => BF.make(CAPACITY, FPR));

bench("BloomFilter.add — 1000 items", () => {
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 1000; i++) BF.add(bf, `item-${i}`);
});

bench("BloomFilter.mightContain — hit (item present)", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (BF.mightContain(hotBF, `item-${i}`)) hits++;
  }
  return hits;
});

bench("BloomFilter.mightContain — miss (item absent)", () => {
  let hits = 0;
  for (let i = CAPACITY; i < CAPACITY + 1000; i++) {
    if (BF.mightContain(hotBF, `item-${i}`)) hits++;
  }
  return hits;
});

bench("BloomFilter.clear", () => {
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 100; i++) BF.add(bf, `item-${i}`);
  BF.clear(bf);
});

await run();

export {};
