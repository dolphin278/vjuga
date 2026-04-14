/**
 * OrderedMap benchmark — vjuga vs sorted-btree (npm).
 *
 * sorted-btree is a production-grade B-tree implementation with dense node
 * arrays that are cache-friendly. It supports the same operations as our AVL
 * tree, making it the best available JavaScript competitor for sorted maps.
 *
 * Note: plain `Map` is included as a get/set baseline — it is O(1) average
 * and unsorted, so it represents the minimum possible cost for unordered ops.
 */
import { createRequire } from "node:module";
import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as OM from "../OrderedMap.js";

const _req = createRequire(import.meta.url);
type BTreeCtor = new <K, V>(
  compare?: (a: K, b: K) => number,
) => {
  set(k: K, v: V): unknown;
  get(k: K): V | undefined;
  has(k: K): boolean;
  delete(k: K): boolean;
  size: number;
  minKey(): K | undefined;
  maxKey(): K | undefined;
  nextLowerPair(k: K): [K, V] | undefined;
  nextHigherPair(k: K): [K, V] | undefined;
  forRange(lo: K, hi: K, inclusive: boolean, fn: (k: K, v: V) => void): number;
  keys(): IterableIterator<K>;
};
const { default: BTreeMap } = _req("sorted-btree") as { default: BTreeCtor };

const N = 1000;

// ---------------------------------------------------------------------------
// Warm-up
// ---------------------------------------------------------------------------
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
{
  const bt = new BTreeMap<number, number>();
  for (let i = 0; i < 10_000; i++) {
    bt.set(i % N, i);
    bt.get(i % N);
  }
}

// Pre-built maps
const hotMap = OM.make<number, number>();
for (let i = 0; i < N; i++) OM.set(hotMap, i, i * 2);

const hotBT = new BTreeMap<number, number>();
for (let i = 0; i < N; i++) hotBT.set(i, i * 2);

const plainMap = new Map<number, number>();
for (let i = 0; i < N; i++) plainMap.set(i, i * 2);

// ---------------------------------------------------------------------------
// make / construction
// ---------------------------------------------------------------------------
bench("vjuga  OrderedMap.make", () => OM.make<number, number>());
bench("btree  new BTreeMap (sorted-btree)", () => new BTreeMap<number, number>());

// ---------------------------------------------------------------------------
// set / insert — 1000 keys
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap sequential insert ${N} keys`, () => {
  const m = OM.make<number, number>();
  for (let i = 0; i < N; i++) OM.set(m, i, i);
});
bench(`btree  BTreeMap sequential insert ${N} keys`, () => {
  const bt = new BTreeMap<number, number>();
  for (let i = 0; i < N; i++) bt.set(i, i);
});

bench(`vjuga  OrderedMap random insert ${N} keys`, () => {
  const m = OM.make<number, number>();
  for (let i = 0; i < N; i++) {
    const k = (i * 1337 + 42) % (N * 2);
    OM.set(m, k, i);
  }
});
bench(`btree  BTreeMap random insert ${N} keys`, () => {
  const bt = new BTreeMap<number, number>();
  for (let i = 0; i < N; i++) {
    const k = (i * 1337 + 42) % (N * 2);
    bt.set(k, i);
  }
});

// ---------------------------------------------------------------------------
// get — hit
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap.get — hit (${N} keys)`, () => {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += OM.get(hotMap, i) ?? 0;
  return sum;
});
bench(`btree  BTreeMap.get — hit (${N} keys)`, () => {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += hotBT.get(i) ?? 0;
  return sum;
});
bench(`plain  Map.get — hit baseline (${N} keys)`, () => {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += plainMap.get(i) ?? 0;
  return sum;
});

// ---------------------------------------------------------------------------
// get — miss
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap.get — miss (${N} keys)`, () => {
  let hit = 0;
  for (let i = N; i < N * 2; i++) if (OM.get(hotMap, i) !== undefined) hit++;
  return hit;
});
bench(`btree  BTreeMap.get — miss (${N} keys)`, () => {
  let hit = 0;
  for (let i = N; i < N * 2; i++) if (hotBT.get(i) !== undefined) hit++;
  return hit;
});

// ---------------------------------------------------------------------------
// range / forRange
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap.range [0, 100] (generator)`, () => {
  let count = 0;
  for (const _ of OM.range(hotMap, 0, 100)) count++;
  return count;
});
bench(`vjuga  OrderedMap.forRange [0, 100] (callback)`, () => {
  let count = 0;
  OM.forRange(hotMap, 0, 100, () => count++);
  return count;
});
bench(`btree  BTreeMap.forRange [0, 100]`, () => {
  let count = 0;
  hotBT.forRange(0, 100, true, () => count++);
  return count;
});

// ---------------------------------------------------------------------------
// full iteration — keys
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap.keys (full traversal ${N})`, () => {
  let count = 0;
  for (const _ of OM.keys(hotMap)) count++;
  return count;
});
bench(`btree  BTreeMap.keys() (full traversal ${N})`, () => {
  let count = 0;
  for (const _ of hotBT.keys()) count++;
  return count;
});

// ---------------------------------------------------------------------------
// floor / ceiling
// ---------------------------------------------------------------------------
bench(`vjuga  OrderedMap.floor + ceiling × 100`, () => {
  let n = 0;
  for (let i = 0; i < 100; i++) {
    if (OM.floor(hotMap, i * 10)) n++;
    if (OM.ceiling(hotMap, i * 10)) n++;
  }
  return n;
});
bench(`btree  BTreeMap.nextLowerPair + nextHigherPair × 100`, () => {
  let n = 0;
  for (let i = 0; i < 100; i++) {
    if (hotBT.nextLowerPair(i * 10)) n++;
    if (hotBT.nextHigherPair(i * 10)) n++;
  }
  return n;
});

await run();

export {};
