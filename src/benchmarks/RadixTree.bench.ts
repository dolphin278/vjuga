import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as RadixTree from "../RadixTree.js";

const NUM_KEYS = 1000;

// Pre-generate keys to avoid string allocation noise in benchmarks.
const keys: string[] = Array(NUM_KEYS);
for (let i = 0; i < NUM_KEYS; i++) {
  keys[i] = "/api/v1/resource/" + i.toString();
}

// --- Warm-up ---
{
  const tree = RadixTree.make<number>();
  for (let i = 0; i < 100_000; i++) {
    RadixTree.insert(tree, keys[i % NUM_KEYS], i);
    RadixTree.lookup(tree, keys[i % NUM_KEYS]);
    RadixTree.has(tree, keys[i % NUM_KEYS]);
  }
  reportOptimizationStatus(RadixTree.insert, "RadixTree.insert");
  reportOptimizationStatus(RadixTree.lookup, "RadixTree.lookup");
  reportOptimizationStatus(RadixTree.has, "RadixTree.has");
  reportOptimizationStatus(RadixTree.remove, "RadixTree.remove");
  reportOptimizationStatus(RadixTree.prefixMatch, "RadixTree.prefixMatch");
}

// Pre-built tree for lookup/has benchmarks.
const hotTree = RadixTree.make<number>();
for (let i = 0; i < NUM_KEYS; i++) RadixTree.insert(hotTree, keys[i], i);

// --- Benchmarks ---

bench("RadixTree.make", () => RadixTree.make<number>());

bench("RadixTree.insert — 1000 keys", () => {
  const t = RadixTree.make<number>();
  for (let i = 0; i < NUM_KEYS; i++) RadixTree.insert(t, keys[i], i);
});

bench("RadixTree.lookup — hit", () => {
  let sum = 0;
  for (let i = 0; i < NUM_KEYS; i++) sum += RadixTree.lookup(hotTree, keys[i]) ?? 0;
  return sum;
});

bench("RadixTree.lookup — miss", () => {
  let hit = 0;
  for (let i = 0; i < NUM_KEYS; i++) {
    if (RadixTree.lookup(hotTree, "/nonexistent/" + i.toString()) !== undefined) hit++;
  }
  return hit;
});

bench("RadixTree.has — hit", () => {
  let count = 0;
  for (let i = 0; i < NUM_KEYS; i++) {
    if (RadixTree.has(hotTree, keys[i])) count++;
  }
  return count;
});

bench("RadixTree.remove — remove all then re-insert", () => {
  const t = RadixTree.make<number>();
  for (let i = 0; i < NUM_KEYS; i++) RadixTree.insert(t, keys[i], i);
  for (let i = 0; i < NUM_KEYS; i++) RadixTree.remove(t, keys[i]);
});

bench("RadixTree.prefixMatch — broad prefix", () => {
  return RadixTree.prefixMatch(hotTree, "/api");
});

bench("RadixTree.prefixMatch — narrow prefix", () => {
  return RadixTree.prefixMatch(hotTree, "/api/v1/resource/1");
});

await run();

export {};
