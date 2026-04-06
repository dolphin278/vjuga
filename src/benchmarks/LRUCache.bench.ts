import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as LRUCache from "../LRUCache.js";

const CAPACITY = 1000;

// --- Warm-up ---
{
  const cache = LRUCache.make<number, number>(CAPACITY);
  for (let i = 0; i < 100_000; i++) {
    LRUCache.set(cache, i % CAPACITY, i);
    LRUCache.get(cache, i % CAPACITY);
    LRUCache.has(cache, i % CAPACITY);
  }
  reportOptimizationStatus(LRUCache.get, "LRUCache.get");
  reportOptimizationStatus(LRUCache.set, "LRUCache.set");
  reportOptimizationStatus(LRUCache.has, "LRUCache.has");
}

// Pre-built cache for hit benchmarks.
const hotCache = LRUCache.make<number, number>(CAPACITY);
for (let i = 0; i < CAPACITY; i++) LRUCache.set(hotCache, i, i * 2);

// --- Benchmarks ---

bench("LRUCache.make (capacity=1000)", () => LRUCache.make<number, number>(CAPACITY));

bench("LRUCache.set — no eviction (capacity not reached)", () => {
  const c = LRUCache.make<number, number>(CAPACITY);
  for (let i = 0; i < CAPACITY; i++) LRUCache.set(c, i, i);
});

bench("LRUCache.get — hit", () => {
  let sum = 0;
  for (let i = 0; i < CAPACITY; i++) sum += LRUCache.get(hotCache, i) ?? 0;
  return sum;
});

bench("LRUCache.get — miss", () => {
  const c = LRUCache.make<number, number>(CAPACITY);
  let hit = 0;
  for (let i = 0; i < CAPACITY; i++) {
    if (LRUCache.get(c, i) !== undefined) hit++;
  }
  return hit;
});

bench("LRUCache.set — eviction-heavy (2× capacity inserts)", () => {
  const c = LRUCache.make<number, number>(CAPACITY);
  for (let i = 0; i < CAPACITY * 2; i++) LRUCache.set(c, i, i);
});

bench("LRUCache vs plain Map — get hit (Map)", () => {
  const m = new Map<number, number>();
  for (let i = 0; i < CAPACITY; i++) m.set(i, i * 2);
  let sum = 0;
  for (let i = 0; i < CAPACITY; i++) sum += m.get(i) ?? 0;
  return sum;
});

bench("LRUCache vs plain Map — get hit (LRUCache)", () => {
  let sum = 0;
  for (let i = 0; i < CAPACITY; i++) sum += LRUCache.get(hotCache, i) ?? 0;
  return sum;
});

await run();

export {};
