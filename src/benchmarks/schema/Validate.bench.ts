import { bench, run } from "mitata";
import { reportOptimizationStatus } from "../_v8.js";
import * as S from "../../schema/Schema.js";
import { validate } from "../../schema/Validate.js";
import * as Validator from "../../Validator.js";

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

// Closure-based validator (existing Validator module) for comparison
const closureValidator = Validator.object({
  id: Validator.number(),
  name: Validator.string(),
  email: Validator.string(),
  active: Validator.boolean(),
  tags: Validator.array(Validator.string()),
});

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    compiledValidator(validUser);
    compiledValidator(invalidUser);
    closureValidator(validUser);
    closureValidator(invalidUser);
  }
  reportOptimizationStatus(compiledValidator, "compiledValidator");
  reportOptimizationStatus(closureValidator, "closureValidator");
}

// --- Benchmarks ---

bench("Schema.validate — valid user (5 fields)", () => compiledValidator(validUser));
bench("Validator.object — valid user (5 fields)", () => closureValidator(validUser));

bench("Schema.validate — invalid user (first field)", () => compiledValidator(invalidUser));
bench("Validator.object — invalid user (first field)", () => closureValidator(invalidUser));

bench("Schema.validate — string", () => validate(S.string())("hello"));
bench("Validator.string", () => Validator.string()("hello"));

bench("Schema.validate — integer", () => validate(S.integer())(42));
bench("Validator.integer", () => Validator.integer()(42));

bench("Schema.validate — array(10 numbers)", () => {
  const v = validate(S.array(S.number()));
  return v([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
bench("Validator.array(10 numbers)", () => {
  const v = Validator.array(Validator.number());
  return v([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

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
