/**
 * Refinements (`refine()` / `construct()`) against a reference interpreter
 * that computes both the verdict and the OUTPUT value: validate (copy
 * semantics, input untouched, unchanged containers returned as-is),
 * allErrors (same verdict, errors[0], same output) and JSON.parse (one pass,
 * in place) must all agree with it.
 */
import { test } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import * as S from "../../../schema/Schema.js";
import * as SJ from "../../../schema/JSON.js";
import { validate, type SchemaError } from "../../../schema/Validate.js";
import { ok, err, type Result } from "../../../Result.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";

const NUM_RUNS = 1_000_000;

// --- Refinement pools (total over any input, deterministic) ----------------

const GUARDS: readonly ((v: unknown) => boolean)[] = [
  (v) => typeof v !== "number" || v % 2 === 0,
  (v) => typeof v !== "string" || v.length !== 1,
  (v) => !Array.isArray(v) || v.length < 3,
  (v) => v !== null,
  (v) => typeof v !== "object" || v === null || !Object.hasOwn(v, "a"),
];

const CONSTRUCTORS: readonly ((v: unknown) => Result<unknown, string>)[] = [
  (v) => ok(v),
  (v) => ok(typeof v === "string" ? v.toUpperCase() : v),
  (v) => ok(typeof v === "number" ? v * 2 : v),
  (v) => ok({ w: v === undefined ? null : v }),
  (v) => (v === "" || v === 0 ? err("empty") : ok(v)),
  (v) => (typeof v === "string" ? ok(v.length) : err("not-string")),
];

// --- Generators ----------------------------------------------------------------

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

const KEYS = ["a", "b", "__proto__"];
const LITERALS = ["a", "", 0, 1, true, null] as const;
const VALUE_POOL: readonly unknown[] = [null, 0, 1, 2, -1, 2.5, "", "a", "ab", "A", true, false];

function genSchema(pick: Arb.GenPick, depth: number): S.Schema {
  switch (choose(pick, depth <= 0 ? 8 : 22)) {
    case 0:
      return choose(pick, 2) === 0 ? S.string() : S.string({ minLength: 1 });
    case 1:
      return S.number();
    case 2:
      return S.integer();
    case 3:
      return S.boolean();
    case 4:
      return S.null_();
    case 5:
      return S.literal(oneOfValues(pick, LITERALS));
    case 6:
      return S.refine(genLeaf(pick), oneOfValues(pick, GUARDS));
    case 7:
      return S.construct(genLeaf(pick), oneOfValues(pick, CONSTRUCTORS), { at: () => "" });
    case 8:
    case 9: {
      const props: Record<string, S.Schema> = {};
      for (let n = choose(pick, 3); n > 0; n--) {
        const child = genSchema(pick, depth - 1);
        Object.defineProperty(props, oneOfValues(pick, KEYS), {
          value: choose(pick, 3) === 0 ? S.optional(child) : child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return S.object(props, { additionalProperties: choose(pick, 3) === 0 });
    }
    case 10:
      return S.array(genSchema(pick, depth - 1));
    case 11:
      return S.tuple(...Array.from({ length: choose(pick, 3) }, () => genSchema(pick, depth - 1)));
    case 12:
      return S.record(genSchema(pick, depth - 1));
    case 13: {
      if (choose(pick, 2) === 0) {
        const n = 2 + choose(pick, 2);
        return S.union(
          ...Array.from({ length: n }, (_, i) =>
            S.object({ t: S.literal(i), a: genSchema(pick, depth - 1) }),
          ),
        );
      }
      return S.union(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    }
    case 14:
      return S.oneOf(...Array.from({ length: choose(pick, 4) }, () => genSchema(pick, depth - 1)));
    case 15:
      return S.optional(genSchema(pick, depth - 1));
    case 16:
      return S.nullable(genSchema(pick, depth - 1));
    case 17: {
      const x = genSchema(pick, depth - 1);
      return choose(pick, 2) === 0
        ? S.allOf(x, genSchema(pick, depth - 1), x)
        : S.allOf(...Array.from({ length: choose(pick, 3) }, () => genSchema(pick, depth - 1)));
    }
    case 18:
      return S.not(genSchema(pick, depth - 1));
    case 19:
      return S.conditional(
        genSchema(pick, depth - 1),
        genSchema(pick, depth - 1),
        genSchema(pick, depth - 1),
      );
    case 20:
      return S.refine(genSchema(pick, depth - 1), oneOfValues(pick, GUARDS));
    default:
      return S.construct(genSchema(pick, depth - 1), oneOfValues(pick, CONSTRUCTORS));
  }
}

function genLeaf(pick: Arb.GenPick): S.Schema {
  return genSchema(pick, 0);
}

/** A JSON value shaped like `s` (often, not always, valid). */
function genValue(pick: Arb.GenPick, s: S.Schema, depth: number): unknown {
  if (depth <= 0 || choose(pick, 6) === 0) return oneOfValues(pick, VALUE_POOL);
  switch (s.kind) {
    case "literal":
      return s.meta.value;
    case "object": {
      const props = s.meta.properties as Record<string, S.Schema>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(props)) {
        if (choose(pick, 6) === 0) continue;
        Object.defineProperty(out, k, {
          value: genValue(pick, props[k], depth - 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      if (choose(pick, 5) === 0) out.extra = 1;
      return out;
    }
    case "array":
      return Array.from({ length: choose(pick, 4) }, () => genValue(pick, s.meta.items, depth - 1));
    case "tuple":
      return (s.meta.items as S.Schema[]).map((item) => genValue(pick, item, depth - 1));
    case "record": {
      const out: Record<string, unknown> = {};
      for (let n = choose(pick, 3); n > 0; n--) {
        Object.defineProperty(out, oneOfValues(pick, KEYS), {
          value: genValue(pick, s.meta.values, depth - 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    case "union":
    case "allOf": {
      const vs = s.meta.variants as S.Schema[];
      return vs.length === 0 ? null : genValue(pick, vs[choose(pick, vs.length)], depth);
    }
    case "optional":
    case "nullable":
    case "refine":
    case "not":
      return genValue(pick, s.meta.inner, depth);
    case "conditional":
      return genValue(pick, choose(pick, 2) === 0 ? s.meta.then : s.meta.if, depth);
    default:
      return oneOfValues(pick, VALUE_POOL);
  }
}

// --- Reference interpreter -------------------------------------------------------

type Run = readonly [boolean, unknown];
const FAIL: Run = [false, undefined];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function setData(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

function ref(s: S.Schema, v: unknown): Run {
  switch (s.kind) {
    case "string":
      return typeof v === "string" && v.length >= (s.meta?.minLength ?? 0) ? [true, v] : FAIL;
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? [true, v] : FAIL;
    case "integer":
      return Number.isSafeInteger(v) ? [true, v] : FAIL;
    case "boolean":
      return typeof v === "boolean" ? [true, v] : FAIL;
    case "null":
      return v === null ? [true, v] : FAIL;
    case "literal":
      return v === s.meta.value ? [true, v] : FAIL;
    case "object": {
      if (!isObj(v)) return FAIL;
      const props = s.meta.properties as Record<string, S.Schema>;
      let out = v;
      for (const k of Object.keys(props)) {
        const before = Object.hasOwn(v, k) ? v[k] : undefined;
        const r = ref(props[k], before);
        if (!r[0]) return FAIL;
        if (r[1] !== before) {
          if (out === v) out = { ...v };
          setData(out, k, r[1]);
        }
      }
      if (!s.meta.additionalProperties) {
        for (const k of Object.keys(v)) if (!Object.hasOwn(props, k)) return FAIL;
      }
      return [true, out];
    }
    case "array":
    case "tuple": {
      if (!Array.isArray(v)) return FAIL;
      const tuple = s.kind === "tuple" ? (s.meta.items as S.Schema[]) : null;
      if (tuple !== null && v.length !== tuple.length) return FAIL;
      let out = v;
      for (let i = 0; i < v.length; i++) {
        const r = ref(tuple === null ? (s.meta.items as S.Schema) : tuple[i], v[i]);
        if (!r[0]) return FAIL;
        if (r[1] !== v[i]) {
          if (out === v) out = v.slice();
          out[i] = r[1];
        }
      }
      return [true, out];
    }
    case "record": {
      if (!isObj(v)) return FAIL;
      let out = v;
      for (const k of Object.keys(v)) {
        const r = ref(s.meta.values, v[k]);
        if (!r[0]) return FAIL;
        if (r[1] !== v[k]) {
          if (out === v) out = { ...v };
          setData(out, k, r[1]);
        }
      }
      return [true, out];
    }
    case "union": {
      const runs = (s.meta.variants as S.Schema[]).map((variant) => ref(variant, v));
      const hits = runs.filter((r) => r[0]);
      if (s.meta.exclusive === true) return hits.length === 1 ? hits[0] : FAIL;
      return hits.length > 0 ? hits[0] : FAIL;
    }
    case "optional":
      return v === undefined ? [true, v] : ref(s.meta.inner, v);
    case "nullable":
      return v === null ? [true, v] : ref(s.meta.inner, v);
    case "unknown":
      return v !== undefined ? [true, v] : FAIL;
    case "allOf": {
      // In order, each variant on the value as the earlier ones left it (a
      // variant repeated by identity runs once)
      let cur = v;
      for (const variant of new Set(s.meta.variants as S.Schema[])) {
        const r = ref(variant, cur);
        if (!r[0]) return FAIL;
        cur = r[1];
      }
      return [true, cur];
    }
    case "not":
      return v !== undefined && !ref(s.meta.inner, v)[0] ? [true, v] : FAIL;
    case "conditional":
      return ref(ref(s.meta.if, v)[0] ? s.meta.then : s.meta.else, v);
    case "refine": {
      const r = ref(s.meta.inner, v);
      if (!r[0]) return FAIL;
      if (s.meta.mode === "guard") {
        return (s.meta.fn as (x: unknown) => boolean)(r[1]) ? r : FAIL;
      }
      const made = (s.meta.fn as (x: unknown) => Result<unknown, unknown>)(r[1]);
      return made[0] ? [true, made[1]] : FAIL;
    }
    default:
      return FAIL;
  }
}

/** Compile, or null for an allOf whose variants share a constructed field (refused by design). */
function compile<F>(make: () => F): F | null {
  try {
    return make();
  } catch (e) {
    if (
      e instanceof TypeError &&
      /is constructed by one variant and declared by another/.test(e.message)
    ) {
      return null;
    }
    throw e;
  }
}

function stripProto(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripProto);
  if (!isObj(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) if (k !== "__proto__") out[k] = stripProto(v[k]);
  return out;
}

const cases = Arb.gen((pick) => {
  const schema = genSchema(pick, 3);
  const values = Array.from({ length: 6 }, () => genValue(pick, schema, 4));
  return { schema, values };
});

// Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
type Check = (x: unknown) => Result<unknown, SchemaError>;
type CheckAll = (x: unknown) => Result<unknown, SchemaError[]>;
type ParseFn = (text: string) => Result<unknown, SchemaError>;

test("validate: verdict and output match the reference; input untouched; no needless copies", () => {
  Prop.assert(
    cases,
    ({ schema, values }) => {
      const v = compile(() => validate(schema as S.StringSchema) as Check);
      if (v === null) return true;
      for (const value of values) {
        const snapshot = structuredClone(value);
        const got = v(value);
        const want = ref(schema, value);
        if (got[0] !== want[0]) return false;
        deepStrictEqual(value, snapshot);
        if (!got[0]) continue;
        deepStrictEqual(got[1], want[1]);
        if (want[1] === value && got[1] !== value) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("allErrors: same verdict and output; errors[0] is the first-error result", () => {
  Prop.assert(
    cases,
    ({ schema, values }) => {
      const first = compile(() => validate(schema as S.StringSchema) as Check);
      if (first === null) return true;
      const all = validate(schema as S.StringSchema, { allErrors: true }) as CheckAll;
      for (const value of values) {
        const a = first(value);
        const b = all(value);
        if (a[0] !== b[0]) return false;
        if (a[0]) deepStrictEqual(b[1], a[1]);
        else deepStrictEqual((b[1] as SchemaError[])[0], a[1]);
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("JSON.parse: one in-place pass agrees with validate over the parsed tree", () => {
  Prop.assert(
    cases,
    ({ schema, values }) => {
      const parse = compile(() => SJ.parse(schema as S.StringSchema) as ParseFn);
      if (parse === null) return true;
      const v = validate(schema as S.StringSchema) as Check;
      for (const value of values) {
        const text = JSON.stringify(value);
        if (text === undefined) continue;
        const got = parse(text);
        const want = v(stripProto(JSON.parse(text)));
        if (got[0] !== want[0]) return false;
        if (got[0]) deepStrictEqual(got[1], want[1]);
        else {
          const [g, w] = [got[1], want[1] as SchemaError];
          if (g.path !== w.path || g.expected !== w.expected || g.cause !== w.cause) return false;
        }
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});
