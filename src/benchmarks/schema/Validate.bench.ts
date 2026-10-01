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

// Nested objects — exercises accessor hoisting (each level is read once)
const nestedValidator = validate(
  S.object({
    a: S.object({
      b: S.object({
        c: S.array(S.object({ x: S.number(), y: S.number(), label: S.string() })),
      }),
    }),
  }),
);
const nestedValue = {
  a: {
    b: {
      c: [
        { x: 1, y: 2, label: "p0" },
        { x: 3, y: 4, label: "p1" },
        { x: 5, y: 6, label: "p2" },
        { x: 7, y: 8, label: "p3" },
      ],
    },
  },
};

// Extra key — rejected by the default `additionalProperties: false`
const extraKeyUser = { ...validUser, extra: 1 };
// Open object — `additionalProperties: true` skips the extra-key scan
const openValidator = validate(
  S.object(
    {
      id: S.number(),
      name: S.string(),
      email: S.string(),
      active: S.boolean(),
      tags: S.array(S.string()),
    },
    { additionalProperties: true },
  ),
);

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    compiledValidator(validUser);
    compiledValidator(invalidUser);
    strValidator("hello");
    intValidator(42);
    arrValidator(tenNumbers);
    nestedValidator(nestedValue);
    compiledValidator(extraKeyUser);
    openValidator(validUser);
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
bench("Schema.validate — nested objects (3 levels + array of 4)", () =>
  nestedValidator(nestedValue));
bench("Schema.validate — extra key (5 fields + 1)", () => compiledValidator(extraKeyUser));
bench("Schema.validate — open object (additionalProperties: true)", () => openValidator(validUser));

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
