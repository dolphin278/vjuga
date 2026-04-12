/**
 * BloomFilter benchmark — vjuga vs bloomfilter.js (npm).
 *
 * bloomfilter.js is a widely-used JavaScript Bloom filter backed by a typed
 * array with FNV / djb2 hashing. Both implementations are configured for
 * the same approximate working point: ~10k items, ~1% FPR.
 *
 * vjuga params: make(10_000, 0.01) → m=131072 bits, k=9 hash probes.
 * bloomfilter params: new BloomFilter(131072, 9) — matched manually.
 */
import { createRequire } from "node:module";
import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as BF from "../BloomFilter.js";

const _req = createRequire(import.meta.url);
const { BloomFilter: BFLib } = _req("bloomfilter") as { BloomFilter: new (m: number, k: number) => {
  add(s: string): void;
  test(s: string): boolean;
}};

const CAPACITY = 10_000;
const FPR = 0.01;

// Matched params for bloomfilter.js — same bit count and hash count as vjuga.
const BF_M = BF.bitCount(BF.make(CAPACITY, FPR)); // = 131072
const BF_K = BF.hashCount(BF.make(CAPACITY, FPR));

// ---------------------------------------------------------------------------
// Warm-up
// ---------------------------------------------------------------------------
{
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 100_000; i++) {
    BF.add(bf, `item-${i % CAPACITY}`);
    BF.mightContain(bf, `item-${i % CAPACITY}`);
  }
  reportOptimizationStatus(BF.add, "BF.add");
  reportOptimizationStatus(BF.mightContain, "BF.mightContain");
}
{
  const bfl = new BFLib(BF_M, BF_K);
  for (let i = 0; i < 10_000; i++) bfl.add(`item-${i}`);
}

// Pre-filled filters for mightContain/test benchmarks
const hotBF = BF.make(CAPACITY, FPR);
for (let i = 0; i < CAPACITY; i++) BF.add(hotBF, `item-${i}`);

const hotBFL = new BFLib(BF_M, BF_K);
for (let i = 0; i < CAPACITY; i++) hotBFL.add(`item-${i}`);

// Pre-built strings to avoid string allocation inside the benchmark loop
const hitKeys: string[] = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
const missKeys: string[] = Array.from({ length: 1000 }, (_, i) => `item-${CAPACITY + i}`);

// ---------------------------------------------------------------------------
// make / construction
// ---------------------------------------------------------------------------
bench(`vjuga  BloomFilter.make (${CAPACITY}, ${FPR})`, () => BF.make(CAPACITY, FPR));
bench(`bflib  new BloomFilter(${BF_M}, ${BF_K})`,     () => new BFLib(BF_M, BF_K));

// ---------------------------------------------------------------------------
// add — 1000 items
// ---------------------------------------------------------------------------
bench("vjuga  BloomFilter.add — 1000 items", () => {
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 1000; i++) BF.add(bf, hitKeys[i]);
});
bench("bflib  BloomFilter.add — 1000 items", () => {
  const bfl = new BFLib(BF_M, BF_K);
  for (let i = 0; i < 1000; i++) bfl.add(hitKeys[i]);
});

// ---------------------------------------------------------------------------
// mightContain / test — 1000 items, hit
// ---------------------------------------------------------------------------
bench("vjuga  BloomFilter.mightContain — hit (1000 items present)", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (BF.mightContain(hotBF, hitKeys[i])) hits++;
  return hits;
});
bench("bflib  BloomFilter.test — hit (1000 items present)", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (hotBFL.test(hitKeys[i])) hits++;
  return hits;
});

// ---------------------------------------------------------------------------
// mightContain / test — 1000 items, miss
// ---------------------------------------------------------------------------
bench("vjuga  BloomFilter.mightContain — miss (1000 items absent)", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (BF.mightContain(hotBF, missKeys[i])) hits++;
  return hits;
});
bench("bflib  BloomFilter.test — miss (1000 items absent)", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (hotBFL.test(missKeys[i])) hits++;
  return hits;
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------
bench("vjuga  BloomFilter.clear", () => {
  const bf = BF.make(CAPACITY, FPR);
  for (let i = 0; i < 100; i++) BF.add(bf, hitKeys[i % 1000]);
  BF.clear(bf);
});

await run();

export {};
