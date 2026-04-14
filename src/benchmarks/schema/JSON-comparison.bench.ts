/**
 * Head-to-head comparison of vjuga Schema.stringify vs fast-json-stringify
 * (the Fastify team's code-generated JSON serializer) vs native JSON.stringify.
 *
 * All three use the same data. fast-json-stringify uses JSON Schema definition,
 * vjuga uses Schema DSL — both compile at init time.
 */
import { bench, run, group } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import fastJsonStringify from "fast-json-stringify";

// ---------------------------------------------------------------------------
// Schemas — small (2 fields)
// ---------------------------------------------------------------------------

const smallSchema = S.object({ id: S.integer(), name: S.string() });
const smallFJS = fastJsonStringify({
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
  },
  required: ["id", "name"],
});
const smallVjuga = SJ.stringify(smallSchema);
const smallObj = { id: 1, name: "Alice" };

// ---------------------------------------------------------------------------
// Schemas — medium (5 fields)
// ---------------------------------------------------------------------------

const mediumSchema = S.object({
  id: S.integer(),
  name: S.string(),
  email: S.string(),
  active: S.boolean(),
  score: S.number(),
});
const mediumFJS = fastJsonStringify({
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    email: { type: "string" },
    active: { type: "boolean" },
    score: { type: "number" },
  },
  required: ["id", "name", "email", "active", "score"],
});
const mediumVjuga = SJ.stringify(mediumSchema);
const mediumObj = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  active: true,
  score: 95.5,
};

// ---------------------------------------------------------------------------
// Schemas — nested
// ---------------------------------------------------------------------------

const nestedSchema = S.object({
  user: S.object({ name: S.string(), age: S.integer() }),
  tags: S.array(S.string()),
});
const nestedFJS = fastJsonStringify({
  type: "object",
  properties: {
    user: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["user", "tags"],
});
const nestedVjuga = SJ.stringify(nestedSchema);
const nestedObj = {
  user: { name: "Alice", age: 30 },
  tags: ["admin", "user", "moderator"],
};

// ---------------------------------------------------------------------------
// Schemas — large array of objects
// ---------------------------------------------------------------------------

const arraySchema = S.array(S.object({ id: S.integer(), name: S.string(), role: S.string() }));
const arrayFJS = fastJsonStringify({
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      role: { type: "string" },
    },
    required: ["id", "name", "role"],
  },
});
const arrayVjuga = SJ.stringify(arraySchema);
const arrayObj = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  name: "User" + i,
  role: i % 3 === 0 ? "admin" : "user",
}));

// ---------------------------------------------------------------------------
// Warm-up — critical for JIT compilation
// ---------------------------------------------------------------------------
{
  for (let i = 0; i < 100_000; i++) {
    smallVjuga(smallObj);
    smallFJS(smallObj);
    JSON.stringify(smallObj);
    mediumVjuga(mediumObj);
    mediumFJS(mediumObj);
    nestedVjuga(nestedObj);
    nestedFJS(nestedObj);
  }
  // Fewer iterations for the large array
  for (let i = 0; i < 10_000; i++) {
    arrayVjuga(arrayObj);
    arrayFJS(arrayObj);
  }
  reportOptimizationStatus(smallVjuga, "vjuga-small");
  reportOptimizationStatus(smallFJS, "fjs-small");
  reportOptimizationStatus(mediumVjuga, "vjuga-medium");
  reportOptimizationStatus(mediumFJS, "fjs-medium");
}

// --- Correctness check ---
{
  const vj = smallVjuga(smallObj);
  const fj = smallFJS(smallObj);
  const nj = JSON.stringify(smallObj);
  if (vj !== nj || fj !== nj) {
    console.error("Output mismatch!", { vj, fj, nj });
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

group("2 fields", () => {
  bench("vjuga Schema.stringify", () => smallVjuga(smallObj));
  bench("fast-json-stringify", () => smallFJS(smallObj));
  bench("JSON.stringify", () => JSON.stringify(smallObj));
});

group("5 fields", () => {
  bench("vjuga Schema.stringify", () => mediumVjuga(mediumObj));
  bench("fast-json-stringify", () => mediumFJS(mediumObj));
  bench("JSON.stringify", () => JSON.stringify(mediumObj));
});

group("nested (object + array)", () => {
  bench("vjuga Schema.stringify", () => nestedVjuga(nestedObj));
  bench("fast-json-stringify", () => nestedFJS(nestedObj));
  bench("JSON.stringify", () => JSON.stringify(nestedObj));
});

group("100-element array of objects", () => {
  bench("vjuga Schema.stringify", () => arrayVjuga(arrayObj));
  bench("fast-json-stringify", () => arrayFJS(arrayObj));
  bench("JSON.stringify", () => JSON.stringify(arrayObj));
});

await run();

export {};
