import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as Validator from "../Validator.js";

// Sample schema: a realistic "user" object.
const userValidator = Validator.object({
  id: Validator.number(),
  name: Validator.string(),
  email: Validator.string(),
  active: Validator.boolean(),
  tags: Validator.array(Validator.string()),
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

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    userValidator(validUser);
    userValidator(invalidUser);
  }
  reportOptimizationStatus(userValidator, "userValidator");
}

// --- Benchmarks ---

bench("string() — valid", () => Validator.string()("hello"));
bench("number() — valid", () => Validator.number()(42));
bench("boolean() — valid", () => Validator.boolean()(true));

bench("object() — valid user", () => userValidator(validUser));
bench("object() — invalid user (first field fails)", () => userValidator(invalidUser));

bench("array() — 10 numbers", () => {
  const v = Validator.array(Validator.number());
  return v([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

bench("union(string | number) — string branch", () => {
  const v = Validator.union([Validator.string(), Validator.number()] as const);
  return v("hello");
});

bench("union(string | number) — number branch (second)", () => {
  const v = Validator.union([Validator.string(), Validator.number()] as const);
  return v(42);
});

bench("optional(string) — undefined", () => Validator.optional(Validator.string())(undefined));
bench("optional(string) — present", () => Validator.optional(Validator.string())("hi"));

bench("map(string, toUpperCase)", () => {
  const v = Validator.map(Validator.string(), (s) => s.toUpperCase());
  return v("hello");
});

await run();

export {};
