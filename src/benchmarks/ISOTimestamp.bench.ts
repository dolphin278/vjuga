import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { now, isoTimestamp, fromDate, toDate, validator } from "../ISOTimestamp.js";

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    now();
  }
  reportOptimizationStatus(now, "ISOTimestamp.now");
  reportOptimizationStatus(fromDate, "ISOTimestamp.fromDate");
  reportOptimizationStatus(isoTimestamp, "ISOTimestamp.isoTimestamp");
}

// --- Benchmarks ---

bench("ISOTimestamp.now()", () => {
  return now();
});

bench("new Date().toISOString() (baseline)", () => {
  return new Date().toISOString();
});

bench("ISOTimestamp.isoTimestamp() (validation)", () => {
  return isoTimestamp("2024-01-15T10:30:00.000Z");
});

bench("ISOTimestamp.fromDate()", () => {
  const d = new Date();
  return fromDate(d);
});

bench("ISOTimestamp.toDate()", () => {
  const ts = now();
  return toDate(ts);
});

bench("ISOTimestamp.validator() (valid)", () => {
  const v = validator();
  return v("2024-01-15T10:30:00.000Z");
});

await run();
