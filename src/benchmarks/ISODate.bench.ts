import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { isoDate, isISODate, fromDate, today, addDays, toDate, validator } from "../ISODate.js";

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    isoDate("2024-01-15");
    addDays("2024-01-15" as never, i % 400);
  }
  reportOptimizationStatus(isoDate, "ISODate.isoDate");
  reportOptimizationStatus(addDays, "ISODate.addDays");
}

const d = isoDate("2024-02-28");
const date = new Date("2024-03-01T12:00:00Z");
const v = validator();

bench("ISODate.isoDate() (validation)", () => isoDate("2024-01-15"));
bench("ISODate.isISODate() (invalid day)", () => isISODate("2023-02-29"));
bench("ISODate.fromDate()", () => fromDate(date));
bench("toISOString().slice(0, 10) (baseline)", () => date.toISOString().slice(0, 10));
bench("ISODate.today()", () => today());
bench("ISODate.addDays(+1)", () => addDays(d, 1));
bench("ISODate.addDays(-365)", () => addDays(d, -365));
bench("ISODate.toDate()", () => toDate(d));
bench("ISODate.validator() (valid)", () => v("2024-01-15"));

await run();
