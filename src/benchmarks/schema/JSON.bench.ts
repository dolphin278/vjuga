import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const simpleSchema = S.object({ id: S.integer(), name: S.string() });
const mediumSchema = S.object({
  id: S.integer(),
  name: S.string(),
  email: S.string(),
  active: S.boolean(),
  score: S.number(),
});
const nestedSchema = S.object({
  user: S.object({ name: S.string(), age: S.integer() }),
  tags: S.array(S.string()),
});

const simpleObj = { id: 1, name: "Alice" };
const mediumObj = { id: 1, name: "Alice", email: "alice@example.com", active: true, score: 95.5 };
const nestedObj = { user: { name: "Alice", age: 30 }, tags: ["admin", "user"] };

// Compiled functions
const simpleStr = SJ.stringify(simpleSchema);
const mediumStr = SJ.stringify(mediumSchema);
const nestedStr = SJ.stringify(nestedSchema);
const simplePar = SJ.parse(simpleSchema);
const mediumPar = SJ.parse(mediumSchema);

// Pre-computed JSON for parse benchmarks
const simpleJson = simpleStr(simpleObj);
const mediumJson = mediumStr(mediumObj);

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    simpleStr(simpleObj);
    mediumStr(mediumObj);
    nestedStr(nestedObj);
    simplePar(simpleJson);
    mediumPar(mediumJson);
  }
  reportOptimizationStatus(simpleStr, "simpleStr");
  reportOptimizationStatus(mediumStr, "mediumStr");
  reportOptimizationStatus(simplePar, "simplePar");
}

// --- Stringify benchmarks ---

bench("Schema.stringify — 2 fields", () => simpleStr(simpleObj));
bench("JSON.stringify — 2 fields", () => JSON.stringify(simpleObj));

bench("Schema.stringify — 5 fields", () => mediumStr(mediumObj));
bench("JSON.stringify — 5 fields", () => JSON.stringify(mediumObj));

bench("Schema.stringify — nested", () => nestedStr(nestedObj));
bench("JSON.stringify — nested", () => JSON.stringify(nestedObj));

// --- Parse benchmarks ---

bench("Schema.parse — 2 fields", () => simplePar(simpleJson));
bench("JSON.parse — 2 fields", () => JSON.parse(simpleJson));

bench("Schema.parse — 5 fields", () => mediumPar(mediumJson));
bench("JSON.parse — 5 fields", () => JSON.parse(mediumJson));

await run();

export {};
