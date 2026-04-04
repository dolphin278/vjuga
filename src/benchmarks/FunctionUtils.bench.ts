declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { pipe, partial, partialNamed, tupled, spread, tuple } from "../FunctionUtils.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

const inc = (x: number) => x + 1;
const double = (x: number) => x * 2;
const square = (x: number) => x * x;
const negate = (x: number) => -x;
const abs = (x: number) => Math.abs(x);

// --- Warm-up ---
{
  const p2 = pipe(inc, double);
  const p5 = pipe(inc, double, square, negate, abs);
  const pN = pipe(inc, double, square, negate, abs, inc, double);
  for (let i = 0; i < 100_000; i++) {
    p2(i);
    p5(i);
    pN(i);
  }
  reportOptimizationStatus(pipe, "pipe");
  reportOptimizationStatus(partial, "partial");
}

// --- Benchmarks ---

bench("pipe: 1-arg (identity)", () => {
  const p = pipe(inc);
  return p(0);
});

bench("pipe: 2-arg", () => {
  const p = pipe(inc, double);
  return p(1);
});

bench("pipe: 3-arg", () => {
  const p = pipe(inc, double, square);
  return p(1);
});

bench("pipe: 4-arg", () => {
  const p = pipe(inc, double, square, negate);
  return p(1);
});

bench("pipe: 5-arg", () => {
  const p = pipe(inc, double, square, negate, abs);
  return p(1);
});

bench("pipe: N-arg (7 fns — spread allocation path)", () => {
  const p = pipe(inc, double, square, negate, abs, inc, double);
  return p(1);
});

bench("pipe: 2-arg call (pre-created)", () => {
  const p = pipe(inc, double);
  return p(5);
});

bench("pipe: 5-arg call (pre-created)", () => {
  const p = pipe(inc, double, square, negate, abs);
  return p(5);
});

bench("pipe: N-arg call (pre-created, 7 fns)", () => {
  const p = pipe(inc, double, square, negate, abs, inc, double);
  return p(5);
});

bench("partial: bind one arg", () => {
  const addOne = partial(inc);
  return addOne(5);
});

bench("partialNamed: bind partial named args", () => {
  const fn = (opts: { a: number; b: number }) => opts.a + opts.b;
  const withA = partialNamed(fn, { a: 10 });
  return withA({ b: 5 });
});

bench("tupled: call tupled fn", () => {
  const tupledInc = tupled(inc);
  return tupledInc([5]);
});

bench("spread: call spread fn", () => {
  const spreadFn = spread((arr: number[]) => arr[0] + arr[1]);
  return spreadFn(1, 2);
});

bench("tuple: create tuple", () => {
  return tuple(1, 2, 3);
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const pipes: Function[] = [];
for (let i = 0; i < 100_000; i++) {
  pipes.push(pipe(inc, double));
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 100k pipe(2) instances: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void pipes;
