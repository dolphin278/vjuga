import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as PQ from "../PriorityQueue.js";

const numCmp: PQ.Comparator<number> = (a, b) => a - b;
const N = 1000;

// --- Warm-up ---
{
  const pq = PQ.make(numCmp);
  for (let i = 0; i < 100_000; i++) {
    PQ.push(pq, i);
    PQ.pop(pq);
  }
  reportOptimizationStatus(PQ.push, "PQ.push");
  reportOptimizationStatus(PQ.pop, "PQ.pop");
  reportOptimizationStatus(PQ.peek, "PQ.peek");
}

// --- Benchmarks ---

bench("PQ.make (empty)", () => PQ.make(numCmp));

bench(`PQ.push x${N}`, () => {
  const pq = PQ.make(numCmp);
  for (let i = N - 1; i >= 0; i--) PQ.push(pq, i); // worst-case insertion order
  return pq;
});

bench(`PQ.pop x${N} (after push x${N})`, () => {
  const pq = PQ.make(numCmp);
  for (let i = N - 1; i >= 0; i--) PQ.push(pq, i);
  for (let i = 0; i < N; i++) PQ.pop(pq);
});

bench(`PQ.heapify x${N}`, () => {
  const items: number[] = Array.from({ length: N }, (_, i) => N - i);
  return PQ.make(numCmp, items);
});

bench(`PQ.peek (non-empty)`, () => {
  const pq = PQ.make(numCmp);
  for (let i = 5; i >= 1; i--) PQ.push(pq, i);
  return PQ.peek(pq);
});

// Comparison: heap sort via PQ vs Array.sort
bench(`PQ heap-sort ${N} items`, () => {
  const items: number[] = Array.from({ length: N }, (_, i) => N - i);
  const pq = PQ.make(numCmp, items);
  const out: number[] = Array(N);
  for (let i = 0; i < N; i++) out[i] = PQ.pop(pq) as number;
  return out;
});

bench(`Array.sort ${N} items (reference)`, () => {
  const items: number[] = Array.from({ length: N }, (_, i) => N - i);
  return items.sort((a, b) => a - b);
});

await run();

export {};
