import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../../schema/Schema.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import { validate } from "../../../schema/Validate.js";
import * as G from "./_serial-gen.js";

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
    S.unknown(),
    S.allOf(S.string()),
    S.not(S.string()),
    S.conditional(S.string()),
    S.oneOf(S.string()),
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

// ---------------------------------------------------------------------------
// Random schemas (incl. unknown / allOf / not / conditional / oneOf):
// toJsonSchema → fromJsonSchema keeps every JSON value's verdict
// ---------------------------------------------------------------------------

type Verdict = (v: unknown) => readonly [boolean, unknown];
// Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
const compile = (s: S.Schema): Verdict => validate(s as S.StringSchema) as Verdict;

test("random schemas keep their verdicts through toJsonSchema → fromJsonSchema", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 8 })),
    ([n, str]) => {
      const seed = G.hashSeed(n + ":" + str);
      const { schema } = G.genSchema(G.rng(seed), { toon: false, protoKeys: true });
      const back = S.fromJsonSchema(S.toJsonSchema(schema));
      if (!back[0]) throw new Error(`seed=${seed} lowering failed: ${back[1]}`);
      const a = compile(schema);
      const b = compile(back[1]);
      const r = G.rng(seed ^ 0x2545f491);
      for (let i = 0; i < 4; i++) {
        // JSON values only: undefined has no JSON Schema meaning
        const raw =
          i < 2 ? G.genValue(r, schema) : G.genValue(r, G.genSchema(r, G.DEFAULT_CFG).schema);
        const json = JSON.stringify(raw);
        if (json === undefined) continue;
        const v: unknown = JSON.parse(json);
        if (a(v)[0] !== b(v)[0]) {
          throw new Error(`seed=${seed}\nschema=${JSON.stringify(schema)}\nvalue=${json}`);
        }
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// propertyMayBeAbsent is exactly "accepts undefined" (any kind), and
// toJsonSchema's `required` agrees with it
// ---------------------------------------------------------------------------

test("propertyMayBeAbsent ⇔ validate accepts undefined ⇔ key not required", () => {
  // Wrappers that may or may not let undefined through, around random schemas
  const wrap = (r: G.Rng, s: S.Schema, depth = 0): S.Schema => {
    const w = (): S.Schema => wrap(r, s, depth + 1);
    switch (depth >= 3 ? 7 : Math.floor(r() * 8)) {
      case 0:
        return S.optional(s);
      case 1:
        return S.nullable(w());
      case 2:
        return S.union(w(), G.genSchema(r, G.DEFAULT_CFG, 2).schema);
      case 3:
        return S.oneOf(w(), w());
      case 4:
        return S.allOf(w(), w());
      case 5:
        return S.conditional(w(), w(), w());
      default:
        return s;
    }
  };
  Prop.assert(
    Arb.integer(0, 0x7fffffff),
    (seed) => {
      const r = G.rng(seed);
      const p = wrap(r, G.genSchema(r, G.DEFAULT_CFG, 1).schema);
      const absent = S.propertyMayBeAbsent(p);
      if (absent !== compile(p)(undefined)[0]) {
        throw new Error(`seed=${seed} schema=${JSON.stringify(p)}`);
      }
      const js = S.toJsonSchema(S.object({ k: p })) as { required?: string[] };
      if ((js.required === undefined) !== absent) throw new Error(`seed=${seed} required`);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// toJsonSchema: shared subschemas convert like their unshared copies; a
// cycle anywhere is a TypeError
// ---------------------------------------------------------------------------

/** Deep copy with no shared nodes (schemas are plain objects and arrays). */
function unshare(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unshare);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    Object.defineProperty(out, k, {
      value: unshare((v as Record<string, unknown>)[k]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

test("toJsonSchema of a DAG equals that of its unshared tree; cycles throw TypeError", () => {
  Prop.assert(
    Arb.integer(0, 0x7fffffff),
    (seed) => {
      const r = G.rng(seed);
      const x = G.genSchema(r, G.DEFAULT_CFG).schema;
      const y = G.genSchema(r, G.DEFAULT_CFG).schema;
      const dag = S.object({ a: x, b: S.array(x), c: S.union(y, S.optional(x)), d: S.tuple(y, y) });
      const tree = unshare(dag) as S.Schema;
      assert.deepEqual(S.toJsonSchema(dag), S.toJsonSchema(tree), `seed=${seed}`);
      // Close a loop through a fresh union at a random depth of the tree
      const loop = S.union(y);
      (loop.meta.variants as unknown as S.Schema[]).push(
        Math.floor(r() * 2) === 0 ? S.array(S.nullable(loop)) : S.object({ z: S.optional(loop) }),
      );
      assert.throws(() => S.toJsonSchema(S.object({ x, l: loop })), TypeError, `seed=${seed}`);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// fromJsonSchema keyword checks
// ---------------------------------------------------------------------------

/** Independent model of the unicode-only guard: drop `\\` pairs, then search. */
const UNICODE_ONLY_MODEL = /\\[pP]\{|\\u\{|\\u[dD][89a-fA-F][0-9a-fA-F]{2}|[\uD800-\uDFFF]/;
const PATTERN_PIECES = [
  "\\",
  "\\",
  "p",
  "P",
  "u",
  "{",
  "}",
  "2",
  "d",
  "D",
  "8",
  "b",
  "F",
  "0",
  "[",
  "]",
  "^",
  "+",
  "x",
  "\uD83D",
  "\uDE00",
  "\\uD83D",
  "\\u00e9",
];

test("pattern: the unicode-only guard is backslash-parity aware; accepted patterns match like u-mode", () => {
  Prop.assert(
    Arb.integer(0, 0x7fffffff),
    (seed) => {
      const r = G.rng(seed);
      let pattern = "";
      for (let i = Math.floor(r() * 10); i > 0; i--) {
        pattern += PATTERN_PIECES[Math.floor(r() * PATTERN_PIECES.length)];
      }
      const res = S.fromJsonSchema({ type: "string", pattern });
      const expect = UNICODE_ONLY_MODEL.test(pattern.replace(/\\\\/g, "\u0000"));
      const guarded = !res[0] && res[1].includes("needs unicode mode");
      if (guarded !== expect) throw new Error(`seed=${seed} pattern=${JSON.stringify(pattern)}`);
      if (res[0]) {
        // No unicode-only construct: legacy and u-mode agree on BMP strings
        const u = new RegExp(pattern, "u");
        const check = compile(res[1]);
        for (let j = 0; j < 4; j++) {
          let s = "";
          for (let k = Math.floor(r() * 5); k > 0; k--)
            s += "\\pPu{}2dD8bF0x\u00e9"[Math.floor(r() * 15)];
          if (check(s)[0] !== u.test(s)) {
            throw new Error(
              `seed=${seed} pattern=${JSON.stringify(pattern)} s=${JSON.stringify(s)}`,
            );
          }
        }
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("length / count keywords: Ok iff a non-negative integer; bad `type` entries never throw", () => {
  const values = Arb.oneOf(
    Arb.integer(-5, 100),
    Arb.float(),
    Arb.constant(-0),
    Arb.constant(Number.MAX_SAFE_INTEGER + 2),
  );
  const keywords = ["minLength", "maxLength", "minItems", "maxItems"] as const;
  Prop.assert(
    Arb.tuple(values, Arb.integer(0, 3), Arb.integer(0, 0x7fffffff)),
    ([v, k, seed]) => {
      const kw = keywords[k];
      const type = k < 2 ? "string" : "array";
      const res = S.fromJsonSchema({ type, [kw]: v });
      if (res[0] !== (Number.isInteger(v) && v >= 0)) throw new Error(`${kw}: ${v}`);
      // `type` lists: Err (never a throw) unless every entry is a known, unique name
      const r = G.rng(seed);
      const pool: unknown[] = ["string", "null", "number", "array", 1n, [], {}, null, "x", 7];
      const list: unknown[] = [];
      for (let i = 1 + Math.floor(r() * 4); i > 0; i--)
        list.push(pool[Math.floor(r() * pool.length)]);
      if (r() < 0.2) list.push(list);
      const t = S.fromJsonSchema({ type: list } as never);
      const valid =
        list.every(
          (x) => typeof x === "string" && ["string", "null", "number", "array"].includes(x),
        ) && new Set(list).size === list.length;
      return t[0] === valid;
    },
    { numRuns: NUM_RUNS },
  );
});

test("prefixItems without a fixed length: Ok iff its tuple expansion fits the node cap", () => {
  // Each Ok case builds up to 50k nodes, so this runs far fewer cases than
  // the 1M default; the Err side is O(n) and the boundary is ~n = 315.
  Prop.assert(
    Arb.tuple(Arb.integer(0, 600), Arb.integer(0, 650), Arb.integer(0, 650)),
    ([n, a, b]) => {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const js = {
        type: "array",
        prefixItems: Array.from({ length: n }, () => ({})),
        items: false,
      };
      const res = S.fromJsonSchema({ ...js, minItems: min, maxItems: max });
      const lo = min;
      const hi = Math.min(n, max);
      const count = hi - lo + 1;
      const expectOk = lo >= hi || 1 + count + (count * (lo + hi)) / 2 <= 50_000;
      if (res[0] !== expectOk) throw new Error(`n=${n} min=${min} max=${max}: ${String(res[1])}`);
      if (!res[0] && !res[1].startsWith("prefixItems without a fixed length")) return false;
      return true;
    },
    { numRuns: 2_000 },
  );
});
