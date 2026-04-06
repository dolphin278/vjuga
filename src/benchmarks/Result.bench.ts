import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as Result from "../Result.js";

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    const r = i % 2 === 0 ? Result.ok(i) : Result.err(i);
    Result.isOk(r);
    Result.isErr(r);
    Result.map(r as Result.Result<number, number>, (x) => x + 1);
    Result.mapErr(r as Result.Result<number, number>, (e) => e + 1);
    Result.unwrapOr(r as Result.Result<number, number>, -1);
  }
  reportOptimizationStatus(Result.ok, "Result.ok");
  reportOptimizationStatus(Result.err, "Result.err");
  reportOptimizationStatus(Result.map, "Result.map");
  reportOptimizationStatus(Result.flatMap, "Result.flatMap");
  reportOptimizationStatus(Result.unwrapOr, "Result.unwrapOr");
}

// --- Benchmarks ---

bench("Result.ok()", () => Result.ok(42));

bench("Result.err()", () => Result.err("oops"));

bench("Result.isOk() — Ok", () => Result.isOk(Result.ok(42)));

bench("Result.isOk() — Err", () => Result.isOk(Result.err("e")));

bench("Result.map() — Ok path", () => {
  return Result.map(Result.ok(2), (x) => x * 3);
});

bench("Result.map() — Err path", () => {
  return Result.map(Result.err("e") as Result.Result<number, string>, (x) => x * 3);
});

bench("Result.flatMap() — Ok→Ok chain", () => {
  return Result.flatMap(Result.ok(1), (x) => Result.ok(x + 1));
});

bench("Result.unwrapOr() — Ok", () => Result.unwrapOr(Result.ok(7), 0));

bench("Result.unwrapOr() — Err", () =>
  Result.unwrapOr(Result.err("e") as Result.Result<number, string>, 0));

bench("Result.fromThrowable() — no throw", () => Result.fromThrowable(() => 42));

bench("Result.fromThrowable() — throws", () =>
  Result.fromThrowable(() => {
    throw new Error("x");
  }));

await run();

export {};
