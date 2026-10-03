import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../../schema/Schema.js";
import * as SJ from "../../../schema/JSON.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import type { Result } from "../../../Result.js";
import * as G from "./_serial-gen.js";

const NUM_RUNS = 1_000_000;

// ---------------------------------------------------------------------------
// stringify → parse round-trip
// ---------------------------------------------------------------------------

test("string round-trips through JSON stringify/parse", () => {
  const str = SJ.stringify(S.string());
  const par = SJ.parse(S.string());
  Prop.assert(
    Arb.string(),
    (s) => {
      const r = par(str(s));
      return r[0] === true && r[1] === s;
    },
    { numRuns: NUM_RUNS },
  );
});

test("number round-trips through JSON stringify/parse", () => {
  const str = SJ.stringify(S.number());
  const par = SJ.parse(S.number());
  Prop.assert(
    Arb.filter(Arb.float(), (n) => !Number.isNaN(n) && isFinite(n)),
    (n) => {
      const r = par(str(n));
      return r[0] === true && r[1] === n;
    },
    { numRuns: NUM_RUNS },
  );
});

test("integer round-trips through JSON stringify/parse", () => {
  const str = SJ.stringify(S.integer());
  const par = SJ.parse(S.integer());
  Prop.assert(
    Arb.integer(-10000, 10000),
    (n) => {
      const r = par(str(n));
      return r[0] === true && r[1] === n;
    },
    { numRuns: NUM_RUNS },
  );
});

test("boolean round-trips through JSON stringify/parse", () => {
  const str = SJ.stringify(S.boolean());
  const par = SJ.parse(S.boolean());
  Prop.assert(
    Arb.boolean(),
    (b) => {
      const r = par(str(b));
      return r[0] === true && r[1] === b;
    },
    { numRuns: NUM_RUNS },
  );
});

test("object round-trips through JSON stringify/parse", () => {
  const schema = S.object({ id: S.integer(), name: S.string(), active: S.boolean() });
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  Prop.assert(
    Arb.record({ id: Arb.integer(0, 10000), name: Arb.string(), active: Arb.boolean() }),
    (obj) => {
      const r = par(str(obj));
      if (!r[0]) return false;
      return r[1].id === obj.id && r[1].name === obj.name && r[1].active === obj.active;
    },
    { numRuns: NUM_RUNS },
  );
});

test("array of integers round-trips through JSON stringify/parse", () => {
  const schema = S.array(S.integer());
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { maxLength: 50 }),
    (arr) => {
      const r = par(str(arr));
      if (!r[0]) return false;
      if (r[1].length !== arr.length) return false;
      for (let i = 0; i < arr.length; i++) {
        if (r[1][i] !== arr[i]) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("nested objects round-trip through JSON stringify/parse", () => {
  const schema = S.object({
    user: S.object({ name: S.string(), score: S.integer() }),
    tags: S.array(S.string()),
  });
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  Prop.assert(
    Arb.record({
      user: Arb.record({ name: Arb.string(), score: Arb.integer(0, 100) }),
      tags: Arb.array(Arb.string({ maxLength: 20 }), { maxLength: 10 }),
    }),
    (obj) => {
      const r = par(str(obj));
      return r[0] === true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// stringify output matches JSON.stringify
// ---------------------------------------------------------------------------

test("stringify matches JSON.stringify for simple objects", () => {
  const schema = S.object({ a: S.integer(), b: S.string() });
  const str = SJ.stringify(schema);
  Prop.assert(
    Arb.record({ a: Arb.integer(0, 1000), b: Arb.string({ maxLength: 50 }) }),
    (obj) => str(obj) === JSON.stringify(obj),
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// parse rejects invalid JSON
// ---------------------------------------------------------------------------

test("parse rejects random non-JSON strings", () => {
  const par = SJ.parse(S.object({ x: S.integer() }));
  Prop.assert(
    Arb.filter(Arb.string(), (s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    }),
    (s) => par(s)[0] === false,
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// parse rejects type mismatches
// ---------------------------------------------------------------------------

test("parse rejects wrong types in objects", () => {
  const par = SJ.parse(S.object({ x: S.integer() }));
  Prop.assert(Arb.string(), (s) => par(JSON.stringify({ x: s }))[0] === false, {
    numRuns: NUM_RUNS,
  });
});

// ---------------------------------------------------------------------------
// Optional field round-trip
// ---------------------------------------------------------------------------

test("optional fields round-trip", () => {
  const schema = S.object({ name: S.string(), age: S.optional(S.integer()) });
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);

  // With age present
  Prop.assert(
    Arb.record({ name: Arb.string(), age: Arb.integer(0, 200) }),
    (obj) => {
      const r = par(str(obj));
      return r[0] === true && r[1].name === obj.name && r[1].age === obj.age;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Random-schema round-trip (G9-4/5/9 regression net)
// ---------------------------------------------------------------------------

// Distinct schemas come from a bounded seed space and are cached, so 1M runs
// do not pay 1M `new Function` compilations; values vary on every run.
const SCHEMA_SEEDS = 20_000;
// Untyped views of the factories — `Infer<Schema>` on a dynamic schema is too deep for tsc.
const jsonStringify = SJ.stringify as unknown as (s: S.Schema) => (v: unknown) => string;
const jsonParse = SJ.parse as unknown as (s: S.Schema) => (s: string) => Result<unknown, unknown>;
const jsonCache = new Map<
  number,
  { schema: S.Schema; str: (v: unknown) => string; par: (s: string) => Result<unknown, unknown> }
>();

test("random schemas round-trip through schema/JSON and agree with native JSON", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 12 })),
    ([n, s]) => {
      const seed = G.hashSeed(n + ":" + s);
      const schemaSeed = seed % SCHEMA_SEEDS;
      let c = jsonCache.get(schemaSeed);
      if (c === undefined) {
        // Includes prototype-colliding keys (constructor, toString, ...).
        const { schema } = G.genSchema(G.rng(schemaSeed ^ 0x9e3779b9), {
          toon: false,
          protoKeys: true,
        });
        c = { schema, str: jsonStringify(schema), par: jsonParse(schema) };
        jsonCache.set(schemaSeed, c);
      }
      const value = G.genValue(G.rng(seed), c.schema);
      const out = c.str(value);
      const why = G.describeCase(seed, c.schema, value, out);
      // Output is valid JSON that decodes to the value (absent ≡ undefined)
      assert.deepStrictEqual(JSON.parse(out), G.normalize(value), why);
      const back = c.par(out);
      assert.ok(back[0], why + "\nerr=" + JSON.stringify(back[1]));
      assert.deepStrictEqual(G.normalize(back[1]), G.normalize(value), why);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// allOf(s, s) resolves its shapes per value (no single compiled shape): it
// must serialize every valid value exactly as the compiled `s` does.
const dupCache = new Map<
  number,
  { schema: S.Schema; a: (v: unknown) => string; b: (v: unknown) => string }
>();

test("stringify of allOf(s, s) decodes to the same JSON as stringify of s", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 12 })),
    ([n, s]) => {
      const seed = G.hashSeed(n + ":" + s);
      const schemaSeed = seed % SCHEMA_SEEDS;
      let c = dupCache.get(schemaSeed);
      if (c === undefined) {
        const { schema } = G.genSchema(G.rng(schemaSeed ^ 0x51ed27), G.DEFAULT_CFG);
        c = { schema, a: jsonStringify(schema), b: jsonStringify(S.allOf(schema, schema)) };
        dupCache.set(schemaSeed, c);
      }
      const value = G.genValue(G.rng(seed), c.schema);
      const want = c.a(value);
      const got = c.b(value);
      assert.deepStrictEqual(
        JSON.parse(got),
        JSON.parse(want),
        G.describeCase(seed, c.schema, value, got),
      );
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// G3: values without a JSON form, escaped __proto__ spellings
// ---------------------------------------------------------------------------

/** A value tree whose leaves include functions, symbols and undefined. */
function genWild(r: G.Rng, depth: number): unknown {
  const x = Math.floor(r() * (depth >= 3 ? 7 : 9));
  switch (x) {
    case 0:
      return () => 1;
    case 1:
      return Symbol("s");
    case 2:
      return undefined;
    case 3:
      return null;
    case 4:
      return Math.floor(r() * 100);
    case 5:
      return "s" + Math.floor(r() * 10);
    case 6:
      return r() < 0.5;
    case 7: {
      const a: unknown[] = [];
      for (let i = Math.floor(r() * 4); i > 0; i--) a.push(genWild(r, depth + 1));
      return a;
    }
    default: {
      const o: Record<string, unknown> = {};
      for (let i = Math.floor(r() * 4); i > 0; i--) o["k" + i] = genWild(r, depth + 1);
      return o;
    }
  }
}

const wildSchemas: S.Schema[] = [
  S.unknown(),
  S.array(S.unknown()),
  S.record(S.unknown()),
  S.record(S.optional(S.unknown())),
  S.object({
    k1: S.optional(S.unknown()),
    k2: S.optional(S.not(S.null_())),
    k3: S.optional(S.unknown()),
  }),
  S.tuple(S.unknown(), S.unknown()),
];
const wildStr = wildSchemas.map((s) => jsonStringify(s));

test("unknown / not values serialize exactly like native JSON.stringify", () => {
  Prop.assert(
    Arb.integer(0, 0x7fffffff),
    (seed) => {
      const r = G.rng(seed);
      const i = Math.floor(r() * wildSchemas.length);
      const kind = wildSchemas[i].kind;
      let v: unknown = genWild(r, 0);
      if (kind === "array") v = Array.isArray(v) ? v : [v];
      else if (kind === "tuple") v = [genWild(r, 1), genWild(r, 1)];
      else if (kind === "object") {
        // Declared keys only; not(null) never holds null
        const k2 = genWild(r, 1);
        v = { k1: genWild(r, 1), k2: k2 === null ? 0 : k2, k3: genWild(r, 1) };
      } else if (kind === "record" && (typeof v !== "object" || v === null || Array.isArray(v))) {
        v = { k1: v };
      }
      assert.equal(wildStr[i](v), JSON.stringify(v) ?? "null", `seed=${seed} schema=${i}`);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

const unknownParse = jsonParse(S.unknown());
const PROTO = "__proto__";

/** Native parse with own `__proto__` keys removed — what SJ.parse must return. */
function nativeStripped(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(nativeStripped);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (k !== PROTO) out[k] = nativeStripped((v as Record<string, unknown>)[k]);
  }
  return out;
}

function hasOwnProto(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasOwnProto);
  if (typeof v !== "object" || v === null) return false;
  if (Object.hasOwn(v, PROTO)) return true;
  return Object.values(v).some(hasOwnProto);
}

/** `__proto__` (or a near miss) with each char literal or \u-escaped in random hex case. */
function genEscapedKey(r: G.Rng): string {
  const bases = ["__proto__", "__proto__", "__proto_", "_proto__", "__protO__", "é", "a"];
  const base = bases[Math.floor(r() * bases.length)];
  let k = "";
  for (let i = 0; i < base.length; i++) {
    if (r() < 0.4) {
      const hex = base.charCodeAt(i).toString(16).padStart(4, "0");
      k += "\\u" + (r() < 0.5 ? hex : hex.toUpperCase());
    } else k += base[i];
  }
  return k;
}

function genEscapedDoc(r: G.Rng, depth: number): string {
  const x = depth >= 3 ? 0 : Math.floor(r() * 3);
  if (x === 0) return String(Math.floor(r() * 10));
  if (x === 1) {
    const items: string[] = [];
    for (let i = Math.floor(r() * 3); i > 0; i--) items.push(genEscapedDoc(r, depth + 1));
    return "[" + items.join(",") + "]";
  }
  const entries: string[] = [];
  for (let i = Math.floor(r() * 4); i > 0; i--) {
    entries.push(`"${genEscapedKey(r)}":${genEscapedDoc(r, depth + 1)}`);
  }
  return "{" + entries.join(",") + "}";
}

test("parse never returns an own __proto__ key, however it is escaped", () => {
  Prop.assert(
    Arb.integer(0, 0x7fffffff),
    (seed) => {
      const text = genEscapedDoc(G.rng(seed), 0);
      const r = unknownParse(text);
      assert.ok(r[0], text);
      assert.ok(!hasOwnProto(r[1]), text);
      assert.deepStrictEqual(r[1], nativeStripped(JSON.parse(text)), text);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});
