import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { v4, v7, uuid } from "../UUID.js";

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    v4();
    v7();
  }
  reportOptimizationStatus(v4, "UUID.v4");
  reportOptimizationStatus(v7, "UUID.v7");
}

// --- Benchmarks ---

bench("UUID.v4()", () => {
  return v4();
});

bench("UUID.v7()", () => {
  return v7();
});

bench("UUID.uuid() (validation, lowercase)", () => {
  return uuid("550e8400-e29b-41d4-a716-446655440000");
});

bench("UUID.uuid() (validation, uppercase)", () => {
  return uuid("550E8400-E29B-41D4-A716-446655440000");
});

await run();
