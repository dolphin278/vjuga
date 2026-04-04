declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as Queue from "../Queue.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// --- Warm-up ---
{
  const q = Queue.make<number>();
  for (let i = 0; i < 100_000; i++) {
    Queue.push(q, i);
    Queue.shift(q);
  }
  reportOptimizationStatus(Queue.push, "Queue.push");
  reportOptimizationStatus(Queue.shift, "Queue.shift");
  reportOptimizationStatus(Queue.pop, "Queue.pop");
  reportOptimizationStatus(Queue.unshift, "Queue.unshift");
}

// --- Benchmarks ---

bench("Queue.make (empty)", () => {
  return Queue.make();
});

bench("Queue.push (single)", () => {
  const q = Queue.make<number>();
  Queue.push(q, 1);
});

bench("Queue.shift (single)", () => {
  const q = Queue.make<number>();
  Queue.push(q, 1);
  return Queue.shift(q);
});

bench("Queue.pop (single)", () => {
  const q = Queue.make<number>();
  Queue.push(q, 1);
  return Queue.pop(q);
});

bench("Queue.unshift (single)", () => {
  const q = Queue.make<number>();
  Queue.unshift(q, 1);
});

bench("Queue.push x100", () => {
  const q = Queue.make<number>();
  for (let i = 0; i < 100; i++) Queue.push(q, i);
  return q;
});

bench("Queue.shift x100 (after push x100)", () => {
  const q = Queue.make<number>();
  for (let i = 0; i < 100; i++) Queue.push(q, i);
  for (let i = 0; i < 100; i++) Queue.shift(q);
});

bench("Queue.growList (trigger resize at 4 elements)", () => {
  // Default capacity is 4; push 4 elements to trigger growList
  const q = Queue.make<number>();
  Queue.push(q, 1);
  Queue.push(q, 2);
  Queue.push(q, 3);
  Queue.push(q, 4);
  // 5th push triggers growList
  Queue.push(q, 5);
  return q;
});

bench("Queue mixed push/shift cycle (100 iterations)", () => {
  const q = Queue.make<number>();
  for (let i = 0; i < 100; i++) {
    Queue.push(q, i);
    Queue.shift(q);
  }
});

bench("Queue size (non-empty)", () => {
  const q = Queue.make<number>([1, 2, 3, 4, 5]);
  return Queue.size(q);
});

bench("Queue.toArray (10 elements)", () => {
  const q = Queue.make<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return Queue.toArray(q);
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const queues: ReturnType<typeof Queue.make>[] = [];
for (let i = 0; i < 10_000; i++) {
  const q = Queue.make<number>();
  for (let j = 0; j < 10; j++) Queue.push(q, j);
  queues.push(q);
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 10k Queue(10 items): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void queues;
