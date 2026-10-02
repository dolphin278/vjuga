import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import {
  now,
  isoTimestamp,
  fromDate,
  toDate,
  validator,
  isRfc3339DateTime,
  isRfc3339Time,
} from "../ISOTimestamp.js";

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

bench("ISOTimestamp.isoTimestamp() (microseconds)", () => {
  return isoTimestamp("2024-01-15T10:30:00.123456Z");
});

bench("ISOTimestamp.toDate() (nanoseconds, truncated)", () => {
  return toDate("2024-01-15T10:30:00.123456789Z" as never);
});

bench("ISOTimestamp.isRfc3339DateTime()", () => {
  return isRfc3339DateTime("2024-01-15T10:30:00.123456+05:30");
});

bench("ISOTimestamp.isRfc3339Time()", () => {
  return isRfc3339Time("10:30:00.123Z");
});

await run();
