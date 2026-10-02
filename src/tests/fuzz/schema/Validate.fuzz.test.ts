import { test } from "node:test";
import * as S from "../../../schema/Schema.js";
import { validate, type SchemaError } from "../../../schema/Validate.js";
import { formatTester } from "../../../schema/Formats.js";
import type { Result } from "../../../Result.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";

const NUM_RUNS = 1_000_000;

// ---------------------------------------------------------------------------
// Validators accept matching types
// ---------------------------------------------------------------------------

test("string validator accepts strings", () => {
  const v = validate(S.string());
  Prop.assert(Arb.string(), (s) => v(s)[0] === true, { numRuns: NUM_RUNS });
});

test("number validator accepts finite numbers", () => {
  const v = validate(S.number());
  Prop.assert(
    Arb.filter(Arb.float(), (n) => Number.isFinite(n)),
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

test("number validator rejects non-finite numbers", () => {
  const v = validate(S.number());
  Prop.assert(Arb.constantFrom(NaN, Infinity, -Infinity), (n) => v(n)[0] === false, {
    numRuns: NUM_RUNS,
  });
});

// ---------------------------------------------------------------------------
// Interpreter oracle — compiled validator agrees with a reference interpreter
// on random (schema, value) pairs
// ---------------------------------------------------------------------------

// Reference interpreter: a direct, unoptimized reading of the documented
// semantics. Objects use OWN properties only; "extra key" means an own
// enumerable string key (Object.keys) not declared in the schema; equality for
// literal/enum is SameValueZero.
function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

function refNumeric(m: S.NumberConstraints | undefined, v: number): boolean {
  if (m === undefined) return true;
  if (m.minimum !== undefined && v < m.minimum) return false;
  if (m.maximum !== undefined && v > m.maximum) return false;
  if (m.exclusiveMinimum !== undefined && v <= m.exclusiveMinimum) return false;
  if (m.exclusiveMaximum !== undefined && v >= m.exclusiveMaximum) return false;
  // Generated multipleOf values are integers: exact modulo is the spec
  if (m.multipleOf !== undefined && v % m.multipleOf !== 0) return false;
  return true;
}

function isPlainObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function refValidate(s: S.Schema, v: unknown): boolean {
  switch (s.kind) {
    case "string": {
      if (typeof v !== "string") return false;
      const m = s.meta;
      if (m === undefined) return true;
      if (m.minLength !== undefined && v.length < m.minLength) return false;
      if (m.maxLength !== undefined && v.length > m.maxLength) return false;
      if (m.pattern !== undefined && !new RegExp(m.pattern).test(v)) return false;
      // Format grammars are checked against the test suite elsewhere; here
      // the oracle only pins how the emitter wires them in (unknown = skip).
      const tester = m.format === undefined ? undefined : formatTester(m.format);
      if (tester !== undefined && !tester.test(v)) return false;
      return true;
    }
    case "number":
      return typeof v === "number" && Number.isFinite(v) && refNumeric(s.meta, v);
    case "integer":
      return Number.isSafeInteger(v) && refNumeric(s.meta, v as number);
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    case "literal":
      return sameValueZero(v, s.meta.value);
    case "enum":
      return (s.meta.values as unknown[]).some((x) => sameValueZero(v, x));
    case "object": {
      if (!isPlainObjectLike(v)) return false;
      const props = s.meta.properties as Record<string, S.Schema>;
      for (const k of Object.keys(props)) {
        if (!refValidate(props[k], Object.hasOwn(v, k) ? v[k] : undefined)) return false;
      }
      if (!s.meta.additionalProperties) {
        for (const k of Object.keys(v)) if (!Object.hasOwn(props, k)) return false;
      }
      return true;
    }
    case "array": {
      if (!Array.isArray(v)) return false;
      if (s.meta.minItems !== undefined && v.length < s.meta.minItems) return false;
      if (s.meta.maxItems !== undefined && v.length > s.meta.maxItems) return false;
      for (let i = 0; i < v.length; i++) if (!refValidate(s.meta.items, v[i])) return false;
      return true;
    }
    case "tuple": {
      const items = s.meta.items as S.Schema[];
      if (!Array.isArray(v) || v.length !== items.length) return false;
      return items.every((item, i) => refValidate(item, v[i]));
    }
    case "record":
      return isPlainObjectLike(v) && Object.keys(v).every((k) => refValidate(s.meta.values, v[k]));
    case "union": {
      const matches = (s.meta.variants as S.Schema[]).filter((variant) => refValidate(variant, v));
      return s.meta.exclusive === true ? matches.length === 1 : matches.length > 0;
    }
    case "optional":
      return v === undefined || refValidate(s.meta.inner, v);
    case "nullable":
      return v === null || refValidate(s.meta.inner, v);
    case "unknown":
      return v !== undefined;
    case "allOf":
      return (s.meta.variants as S.Schema[]).every((variant) => refValidate(variant, v));
    case "not":
      return v !== undefined && !refValidate(s.meta.inner, v);
    case "conditional":
      return refValidate(s.meta.if, v) ? refValidate(s.meta.then, v) : refValidate(s.meta.else, v);
  }
}

// --- Generators -------------------------------------------------------------

// Arb.integer is size-scaled (size ramps up from 0), so choices use
// constantFrom, which is uniform at every size.
const choiceArbs: Arb.Arbitrary<number>[] = [];
function choose(pick: Arb.GenPick, n: number): number {
  let arb = choiceArbs[n];
  if (arb === undefined) {
    const opts = Array.from({ length: n }, (_, i) => i) as [number, ...number[]];
    arb = choiceArbs[n] = Arb.constantFrom(...opts);
  }
  return pick(arb);
}
function oneOfValues<T>(pick: Arb.GenPick, xs: readonly T[]): T {
  return xs[choose(pick, xs.length)];
}

const KEYS = ["a", "b", "t", "constructor", "__proto__", "toString", 'q"k', "x+y", "\n", ""];
const LITERALS: readonly (string | number | boolean | null)[] = [
  "a",
  "b",
  "",
  '"',
  "constructor",
  0,
  -0,
  1,
  -1,
  2.5,
  NaN,
  Infinity,
  -Infinity,
  true,
  false,
  null,
];
const ENUM_POOL: readonly (string | number)[] = [
  "a",
  "b",
  "c",
  '"',
  0,
  -0,
  1,
  2,
  3.5,
  NaN,
  Infinity,
  -Infinity,
];
const PATTERNS = ["^a", "b$", '"', "^\\d+$", "\\n"];
const FORMATS = ["email", "uuid", "date", "date-time", "hostname", "constructor"];
const VALUE_POOL: readonly unknown[] = [
  undefined,
  null,
  0,
  -0,
  1,
  -1,
  2,
  3,
  6,
  2.5,
  NaN,
  Infinity,
  -Infinity,
  2 ** 53,
  "",
  "a",
  "ab",
  "abc1",
  "123",
  '"',
  "a@b.co",
  "550e8400-e29b-41d4-a716-446655440000",
  "2024-02-29",
  "2024-02-29T12:00:00Z",
  "constructor",
  true,
  false,
];
const SMALL_INTS = [-2, -1, 0, 1, 2, 3];

function genNumericMeta(pick: Arb.GenPick): S.NumberConstraints | undefined {
  if (choose(pick, 2) === 0) return undefined;
  const m: Record<string, number> = {};
  if (choose(pick, 3) === 0) m.minimum = oneOfValues(pick, SMALL_INTS);
  if (choose(pick, 3) === 0) m.maximum = oneOfValues(pick, SMALL_INTS);
  if (choose(pick, 4) === 0) m.exclusiveMinimum = oneOfValues(pick, SMALL_INTS);
  if (choose(pick, 4) === 0) m.exclusiveMaximum = oneOfValues(pick, SMALL_INTS);
  if (choose(pick, 3) === 0) m.multipleOf = oneOfValues(pick, [1, 2, 3]);
  return m;
}

function genSchema(pick: Arb.GenPick, depth: number): S.Schema {
  const leafOnly = depth <= 0;
  switch (choose(pick, leafOnly ? 7 : 20)) {
    case 0: {
      if (choose(pick, 2) === 0) return S.string();
      const m: Record<string, unknown> = {};
      if (choose(pick, 2) === 0) m.minLength = choose(pick, 3);
      if (choose(pick, 2) === 0) m.maxLength = 1 + choose(pick, 4);
      if (choose(pick, 3) === 0) m.pattern = oneOfValues(pick, PATTERNS);
      if (choose(pick, 4) === 0) m.format = oneOfValues(pick, FORMATS);
      return S.string(m as S.StringConstraints);
    }
    case 1:
      return S.number(genNumericMeta(pick));
    case 2:
      return S.integer(genNumericMeta(pick));
    case 3:
      return S.boolean();
    case 4:
      return S.null_();
    case 5:
      return S.literal(oneOfValues(pick, LITERALS));
    case 6: {
      // 1..11 values — covers both the inline (<=8) and Set (>8) paths
      const n = 1 + choose(pick, 11);
      return S.enum_(...Array.from({ length: n }, () => oneOfValues(pick, ENUM_POOL)));
    }
    case 7:
    case 8: {
      const props: Record<string, S.Schema> = {};
      const n = choose(pick, 4);
      for (let i = 0; i < n; i++) {
        const k = oneOfValues(pick, KEYS);
        const child = genSchema(pick, depth - 1);
        Object.defineProperty(props, k, {
          value: choose(pick, 3) === 0 ? S.optional(child) : child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return S.object(props, { additionalProperties: choose(pick, 3) === 0 });
    }
    case 9: {
      const opts: { minItems?: number; maxItems?: number } = {};
      if (choose(pick, 3) === 0) opts.minItems = choose(pick, 3);
      if (choose(pick, 3) === 0) opts.maxItems = choose(pick, 4);
      return S.array(genSchema(pick, depth - 1), opts);
    }
    case 10:
      return S.tuple(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    case 11:
      return S.record(genSchema(pick, depth - 1));
    case 12: {
      if (choose(pick, 3) === 0) {
        // Tagged union: shared literal key "t" with distinct-or-not tags
        const n = 2 + choose(pick, 2);
        return S.union(
          ...Array.from({ length: n }, () => {
            const rest = genSchema(pick, depth - 1);
            return S.object(
              { t: S.literal(oneOfValues(pick, LITERALS)), a: rest },
              { additionalProperties: choose(pick, 3) === 0 },
            );
          }),
        );
      }
      return S.union(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    }
    case 13:
      return S.optional(genSchema(pick, depth - 1));
    case 14:
      return S.nullable(genSchema(pick, depth - 1));
    case 15: {
      if (choose(pick, 3) === 0) {
        // Tagged oneOf: shared literal key "t" (switch fast path when distinct)
        const n = 2 + choose(pick, 2);
        return S.oneOf(
          ...Array.from({ length: n }, () =>
            S.object(
              { t: S.literal(oneOfValues(pick, LITERALS)), a: genSchema(pick, depth - 1) },
              { additionalProperties: choose(pick, 3) === 0 },
            ),
          ),
        );
      }
      return S.oneOf(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    }
    case 16:
      return S.allOf(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    case 17:
      return S.not(genSchema(pick, depth - 1));
    case 18:
      return S.conditional(
        genSchema(pick, depth - 1),
        choose(pick, 4) === 0 ? undefined : genSchema(pick, depth - 1),
        choose(pick, 4) === 0 ? undefined : genSchema(pick, depth - 1),
      );
    default:
      return S.unknown();
  }
}

/** A value shaped like `s` (often, not always, valid), with random corruptions. */
function genValue(pick: Arb.GenPick, s: S.Schema, depth: number): unknown {
  if (depth <= 0 || choose(pick, 6) === 0) return oneOfValues(pick, VALUE_POOL);
  switch (s.kind) {
    case "literal":
      return s.meta.value;
    case "enum":
      return oneOfValues(pick, s.meta.values as unknown[]);
    case "object": {
      const props = s.meta.properties as Record<string, S.Schema>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(props)) {
        const r = choose(pick, 8);
        if (r === 0) continue; // drop the key
        const val = r === 1 ? undefined : genValue(pick, props[k], depth - 1);
        Object.defineProperty(out, k, {
          value: val,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      if (choose(pick, 4) === 0) out[oneOfValues(pick, KEYS) + "_extra"] = 1;
      switch (choose(pick, 8)) {
        case 0:
          return Object.create(out); // every field moved onto the prototype
        case 1: {
          const nullProto = Object.create(null) as Record<string, unknown>;
          return Object.assign(nullProto, out);
        }
        default:
          return out;
      }
    }
    case "array":
    case "tuple": {
      const items = s.kind === "array" ? null : (s.meta.items as S.Schema[]);
      const n = items === null ? choose(pick, 5) : items.length + (choose(pick, 5) === 0 ? 1 : 0);
      return Array.from({ length: n }, (_, i) =>
        genValue(
          pick,
          items === null ? (s.meta.items as S.Schema) : (items[i] ?? S.null_()),
          depth - 1,
        ),
      );
    }
    case "record": {
      const out: Record<string, unknown> = {};
      for (let i = choose(pick, 3); i > 0; i--) {
        Object.defineProperty(out, oneOfValues(pick, KEYS), {
          value: genValue(pick, s.meta.values, depth - 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    case "union": {
      const vs = s.meta.variants as S.Schema[];
      return vs.length === 0
        ? oneOfValues(pick, VALUE_POOL)
        : genValue(pick, vs[choose(pick, vs.length)], depth);
    }
    case "optional":
    case "nullable":
      return choose(pick, 4) === 0 ? undefined : genValue(pick, s.meta.inner, depth);
    case "allOf": {
      const vs = s.meta.variants as S.Schema[];
      return vs.length === 0
        ? oneOfValues(pick, VALUE_POOL)
        : genValue(pick, vs[choose(pick, vs.length)], depth);
    }
    case "conditional":
      return genValue(pick, choose(pick, 2) === 0 ? s.meta.then : s.meta.if, depth);
    default:
      return oneOfValues(pick, VALUE_POOL);
  }
}

const VALUES_PER_SCHEMA = 8;
const schemaWithValues = Arb.gen((pick) => {
  const schema = genSchema(pick, 3);
  const values = Array.from({ length: VALUES_PER_SCHEMA }, () => genValue(pick, schema, 4));
  return { schema, values };
});

test("compiled validator agrees with the reference interpreter", () => {
  Prop.assert(
    schemaWithValues,
    ({ schema, values }) => {
      // Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
      const v = validate(schema as S.StringSchema) as (x: unknown) => Result<unknown, SchemaError>;
      for (const value of values) {
        const got = v(value);
        if (got[0] !== refValidate(schema, value)) return false;
        if (!got[0] && typeof got[1].path !== "string") return false;
        if (got[0] && !Object.is(got[1], value)) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});
