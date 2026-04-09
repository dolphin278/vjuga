declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { memoize, once } from "../Memoization.js";
import type { Fn } from "../FunctionUtils.js";

// Widen a narrowly-typed function to satisfy memoize()'s generic constraint.
// memoize expects Fn<readonly unknown[], unknown>; narrow lambdas don't satisfy
// that directly because TypeScript won't widen [number] to readonly unknown[].
function widen<T extends readonly unknown[], R>(
  fn: (...args: T) => R,
): Fn<readonly unknown[], unknown> {
  return fn as unknown as Fn<readonly unknown[], unknown>;
}

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// Helpers
const add = (a: number, b: number) => a + b;
const identity = (x: number) => x;

// --- Warm-up ---
{
  const memoAdd = memoize(add);
  for (let i = 0; i < 100_000; i++) {
    memoAdd(i % 100, i % 50);
  }
  // Report the inner memoized closure, not the factory — memoize() itself is
  // only called a handful of times (once per test) so it never becomes hot.
  // The closure is what runs 100k times and gets JIT-compiled.
  reportOptimizationStatus(memoAdd, "memoized (closure)");

  // Warm up once() with enough calls to reach the JIT threshold.
  const onceAdd = once(() => 42);
  for (let i = 0; i < 100_000; i++) onceAdd();
  reportOptimizationStatus(onceAdd, "once (closure)");
}

// --- Benchmarks ---

bench("memoize: cache miss (new key each call)", () => {
  const fn = memoize(widen((x: number) => x * 2));
  return fn(Math.random());
});

bench("memoize: cache hit (same key)", () => {
  const fn = memoize(widen((x: number) => x * 2));
  fn(42); // populate cache
  return fn(42); // hit
});

bench("memoize: cache hit x10 (string key)", () => {
  const fn = memoize(widen((x: string) => x.toUpperCase()));
  fn("hello"); // populate
  for (let i = 0; i < 10; i++) fn("hello");
});

bench("memoize: numeric key via JSON.stringify", () => {
  const fn = memoize(add);
  fn(1, 2);
  return fn(1, 2);
});

bench("memoize: custom key function (fast path)", () => {
  const fn = memoize(add, { cacheKeyFn: (...args: [number, number]) => `${args[0]}:${args[1]}` });
  fn(3, 4);
  return fn(3, 4);
});

bench("memoize: many unique keys (100 misses)", () => {
  const fn = memoize(widen(identity));
  for (let i = 0; i < 100; i++) fn(i);
});

bench("memoize: custom cache (Map pre-populated)", () => {
  const cache = new Map<string, number>();
  cache.set("[42]", 84);
  const fn = memoize(widen(identity), { cache });
  return fn(42);
});

bench("once: first call (computes value)", () => {
  const fn = once(() => 42);
  return fn();
});

bench("once: subsequent calls (cached)", () => {
  const fn = once(() => 42);
  fn(); // compute
  return fn(); // cached
});

bench("once: subsequent calls x10", () => {
  const fn = once(() => 42);
  fn();
  for (let i = 0; i < 10; i++) fn();
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const memoFns: Fn<readonly unknown[], unknown>[] = [];
for (let i = 0; i < 1_000; i++) {
  const fn = memoize(widen((x: number) => x * 2));
  // Populate with 100 entries each
  for (let j = 0; j < 100; j++) fn(j);
  memoFns.push(fn);
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 1k memoize fns x100 entries: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void memoFns;
