declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as Ref from "../Ref.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// --- Warm-up ---
{
  const ref = Ref.make(0);
  for (let i = 0; i < 100_000; i++) {
    Ref.set(ref, i);
    Ref.get(ref);
  }
  reportOptimizationStatus(Ref.make, "Ref.make");
  reportOptimizationStatus(Ref.set, "Ref.set");
  reportOptimizationStatus(Ref.get, "Ref.get");
}

// --- Benchmarks ---

bench("Ref.make (plain object)", () => {
  return Ref.make(42);
});

bench("Ref.make via Object.create(null)", () => {
  const cell = Object.create(null);
  cell.contents = 42;
  return cell;
});

bench("Ref.make via {} literal", () => {
  return { contents: 42 };
});

bench("Ref.set", () => {
  const ref = Ref.make(0);
  Ref.set(ref, 1);
});

bench("Ref.get", () => {
  const ref = Ref.make(42);
  return Ref.get(ref);
});

bench("Ref.get + Ref.set cycle (10x)", () => {
  const ref = Ref.make(0);
  for (let i = 0; i < 10; i++) {
    Ref.set(ref, Ref.get(ref) + 1);
  }
  return Ref.get(ref);
});

// Investigation: Object.create(null) vs {} for internal cell — compare allocation shapes
bench("cell: Object.create(null) + property assignment", () => {
  const cell = Object.create(null) as { contents: number };
  cell.contents = 99;
  return cell.contents;
});

bench("cell: {} literal", () => {
  const cell = { contents: 99 };
  return cell.contents;
});

// Object.seal comparison
bench("Ref.make then Object.seal", () => {
  const ref = Ref.make(0);
  Object.seal(ref);
  return ref;
});

bench("Ref.make no seal", () => {
  return Ref.make(0);
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const refs: ReturnType<typeof Ref.make>[] = [];
for (let i = 0; i < 100_000; i++) {
  refs.push(Ref.make(i));
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(`[memory] 100k Ref.make: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`);
void refs;
