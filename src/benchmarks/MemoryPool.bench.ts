declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as MemoryPool from "../MemoryPool.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

type Point = { x: number; y: number };

// --- Warm-up ---
{
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
    dispose: (p) => {
      p.x = 0;
      p.y = 0;
    },
  });
  for (let i = 0; i < 100_000; i++) {
    const obj = MemoryPool.acquire(pool);
    MemoryPool.release(pool, obj);
  }
  reportOptimizationStatus(MemoryPool.acquire, "MemoryPool.acquire");
  reportOptimizationStatus(MemoryPool.release, "MemoryPool.release");
}

// --- Benchmarks ---

bench("MemoryPool.make", () => {
  return MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
  });
});

bench("acquire/release cycle (pool with dispose)", () => {
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
    dispose: (p) => {
      p.x = 0;
      p.y = 0;
    },
  });
  const obj = MemoryPool.acquire(pool);
  obj.x = 1;
  obj.y = 2;
  MemoryPool.release(pool, obj);
});

bench("acquire/release cycle (pool without dispose)", () => {
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
  });
  const obj = MemoryPool.acquire(pool);
  MemoryPool.release(pool, obj);
});

bench("acquire from pre-warmed pool (cache hit)", () => {
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
    minSize: 10,
  });
  const obj = MemoryPool.acquire(pool);
  MemoryPool.release(pool, obj);
  // From here the pool has a free item
  return MemoryPool.acquire(pool);
});

bench("pool exhaustion and growth (10 items)", () => {
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
    maxSize: 1024,
  });
  const items: Point[] = [];
  for (let i = 0; i < 10; i++) {
    items.push(MemoryPool.acquire(pool));
  }
  for (const item of items) {
    MemoryPool.release(pool, item);
  }
});

bench("mixed workload: acquire x5, release x5 (x10 rounds)", () => {
  const pool = MemoryPool.make<Point>({
    factory: () => ({ x: 0, y: 0 }),
    dispose: (p) => {
      p.x = 0;
      p.y = 0;
    },
  });
  for (let round = 0; round < 10; round++) {
    const batch: Point[] = [];
    for (let i = 0; i < 5; i++) batch.push(MemoryPool.acquire(pool));
    for (const item of batch) MemoryPool.release(pool, item);
  }
});

bench("ArrayPool acquire/release", () => {
  const arr = MemoryPool.acquire(MemoryPool.ArrayPool);
  arr.push(1, 2, 3);
  MemoryPool.release(MemoryPool.ArrayPool, arr);
});

bench("MapPool acquire/release", () => {
  const map = MemoryPool.acquire(MemoryPool.MapPool);
  map.set("key", "value");
  MemoryPool.release(MemoryPool.MapPool, map);
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const pool = MemoryPool.make<Point>({
  factory: () => ({ x: 0, y: 0 }),
  dispose: (p) => {
    p.x = 0;
    p.y = 0;
  },
});
for (let i = 0; i < 10_000; i++) {
  const obj = MemoryPool.acquire(pool);
  MemoryPool.release(pool, obj);
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 10k MemoryPool acquire/release cycles: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
