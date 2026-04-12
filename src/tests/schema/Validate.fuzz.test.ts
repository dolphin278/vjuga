import { test } from "node:test";
import * as S from "../../schema/Schema.js";
import { validate } from "../../schema/Validate.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Validators accept matching types
// ---------------------------------------------------------------------------

test("string validator accepts strings", () => {
  const v = validate(S.string());
  Prop.assert(Arb.string(), (s) => v(s)[0] === true, { numRuns: NUM_RUNS });
});

test("number validator accepts non-NaN numbers", () => {
  const v = validate(S.number());
  Prop.assert(
    Arb.filter(Arb.float(), (n) => !Number.isNaN(n)),
    (n) => v(n)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

test("integer validator accepts safe integers", () => {
  const v = validate(S.integer());
  Prop.assert(Arb.integer(), (n) => v(n)[0] === true, { numRuns: NUM_RUNS });
});

test("boolean validator accepts booleans", () => {
  const v = validate(S.boolean());
  Prop.assert(Arb.boolean(), (b) => v(b)[0] === true, { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// Validators reject wrong types
// ---------------------------------------------------------------------------

const nonString: Arb.Arbitrary<unknown> = Arb.oneOf(
  Arb.integer() as Arb.Arbitrary<unknown>,
  Arb.boolean() as Arb.Arbitrary<unknown>,
  Arb.constant(null as unknown),
);

const nonNumber: Arb.Arbitrary<unknown> = Arb.oneOf(
  Arb.string() as Arb.Arbitrary<unknown>,
  Arb.boolean() as Arb.Arbitrary<unknown>,
  Arb.constant(null as unknown),
);

test("string validator rejects non-strings", () => {
  const v = validate(S.string());
  Prop.assert(nonString, (x) => v(x)[0] === false, { numRuns: NUM_RUNS });
});

test("number validator rejects non-numbers", () => {
  const v = validate(S.number());
  Prop.assert(nonNumber, (x) => v(x)[0] === false, { numRuns: NUM_RUNS });
});

test("integer validator rejects floats", () => {
  const v = validate(S.integer());
  Prop.assert(
    Arb.filter(Arb.float(), (n) => !Number.isNaN(n) && !Number.isSafeInteger(n)),
    (n) => v(n)[0] === false,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Object validation — random key/value schemas
// ---------------------------------------------------------------------------

test("object validator accepts matching objects", () => {
  const schema = S.object({ name: S.string(), age: S.integer() });
  const v = validate(schema);
  const gen = Arb.record({ name: Arb.string(), age: Arb.integer(0, 200) });
  Prop.assert(gen, (obj) => v(obj)[0] === true, { numRuns: NUM_RUNS });
});

test("object validator rejects when field has wrong type", () => {
  const schema = S.object({ name: S.string(), age: S.integer() });
  const v = validate(schema);
  const gen = Arb.record({ name: Arb.integer(), age: Arb.integer(0, 200) });
  Prop.assert(gen as Arb.Arbitrary<unknown>, (obj) => v(obj)[0] === false, { numRuns: NUM_RUNS });
});

// ---------------------------------------------------------------------------
// Array validation
// ---------------------------------------------------------------------------

test("array validator accepts arrays of correct type", () => {
  const v = validate(S.array(S.integer()));
  Prop.assert(Arb.array(Arb.integer(), { maxLength: 50 }), (arr) => v(arr)[0] === true, {
    numRuns: NUM_RUNS,
  });
});

test("array validator rejects arrays with wrong element type", () => {
  const v = validate(S.array(S.integer()));
  // Array with at least one string element
  Prop.assert(
    Arb.map(Arb.array(Arb.integer(), { minLength: 1, maxLength: 20 }), (arr) => {
      const copy = [...arr];
      copy[0] = "bad" as unknown as number;
      return copy;
    }),
    (arr) => v(arr)[0] === false,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// String constraints
// ---------------------------------------------------------------------------

test("string minLength/maxLength constraints", () => {
  const v = validate(S.string({ minLength: 3, maxLength: 10 }));
  Prop.assert(Arb.string({ minLength: 3, maxLength: 10 }), (s) => v(s)[0] === true, {
    numRuns: NUM_RUNS,
  });
});

test("string minLength rejects short strings", () => {
  const v = validate(S.string({ minLength: 5 }));
  Prop.assert(Arb.string({ minLength: 0, maxLength: 4 }), (s) => v(s)[0] === false, {
    numRuns: NUM_RUNS,
  });
});

// ---------------------------------------------------------------------------
// Number constraints
// ---------------------------------------------------------------------------

test("number minimum/maximum constraints", () => {
  const v = validate(S.number({ minimum: 0, maximum: 100 }));
  Prop.assert(
    Arb.map(Arb.float(), (n) => Math.abs(n) % 100),
    (n) => v(n)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Discriminated union validation
// ---------------------------------------------------------------------------

test("discriminated union validates correct variant", () => {
  const v = validate(
    S.union(
      S.object({ type: S.literal("a"), val: S.string() }),
      S.object({ type: S.literal("b"), val: S.integer() }),
    ),
  );
  Prop.assert(
    Arb.oneOf(
      Arb.map(Arb.string(), (s) => ({ type: "a" as const, val: s })) as Arb.Arbitrary<{
        type: string;
        val: unknown;
      }>,
      Arb.map(Arb.integer(), (n) => ({ type: "b" as const, val: n })) as Arb.Arbitrary<{
        type: string;
        val: unknown;
      }>,
    ),
    (obj) => v(obj)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Record validation
// ---------------------------------------------------------------------------

test("record validator accepts matching records", () => {
  const v = validate(S.record(S.integer()));
  Prop.assert(
    Arb.dictionary(Arb.string({ minLength: 1, maxLength: 10 }), Arb.integer()),
    (obj) => v(obj)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Optional / nullable
// ---------------------------------------------------------------------------

test("optional validator accepts undefined and inner type", () => {
  const v = validate(S.optional(S.string()));
  Prop.assert(
    Arb.oneOf(
      Arb.string() as Arb.Arbitrary<string | undefined>,
      Arb.constant(undefined as string | undefined),
    ),
    (x) => v(x)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

test("nullable validator accepts null and inner type", () => {
  const v = validate(S.nullable(S.integer()));
  Prop.assert(
    Arb.oneOf(Arb.integer() as Arb.Arbitrary<number | null>, Arb.constant(null as number | null)),
    (x) => v(x)[0] === true,
    { numRuns: NUM_RUNS },
  );
});
