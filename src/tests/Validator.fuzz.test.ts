import { test } from "node:test";
import * as V from "../Validator.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";

const NUM_RUNS = 500;

// -------------------------------------------------------------------------
// Primitives accept correct types
// -------------------------------------------------------------------------

test("string() accepts strings", () => {
  Prop.assert(Arb.string(), (s) => V.string()(s)[0] === true, { numRuns: NUM_RUNS });
});

test("number() accepts non-NaN numbers", () => {
  Prop.assert(
    Arb.filter(Arb.float(), (n) => !Number.isNaN(n)),
    (n) => V.number()(n)[0] === true,
    { numRuns: NUM_RUNS },
  );
});

test("number() also accepts integers", () => {
  Prop.assert(Arb.integer(), (n) => V.number()(n)[0] === true, { numRuns: NUM_RUNS });
});

test("boolean() accepts booleans", () => {
  Prop.assert(Arb.boolean(), (b) => V.boolean()(b)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// Primitives reject wrong types
// -------------------------------------------------------------------------

test("string() rejects non-strings", () => {
  const nonString: Arb.Arbitrary<unknown> = Arb.oneOf(
    Arb.integer() as Arb.Arbitrary<unknown>,
    Arb.boolean() as Arb.Arbitrary<unknown>,
    Arb.constant(null as unknown),
    Arb.constant(undefined as unknown),
  );
  Prop.assert(nonString, (v) => V.string()(v)[0] === false, { numRuns: NUM_RUNS });
});

test("number() rejects non-numbers", () => {
  const nonNumber: Arb.Arbitrary<unknown> = Arb.oneOf(
    Arb.string() as Arb.Arbitrary<unknown>,
    Arb.boolean() as Arb.Arbitrary<unknown>,
    Arb.constant(null as unknown),
    Arb.constant(undefined as unknown),
  );
  Prop.assert(nonNumber, (v) => V.number()(v)[0] === false, { numRuns: NUM_RUNS });
});

test("boolean() rejects non-booleans", () => {
  const nonBool: Arb.Arbitrary<unknown> = Arb.oneOf(
    Arb.string() as Arb.Arbitrary<unknown>,
    Arb.integer() as Arb.Arbitrary<unknown>,
    Arb.constant(null as unknown),
    Arb.constant(undefined as unknown),
  );
  Prop.assert(nonBool, (v) => V.boolean()(v)[0] === false, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// literal() round-trip
// -------------------------------------------------------------------------

test("literal() accepts the exact value", () => {
  const litArb: Arb.Arbitrary<string | number | boolean> = Arb.oneOf(
    Arb.string() as Arb.Arbitrary<string | number | boolean>,
    Arb.integer() as Arb.Arbitrary<string | number | boolean>,
    Arb.boolean() as Arb.Arbitrary<string | number | boolean>,
  );
  Prop.assert(litArb, (v) => V.literal(v)(v)[0] === true, {
    numRuns: NUM_RUNS,
  });
});

test("literal() rejects different values", () => {
  Prop.assert(Arb.integer(), (n) => V.literal(n)(n + 1)[0] === false, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// object() validates conforming objects
// -------------------------------------------------------------------------

test("object() accepts conforming objects", () => {
  const shape = { a: V.string(), b: V.number() };
  const objArb = Arb.record<{ a: string; b: number }>({
    a: Arb.string(),
    b: Arb.integer(),
  });
  Prop.assert(objArb, (obj) => V.object(shape)(obj)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// array() validates arrays
// -------------------------------------------------------------------------

test("array(number()) accepts number arrays", () => {
  const arrArb = Arb.array(Arb.integer(), { minLength: 0, maxLength: 20 });
  Prop.assert(arrArb, (arr) => V.array(V.number())(arr)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// record() validates records
// -------------------------------------------------------------------------

test("record(number()) accepts Record<string, number>", () => {
  const dictArb = Arb.dictionary(Arb.string({ minLength: 1, maxLength: 5 }), Arb.integer(), {
    minSize: 0,
    maxSize: 10,
  });
  Prop.assert(dictArb, (rec) => V.record(V.number())(rec)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// optional/nullable composition
// -------------------------------------------------------------------------

test("optional(string()) accepts string | undefined", () => {
  const arb = Arb.oneOf(Arb.string(), Arb.constant(undefined));
  Prop.assert(arb, (v) => V.optional(V.string())(v)[0] === true, { numRuns: NUM_RUNS });
});

test("nullable(string()) accepts string | null", () => {
  const arb = Arb.oneOf(Arb.string(), Arb.constant(null));
  Prop.assert(arb, (v) => V.nullable(V.string())(v)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// union tries all branches
// -------------------------------------------------------------------------

test("union([string(), number()]) accepts both types", () => {
  const arb = Arb.oneOf<string | number>(Arb.string(), Arb.integer());
  const validator = V.union([V.string(), V.number()]);
  Prop.assert(arb, (v) => validator(v)[0] === true, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// map transforms Ok values
// -------------------------------------------------------------------------

test("map(number(), n => n * 2) transforms the validated value", () => {
  const validator = V.map(V.number(), (n) => n * 2);
  Prop.assert(Arb.integer(), (n) => {
    const result = validator(n);
    return result[0] === true && result[1] === n * 2;
  }, { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// toGuard consistency
// -------------------------------------------------------------------------

test("toGuard(v)(x) === v(x)[0]", () => {
  const validator = V.union([V.string(), V.number(), V.boolean()]);
  const guard = V.toGuard(validator);
  const arb = Arb.oneOf<unknown>(
    Arb.string(),
    Arb.integer(),
    Arb.boolean(),
    Arb.constant(null),
    Arb.constant(undefined),
    Arb.array(Arb.integer(), { minLength: 0, maxLength: 3 }),
  );
  Prop.assert(arb, (x) => guard(x) === validator(x)[0], { numRuns: NUM_RUNS });
});

// -------------------------------------------------------------------------
// toAssertion consistency
// -------------------------------------------------------------------------

test("toAssertion(v)(x) throws iff v(x)[0] === false", () => {
  const validator = V.string();
  const assertion: (value: unknown) => asserts value is string = V.toAssertion(validator);
  const arb = Arb.oneOf<unknown>(
    Arb.string(),
    Arb.integer(),
    Arb.boolean(),
    Arb.constant(null),
  );
  Prop.assert(arb, (x) => {
    const expected = validator(x)[0];
    let threw = false;
    try {
      assertion(x);
    } catch {
      threw = true;
    }
    return expected === !threw;
  }, { numRuns: NUM_RUNS });
});
