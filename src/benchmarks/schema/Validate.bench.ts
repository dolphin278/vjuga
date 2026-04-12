import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import { validate } from "../../schema/Validate.js";

// ---------------------------------------------------------------------------
// Schema + compiled validators
// ---------------------------------------------------------------------------

const userSchema = S.object({
  id: S.number(),
  name: S.string(),
  email: S.string(),
  active: S.boolean(),
  tags: S.array(S.string()),
});

const validUser = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  active: true,
  tags: ["admin", "user"],
};
const invalidUser = {
  id: "bad",
  name: "Alice",
  email: "alice@example.com",
  active: true,
  tags: [],
};

const compiledValidator = validate(userSchema);

// Pre-compile to measure validation cost, not compilation cost
const strValidator = validate(S.string());
const intValidator = validate(S.integer());
const arrValidator = validate(S.array(S.number()));
const tenNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    compiledValidator(validUser);
    compiledValidator(invalidUser);
    strValidator("hello");
    intValidator(42);
    arrValidator(tenNumbers);
  }
  reportOptimizationStatus(compiledValidator, "compiledValidator");
  reportOptimizationStatus(strValidator, "strValidator");
}

// --- Benchmarks ---

bench("Schema.validate — valid user (5 fields)", () => compiledValidator(validUser));
bench("Schema.validate — invalid user (first field)", () => compiledValidator(invalidUser));
bench("Schema.validate — string", () => strValidator("hello"));
bench("Schema.validate — integer", () => intValidator(42));
bench("Schema.validate — array(10 numbers)", () => arrValidator(tenNumbers));

// Discriminated union
const shapeSchema = S.union(
  S.object({ type: S.literal("circle"), r: S.number() }),
  S.object({ type: S.literal("rect"), w: S.number(), h: S.number() }),
);
const compiledShape = validate(shapeSchema);

bench("Schema.validate — discriminated union (circle)", () =>
  compiledShape({ type: "circle", r: 5 }));
bench("Schema.validate — discriminated union (rect)", () =>
  compiledShape({ type: "rect", w: 3, h: 4 }));

await run();

export {};
