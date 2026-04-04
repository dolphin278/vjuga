declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as Deferred from "../Deferred.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    const d = Deferred.make<number>();
    d.resolve(i);
  }
  reportOptimizationStatus(Deferred.make, "Deferred.make");
}

// --- Benchmarks ---

bench("Deferred.make (creation only)", () => {
  return Deferred.make<number>();
});

bench("Deferred.make + resolve", async () => {
  const d = Deferred.make<number>();
  d.resolve(42);
  return d.promise;
});

bench("Deferred.make + reject + catch", async () => {
  const d = Deferred.make<number>();
  d.reject(new Error("test"));
  return d.promise.catch(() => undefined);
});

bench("Deferred: resolve then await", async () => {
  const d = Deferred.make<number>();
  d.resolve(1);
  return await d.promise;
});

bench("Deferred: concurrent resolve of 10", async () => {
  const deferreds = Array.from({ length: 10 }, () => Deferred.make<number>());
  for (let i = 0; i < deferreds.length; i++) deferreds[i].resolve(i);
  return Promise.all(deferreds.map((d) => d.promise));
});

bench("Deferred: pass promise between async fns", async () => {
  const d = Deferred.make<string>();
  const consumer = async () => d.promise;
  const producer = () => {
    d.resolve("hello");
  };
  const [result] = await Promise.all([consumer(), Promise.resolve().then(producer)]);
  return result;
});

bench("Deferred vs Promise.withResolvers baseline", async () => {
  // Compare against native if available
  if (typeof Promise.withResolvers === "function") {
    const { promise, resolve } = Promise.withResolvers<number>();
    resolve(42);
    return promise;
  }
  const d = Deferred.make<number>();
  d.resolve(42);
  return d.promise;
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const deferreds: ReturnType<typeof Deferred.make>[] = [];
for (let i = 0; i < 100_000; i++) {
  deferreds.push(Deferred.make());
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 100k Deferred.make (unresolved): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
// Clean up to avoid unhandled rejections
for (const d of deferreds) d.resolve(undefined);
void deferreds;
