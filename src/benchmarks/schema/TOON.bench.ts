import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import * as ST from "../../schema/TOON.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const simpleSchema = S.object({ id: S.integer(), name: S.string(), active: S.boolean() });
const tabularSchema = S.object({
  users: S.array(S.object({ id: S.integer(), name: S.string(), role: S.string() })),
});

const simpleObj = { id: 1, name: "Alice", active: true };
const tabularObj = {
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Charlie", role: "user" },
    { id: 4, name: "Diana", role: "admin" },
    { id: 5, name: "Eve", role: "user" },
  ],
};

// Compiled functions
const toonStr = ST.stringify(simpleSchema);
const toonPar = ST.parse(simpleSchema);
const toonTabStr = ST.stringify(tabularSchema);
const toonTabPar = ST.parse(tabularSchema);
const jsonStr = SJ.stringify(simpleSchema);
const jsonTabStr = SJ.stringify(tabularSchema);

// Pre-computed for parse
const simpleToon = toonStr(simpleObj);
const tabularToon = toonTabStr(tabularObj);

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    toonStr(simpleObj);
    toonPar(simpleToon);
    toonTabStr(tabularObj);
  }
  reportOptimizationStatus(toonStr, "toonStr");
  reportOptimizationStatus(toonPar, "toonPar");
  reportOptimizationStatus(toonTabStr, "toonTabStr");
}

// --- Stringify benchmarks ---

bench("TOON.stringify — 3 fields", () => toonStr(simpleObj));
bench("JSON.stringify — 3 fields (schema)", () => jsonStr(simpleObj));
bench("JSON.stringify — 3 fields (native)", () => JSON.stringify(simpleObj));

bench("TOON.stringify — tabular 5 rows", () => toonTabStr(tabularObj));
bench("JSON.stringify — tabular 5 rows (schema)", () => jsonTabStr(tabularObj));
bench("JSON.stringify — tabular 5 rows (native)", () => JSON.stringify(tabularObj));

// --- Parse benchmarks ---

bench("TOON.parse — 3 fields", () => toonPar(simpleToon));
bench("TOON.parse — tabular 5 rows", () => toonTabPar(tabularToon));

// --- Output size comparison ---
{
  const jsonSize = JSON.stringify(tabularObj).length;
  const toonSize = toonTabStr(tabularObj).length;
  console.log(
    `\n  Output size: JSON=${jsonSize} bytes, TOON=${toonSize} bytes, ratio=${((toonSize / jsonSize) * 100).toFixed(0)}%`,
  );
}

await run();

export {};
