import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as OM from "../OrderedMap.js";

const N = 1000;

// --- Warm-up ---
{
  const m = OM.make<number, number>();
  for (let i = 0; i < 10_000; i++) {
    OM.set(m, i % N, i);
    OM.get(m, i % N);
    OM.has(m, i % N);
  }
  OM.min(m);
  OM.max(m);
  OM.floor(m, 500);
  OM.ceiling(m, 500);
  for (const _ of OM.range(m, 0, 100)) void _;
  for (const _ of OM.keys(m)) void _;
  reportOptimizationStatus(OM.set, "OM.set");
  reportOptimizationStatus(OM.get, "OM.get");
}

// Pre-built map for read benchmarks
const hotMap = OM.make<number, number>();
for (let i = 0; i < N; i++) OM.set(hotMap, i, i * 2);

const plainMap = new Map<number, number>();
for (let i = 0; i < N; i++) plainMap.set(i, i * 2);

// --- Benchmarks ---

bench(`OrderedMap.make`, () => OM.make<number, number>());

bench(`OrderedMap sequential insert ${N} keys`, () => {
  const m = OM.make<number, number>();
  for (let i = 0; i < N; i++) OM.set(m, i, i);
});

bench(`OrderedMap random insert ${N} keys`, () => {
  const m = OM.make<number, number>();
  for (let i = 0; i < N; i++) {
    const k = (i * 1337 + 42) % (N * 2);
    OM.set(m, k, i);
  }
});

bench(`OrderedMap.get — hit (${N} keys)`, () => {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += OM.get(hotMap, i) ?? 0;
  return sum;
});

bench(`OrderedMap.get — miss (${N} keys)`, () => {
  let hit = 0;
  for (let i = N; i < N * 2; i++) if (OM.get(hotMap, i) !== undefined) hit++;
  return hit;
});

bench(`Map.get — hit baseline (${N} keys)`, () => {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += plainMap.get(i) ?? 0;
  return sum;
});

bench(`OrderedMap.range [0, 100]`, () => {
  let count = 0;
  for (const _ of OM.range(hotMap, 0, 100)) count++;
  return count;
});

bench(`OrderedMap.keys (full traversal ${N})`, () => {
  let count = 0;
  for (const _ of OM.keys(hotMap)) count++;
  return count;
});

bench(`OrderedMap.floor / ceiling`, () => {
  let n = 0;
  for (let i = 0; i < 100; i++) {
    if (OM.floor(hotMap, i * 10)) n++;
    if (OM.ceiling(hotMap, i * 10)) n++;
  }
  return n;
});

await run();

export {};
