import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";

// Methodology: every stringify benchmark consumes its output with
// `Buffer.byteLength`, as a real writer (socket, file) would. Generated
// stringify builds a cons-string (rope) that is only flattened when read —
// measuring creation alone hides that cost and overstated the speedup ~10x.
// Inputs rotate through a pool of varied objects so V8 cannot constant-fold.

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
const arraySchema = S.array(S.object({ id: S.integer(), name: S.string() }));

const POOL = 1024;
const MASK = POOL - 1;
const names = ["Alice", "Bob", "Charlie", "Dana O'Neil", 'Eve "E"', "Frank\tTab", "Grace"];
const simpleObjs = Array.from({ length: POOL }, (_, i) => ({ id: i * 7919, name: names[i % 7] }));
const mediumObjs = Array.from({ length: POOL }, (_, i) => ({
  id: i,
  name: names[i % 7],
  email: names[(i + 3) % 7].toLowerCase().replace(/\W/g, "") + i + "@example.com",
  active: (i & 1) === 0,
  score: (i * 1.37) % 100,
}));
const nestedObjs = Array.from({ length: POOL }, (_, i) => ({
  user: { name: names[i % 7], age: 18 + (i % 60) },
  tags: names.slice(0, i % 5),
}));
const arrays = Array.from({ length: 16 }, (_, k) =>
  Array.from({ length: 100 }, (_, i) => ({ id: i + k, name: names[(i + k) % 7] })),
);

// Compiled functions
const simpleStr = SJ.stringify(simpleSchema);
const mediumStr = SJ.stringify(mediumSchema);
const nestedStr = SJ.stringify(nestedSchema);
const arrayStr = SJ.stringify(arraySchema);
const simplePar = SJ.parse(simpleSchema);
const mediumPar = SJ.parse(mediumSchema);

// Pre-computed JSON for parse benchmarks
const simpleJsons = simpleObjs.map((o) => JSON.stringify(o));
const mediumJsons = mediumObjs.map((o) => JSON.stringify(o));

let i = 0;

// --- Warm-up ---
{
  for (let k = 0; k < 100_000; k++) {
    Buffer.byteLength(simpleStr(simpleObjs[k & MASK]));
    Buffer.byteLength(mediumStr(mediumObjs[k & MASK]));
    Buffer.byteLength(nestedStr(nestedObjs[k & MASK]));
    simplePar(simpleJsons[k & MASK]);
    mediumPar(mediumJsons[k & MASK]);
  }
  reportOptimizationStatus(simpleStr, "simpleStr");
  reportOptimizationStatus(mediumStr, "mediumStr");
  reportOptimizationStatus(simplePar, "simplePar");
}

// --- Stringify benchmarks (output consumed) ---

bench("Schema.stringify — 2 fields", () => Buffer.byteLength(simpleStr(simpleObjs[i++ & MASK])));
bench("JSON.stringify — 2 fields", () => Buffer.byteLength(JSON.stringify(simpleObjs[i++ & MASK])));

bench("Schema.stringify — 5 fields", () => Buffer.byteLength(mediumStr(mediumObjs[i++ & MASK])));
bench("JSON.stringify — 5 fields", () => Buffer.byteLength(JSON.stringify(mediumObjs[i++ & MASK])));

bench("Schema.stringify — nested", () => Buffer.byteLength(nestedStr(nestedObjs[i++ & MASK])));
bench("JSON.stringify — nested", () => Buffer.byteLength(JSON.stringify(nestedObjs[i++ & MASK])));

bench("Schema.stringify — 100-elem array", () => Buffer.byteLength(arrayStr(arrays[i++ & 15])));
bench("JSON.stringify — 100-elem array", () => Buffer.byteLength(JSON.stringify(arrays[i++ & 15])));

// --- Parse benchmarks ---

bench("Schema.parse — 2 fields", () => simplePar(simpleJsons[i++ & MASK]));
bench("JSON.parse — 2 fields", () => JSON.parse(simpleJsons[i++ & MASK]));

bench("Schema.parse — 5 fields", () => mediumPar(mediumJsons[i++ & MASK]));
bench("JSON.parse — 5 fields", () => JSON.parse(mediumJsons[i++ & MASK]));

await run();

export {};
