import { test } from "node:test";
import * as S from "../../../schema/Schema.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";

const NUM_RUNS = 1_000_000;

// ---------------------------------------------------------------------------
// toJsonSchema → fromJsonSchema round-trip
// ---------------------------------------------------------------------------

test("string schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.record({ minLength: Arb.nat(100), maxLength: Arb.nat(100) }),
    (c) => {
      const s = S.string({ minLength: c.minLength, maxLength: c.maxLength });
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "string";
    },
    { numRuns: NUM_RUNS },
  );
});

test("number schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.record({ minimum: Arb.float(), maximum: Arb.float() }),
    (c) => {
      const s = S.number({ minimum: c.minimum, maximum: c.maximum });
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "number";
    },
    { numRuns: NUM_RUNS },
  );
});

test("integer schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.integer(-1000, 1000),
    (n) => {
      const s = S.integer({ minimum: n });
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "integer";
    },
    { numRuns: NUM_RUNS },
  );
});

test("literal schema round-trips through JSON Schema", () => {
  const literals = Arb.oneOf(
    Arb.string() as Arb.Arbitrary<string | number | boolean | null>,
    Arb.integer() as Arb.Arbitrary<string | number | boolean | null>,
    Arb.boolean() as Arb.Arbitrary<string | number | boolean | null>,
    Arb.constant(null as string | number | boolean | null),
  );
  Prop.assert(
    literals,
    (v) => {
      const s = S.literal(v);
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "literal";
    },
    { numRuns: NUM_RUNS },
  );
});

test("enum schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.array(Arb.string(), { minLength: 1, maxLength: 10 }),
    (values) => {
      const s = S.enum_(...values);
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "enum";
    },
    { numRuns: NUM_RUNS },
  );
});

test("object schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.string(),
    (key) => {
      const s = S.object({ [key]: S.string() });
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "object";
    },
    { numRuns: NUM_RUNS },
  );
});

test("array schema round-trips through JSON Schema", () => {
  Prop.assert(
    Arb.nat(100),
    (maxItems) => {
      const s = S.array(S.integer(), { maxItems });
      const r = S.fromJsonSchema(S.toJsonSchema(s));
      return r[0] === true && r[1].kind === "array";
    },
    { numRuns: NUM_RUNS },
  );
});

test("nullable schema round-trips through JSON Schema", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.nullable(S.string())));
  if (!r[0] || r[1].kind !== "nullable") throw new Error("round-trip failed");
});

// ---------------------------------------------------------------------------
// Builder invariants
// ---------------------------------------------------------------------------

test("all builders produce {kind, meta} shape", () => {
  const schemas: S.Schema[] = [
    S.string(),
    S.number(),
    S.integer(),
    S.boolean(),
    S.null_(),
    S.literal("x"),
    S.enum_("a", "b"),
    S.object({ x: S.string() }),
    S.array(S.string()),
    S.tuple(S.string()),
    S.record(S.string()),
    S.union(S.string(), S.number()),
    S.optional(S.string()),
    S.nullable(S.string()),
  ];
  for (const s of schemas) {
    if (!("kind" in s && "meta" in s))
      throw new Error("missing kind or meta on " + JSON.stringify(s));
  }
});

test("isPrimitive returns true for leaf schemas", () => {
  Prop.assert(
    Arb.string(),
    (v) => {
      return (
        S.isPrimitive(S.string()) &&
        S.isPrimitive(S.number()) &&
        S.isPrimitive(S.integer()) &&
        S.isPrimitive(S.boolean()) &&
        S.isPrimitive(S.null_()) &&
        S.isPrimitive(S.literal(v)) &&
        S.isPrimitive(S.enum_("a")) &&
        !S.isPrimitive(S.object({ x: S.string() })) &&
        !S.isPrimitive(S.array(S.string())) &&
        S.isPrimitive(S.optional(S.string())) &&
        S.isPrimitive(S.nullable(S.number()))
      );
    },
    { numRuns: NUM_RUNS },
  );
});

test("findDiscriminant detects common literal property", () => {
  Prop.assert(
    Arb.tuple(Arb.string(), Arb.string()),
    ([a, b]) => {
      if (a === b) return true; // skip duplicate values
      const variants = [
        S.object({ tag: S.literal(a), x: S.string() }),
        S.object({ tag: S.literal(b), x: S.number() }),
      ];
      return S.findDiscriminant(variants) === "tag";
    },
    { numRuns: NUM_RUNS },
  );
});
