declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import * as WP from "../WorkerPool.js";

const echoUrl = "data:text/javascript," + encodeURIComponent("export default (x) => x;");

const gc = (): void => {
  if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// --- Benchmarks ---

bench("WorkerPool.make + destroy (1 thread)", async () => {
  const pool = WP.make({ filename: echoUrl, maxThreads: 1 });
  await WP.destroy(pool);
});

bench("WorkerPool.run echo task (1 thread)", async () => {
  const pool = WP.make({ filename: echoUrl, maxThreads: 1 });
  await WP.run(pool, 42);
  await WP.destroy(pool);
});

bench("WorkerPool.run 100 tasks (4 threads)", async () => {
  const pool = WP.make({ filename: echoUrl, maxThreads: 4 });
  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    tasks.push(WP.run(pool, i));
  }
  await Promise.all(tasks);
  await WP.destroy(pool);
});

bench("WorkerPool.run 1000 tasks (4 threads)", async () => {
  const pool = WP.make({ filename: echoUrl, maxThreads: 4 });
  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < 1000; i++) {
    tasks.push(WP.run(pool, i));
  }
  await Promise.all(tasks);
  await WP.destroy(pool);
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const pool = WP.make({ filename: echoUrl, maxThreads: 4 });
const tasks: Promise<unknown>[] = [];
for (let i = 0; i < 1000; i++) {
  tasks.push(WP.run(pool, i));
}
await Promise.all(tasks);
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] WorkerPool after 1000 task cycles: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
await WP.destroy(pool);

export {};
