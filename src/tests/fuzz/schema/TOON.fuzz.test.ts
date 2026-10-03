import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../../schema/Schema.js";
import * as ST from "../../../schema/TOON.js";
import * as V from "../../../schema/Validate.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import type { Result } from "../../../Result.js";
import * as G from "./_serial-gen.js";

const NUM_RUNS = 1_000_000;

// ---------------------------------------------------------------------------
// stringify → parse round-trip for primitives
// ---------------------------------------------------------------------------

test("string round-trips through TOON", () => {
  const schema = S.object({ v: S.string() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.filter(Arb.string({ maxLength: 100 }), (s) => !s.includes("\n")),
    (s) => {
      const r = par(str({ v: s }));
      return r[0] === true && r[1].v === s;
    },
    { numRuns: NUM_RUNS },
  );
});

test("integer round-trips through TOON", () => {
  const schema = S.object({ n: S.integer() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.integer(-10000, 10000),
    (n) => {
      const r = par(str({ n }));
      return r[0] === true && r[1].n === n;
    },
    { numRuns: NUM_RUNS },
  );
});

test("boolean round-trips through TOON", () => {
  const schema = S.object({ b: S.boolean() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.boolean(),
    (b) => {
      const r = par(str({ b }));
      return r[0] === true && r[1].b === b;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Object round-trip with multiple fields
// ---------------------------------------------------------------------------

test("multi-field object round-trips through TOON", () => {
  const schema = S.object({ id: S.integer(), name: S.string(), active: S.boolean() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.record({
      id: Arb.integer(0, 10000),
      name: Arb.filter(Arb.string({ maxLength: 50 }), (s) => !s.includes("\n")),
      active: Arb.boolean(),
    }),
    (obj) => {
      const r = par(str(obj));
      return (
        r[0] === true && r[1].id === obj.id && r[1].name === obj.name && r[1].active === obj.active
      );
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Inline array round-trip
// ---------------------------------------------------------------------------

test("inline integer array round-trips through TOON", () => {
  const schema = S.object({ nums: S.array(S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { maxLength: 30 }),
    (nums) => {
      const r = par(str({ nums }));
      if (!r[0]) return false;
      if (r[1].nums.length !== nums.length) return false;
      for (let i = 0; i < nums.length; i++) {
        if (r[1].nums[i] !== nums[i]) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Tabular array round-trip
// ---------------------------------------------------------------------------

test("tabular object array round-trips through TOON", () => {
  const schema = S.object({
    items: S.array(S.object({ id: S.integer(), name: S.string() })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.array(
      Arb.record({
        id: Arb.integer(0, 10000),
        name: Arb.filter(
          Arb.string({ minLength: 1, maxLength: 20 }),
          (s) => !s.includes("\n") && !s.includes(","),
        ),
      }),
      { maxLength: 20 },
    ),
    (items) => {
      const r = par(str({ items }));
      if (!r[0]) return false;
      if (r[1].items.length !== items.length) return false;
      for (let i = 0; i < items.length; i++) {
        if (r[1].items[i].id !== items[i].id) return false;
        if (r[1].items[i].name !== items[i].name) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Tuple round-trip
// ---------------------------------------------------------------------------

test("tuple round-trips through TOON", () => {
  const schema = S.object({ pair: S.tuple(S.integer(), S.boolean()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.tuple(Arb.integer(-1000, 1000), Arb.boolean()),
    ([a, b]) => {
      const r = par(str({ pair: [a, b] }));
      return r[0] === true && r[1].pair[0] === a && r[1].pair[1] === b;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Nested object round-trip
// ---------------------------------------------------------------------------

test("nested object round-trips through TOON", () => {
  const schema = S.object({
    user: S.object({ name: S.string(), score: S.integer() }),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.record({
      name: Arb.filter(Arb.string({ maxLength: 30 }), (s) => !s.includes("\n")),
      score: Arb.integer(0, 100),
    }),
    (user) => {
      const r = par(str({ user }));
      return r[0] === true && r[1].user.name === user.name && r[1].user.score === user.score;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Optional field round-trip
// ---------------------------------------------------------------------------

test("optional field round-trips through TOON (absent)", () => {
  const schema = S.object({ name: S.string(), age: S.optional(S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.filter(Arb.string({ maxLength: 30 }), (s) => !s.includes("\n")),
    (name) => {
      const r = par(str({ name }));
      return r[0] === true && r[1].name === name && r[1].age === undefined;
    },
    { numRuns: NUM_RUNS },
  );
});

test("optional field round-trips through TOON (present)", () => {
  const schema = S.object({ name: S.string(), age: S.optional(S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.record({
      name: Arb.filter(Arb.string({ maxLength: 30 }), (s) => !s.includes("\n")),
      age: Arb.integer(0, 200),
    }),
    (obj) => {
      const r = par(str(obj));
      return r[0] === true && r[1].name === obj.name && r[1].age === obj.age;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Record round-trip
// ---------------------------------------------------------------------------

test("record of numbers round-trips through TOON", () => {
  const schema = S.record(S.integer());
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  Prop.assert(
    Arb.dictionary(
      // TOON keys must be non-empty, no newlines, no colons, no leading/trailing spaces
      Arb.filter(
        Arb.string({ minLength: 1, maxLength: 10 }),
        (s) => s.trim() === s && !s.includes("\n") && !s.includes(":") && !s.includes(" "),
      ),
      Arb.integer(-1000, 1000),
    ),
    (rec) => {
      const r = par(str(rec));
      if (!r[0]) return false;
      const keys = Object.keys(rec);
      for (let i = 0; i < keys.length; i++) {
        if (r[1][keys[i]] !== rec[keys[i]]) return false;
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Flexible order parse
// ---------------------------------------------------------------------------

test("flexible order parses fields in any order", () => {
  const schema = S.object({ a: S.integer(), b: S.string(), c: S.boolean() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema, { flexibleOrder: true });
  Prop.assert(
    Arb.record({
      a: Arb.integer(0, 1000),
      b: Arb.filter(Arb.string({ maxLength: 20 }), (s) => !s.includes("\n")),
      c: Arb.boolean(),
    }),
    (obj) => {
      // Use ST.stringify to produce correctly-quoted TOON, then reverse lines to
      // test flexible-order parsing. Raw interpolation breaks for string values
      // that TOON treats as quoted (e.g. '""' → parsed as empty string).
      const lines = str(obj).split("\n");
      lines.reverse();
      const r = par(lines.join("\n"));
      return r[0] === true && r[1].a === obj.a && r[1].b === obj.b && r[1].c === obj.c;
    },
    { numRuns: NUM_RUNS },
  );
});

// ---------------------------------------------------------------------------
// Random-schema round-trip (G9-1/2/3/5/6/7/11/13/15 regression net)
// ---------------------------------------------------------------------------

interface CompiledToon {
  readonly schema: S.Schema;
  readonly fns: {
    str: (v: unknown) => string;
    par: (s: string) => Result<unknown, unknown>;
    flex: (s: string) => Result<unknown, unknown>;
  } | null;
}

// Distinct schemas are drawn from a bounded seed space and cached, so 1M runs
// do not pay 1M `new Function` compilations; values vary on every run.
const SCHEMA_SEEDS = 20_000;
// Untyped views of the factories — `Infer<Schema>` on a dynamic schema is too deep for tsc.
const toonStringify = ST.stringify as unknown as (
  s: S.Schema,
  o?: ST.ToonStringifyOptions,
) => (v: unknown) => string;
const toonParse = ST.parse as unknown as (
  s: S.Schema,
  o?: ST.ToonParseOptions,
) => (s: string) => Result<unknown, unknown>;
const toonCache = new Map<number, CompiledToon>();

function compileToon(schemaSeed: number): CompiledToon {
  const hit = toonCache.get(schemaSeed);
  if (hit !== undefined) return hit;
  const r = G.rng(schemaSeed ^ 0x9e3779b9);
  const gen = G.genSchema(r, { toon: true, protoKeys: true });
  const opts = {
    delimiter: ([",", "\t", "|"] as const)[Math.floor(r() * 3)],
    indent: [2, 1, 4][Math.floor(r() * 3)],
  };
  let entry: CompiledToon;
  if (gen.unsupported) {
    // Both factories must reject the same shapes, with the documented error.
    assert.throws(
      () => toonStringify(gen.schema, opts),
      /TOON: unsupported/,
      JSON.stringify(gen.schema),
    );
    assert.throws(
      () => toonParse(gen.schema, opts),
      /TOON: unsupported/,
      JSON.stringify(gen.schema),
    );
    entry = { schema: gen.schema, fns: null };
  } else {
    entry = {
      schema: gen.schema,
      fns: {
        str: toonStringify(gen.schema, opts),
        par: toonParse(gen.schema, opts),
        flex: toonParse(gen.schema, { ...opts, flexibleOrder: true }),
      },
    };
  }
  toonCache.set(schemaSeed, entry);
  return entry;
}

/** Reverse the order of top-level blocks (a block = a line at column 0 + its children). */
function reverseTopLevelBlocks(toon: string): string {
  const blocks: string[][] = [];
  for (const line of toon.split("\n")) {
    if (blocks.length === 0 || (line !== "" && line[0] !== " ")) blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  return blocks
    .reverse()
    .map((b) => b.join("\n"))
    .join("\n");
}

test("random schemas round-trip through TOON or are rejected at compile time", () => {
  let roundTrips = 0;
  let rejected = 0;
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 12 })),
    ([n, s]) => {
      const seed = G.hashSeed(n + ":" + s);
      const c = compileToon(seed % SCHEMA_SEEDS);
      if (c.fns === null) {
        rejected++;
        return true;
      }
      const value = G.genValue(G.rng(seed), c.schema);
      const out = c.fns.str(value);
      const why = G.describeCase(seed, c.schema, value, out);
      const expected = G.normalize(value);
      const back = c.fns.par(out);
      assert.ok(back[0], why + "\nerr=" + JSON.stringify(back[1]));
      assert.deepStrictEqual(G.normalize(back[1]), expected, why);
      const flex = c.fns.flex(out);
      assert.ok(flex[0], why + "\nflex err=" + JSON.stringify(flex[1]));
      assert.deepStrictEqual(G.normalize(flex[1]), expected, why);
      // Field order must not matter for flexible parsing of root objects.
      if (c.schema.kind === "object") {
        const shuffled = c.fns.flex(reverseTopLevelBlocks(out));
        assert.ok(shuffled[0], why + "\nshuffled err=" + JSON.stringify(shuffled[1]));
        assert.deepStrictEqual(G.normalize(shuffled[1]), expected, why);
      }
      roundTrips++;
      return true;
    },
    { numRuns: NUM_RUNS },
  );
  // Guard against a generator that only produces rejected shapes.
  assert.ok(roundTrips > rejected, `roundTrips=${roundTrips} rejected=${rejected}`);
});

// ---------------------------------------------------------------------------
// G3: constraints, number / string token grammar, header counts, flexible keys
// ---------------------------------------------------------------------------

const validateAny = V.validate as unknown as (
  s: S.Schema,
) => (v: unknown) => Result<unknown, unknown>;

/** A constrained schema `c` and its unconstrained twin `u` (same TOON layout). */
interface Twin {
  readonly c: S.Schema;
  readonly u: S.Schema;
}

function int(r: G.Rng, n: number): number {
  return Math.floor(r() * n);
}

function genConstrainedLeaf(r: G.Rng): Twin {
  switch (int(r, 4)) {
    case 0: {
      const k: { minLength?: number; maxLength?: number; pattern?: string } = {};
      if (r() < 0.5) k.minLength = int(r, 4);
      if (r() < 0.5) k.maxLength = 1 + int(r, 4);
      if (r() < 0.3) k.pattern = "^[ab]*$";
      return { c: S.string(k), u: S.string() };
    }
    case 1: {
      const k: { minimum?: number; maximum?: number; multipleOf?: number } = {};
      if (r() < 0.5) k.minimum = int(r, 7) - 3;
      if (r() < 0.5) k.maximum = int(r, 7) - 3;
      if (r() < 0.3) k.multipleOf = 2 + int(r, 2);
      return { c: S.integer(k), u: S.integer() };
    }
    case 2: {
      const k: { exclusiveMinimum?: number; exclusiveMaximum?: number } = {};
      if (r() < 0.5) k.exclusiveMinimum = int(r, 5) - 2;
      if (r() < 0.5) k.exclusiveMaximum = int(r, 5) - 2;
      return { c: S.number(k), u: S.number() };
    }
    default: {
      const t = genConstrainedLeaf(r);
      return { c: S.nullable(t.c), u: S.nullable(t.u) };
    }
  }
}

function genArrayOpts(r: G.Rng): { minItems?: number; maxItems?: number } {
  const o: { minItems?: number; maxItems?: number } = {};
  if (r() < 0.5) o.minItems = int(r, 3);
  if (r() < 0.5) o.maxItems = 1 + int(r, 3);
  return o;
}

function genTwinObject(r: G.Rng, depth: number, leavesOnly: boolean): Twin {
  const c: Record<string, S.Schema> = {};
  const u: Record<string, S.Schema> = {};
  const n = 1 + int(r, 3);
  for (let i = 0; i < n; i++) {
    let t = leavesOnly ? genConstrainedLeaf(r) : genTwin(r, depth + 1);
    if (r() < 0.3) t = { c: S.optional(t.c), u: S.optional(t.u) };
    c["k" + i] = t.c;
    u["k" + i] = t.u;
  }
  return { c: S.object(c), u: S.object(u) };
}

/** Objects, inline / tabular / list arrays and tuples over constrained leaves. */
function genTwin(r: G.Rng, depth = 0): Twin {
  const x = depth >= 2 ? 0 : int(r, 5);
  switch (x) {
    case 0:
      return genConstrainedLeaf(r);
    case 1:
      return genTwinObject(r, depth, false);
    case 2: {
      const item = r() < 0.5 ? genConstrainedLeaf(r) : genTwinObject(r, depth, r() < 0.5);
      const o = genArrayOpts(r);
      return { c: S.array(item.c, o), u: S.array(item.u) };
    }
    case 3: {
      const item = genTwin(r, depth + 1);
      return { c: S.array(item.c, genArrayOpts(r)), u: S.array(item.u) };
    }
    default: {
      const a = genConstrainedLeaf(r);
      const b = genTwin(r, depth + 1);
      return { c: S.tuple(a.c, b.c), u: S.tuple(a.u, b.u) };
    }
  }
}

/** A value of the unconstrained twin — violates the constraints about half the time. */
function genLoose(r: G.Rng, s: S.Schema): unknown {
  switch (s.kind) {
    case "string":
      return ["", "a", "ab", "abc", "abcd", "x", "ba", "b c"][int(r, 8)];
    case "integer":
      return int(r, 11) - 5;
    case "number":
      return (int(r, 11) - 5) / 2;
    case "nullable":
      return r() < 0.3 ? null : genLoose(r, s.meta.inner);
    case "optional":
      return r() < 0.3 ? undefined : genLoose(r, s.meta.inner);
    case "array": {
      const out: unknown[] = [];
      const n = int(r, 5);
      for (let i = 0; i < n; i++) out.push(genLoose(r, s.meta.items));
      return out;
    }
    case "tuple":
      return (s.meta.items as S.Schema[]).map((it) => genLoose(r, it));
    case "object": {
      const out: Record<string, unknown> = {};
      const props = s.meta.properties as Record<string, S.Schema>;
      for (const k of Object.keys(props)) {
        const v = genLoose(r, props[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    default:
      throw new Error("genLoose: unexpected kind " + s.kind);
  }
}

/** Line-level mutations of a TOON document (drop / duplicate / swap / re-indent / insert). */
function mutateToon(r: G.Rng, t: string): string {
  const lines = t.split("\n");
  const i = int(r, lines.length);
  switch (int(r, 6)) {
    case 0:
      lines.splice(i, 1);
      break;
    case 1:
      lines.splice(i, 0, lines[i]);
      break;
    case 2: {
      const j = int(r, lines.length);
      const tmp = lines[i];
      lines[i] = lines[j];
      lines[j] = tmp;
      break;
    }
    case 3:
      lines[i] = " " + lines[i];
      break;
    case 4:
      lines[i] = lines[i].slice(1);
      break;
    default: {
      const s = lines[i];
      const k = int(r, s.length + 1);
      const ins = ["-", '"', ",", ":", "null", "1", "0", "9", " ", "\\", "a"][int(r, 11)];
      lines[i] = s.slice(0, k) + ins + s.slice(k);
    }
  }
  return lines.join("\n");
}

interface CompiledTwin {
  readonly twin: Twin;
  readonly str: (v: unknown) => string;
  readonly par: (s: string) => Result<unknown, unknown>;
  readonly val: (v: unknown) => Result<unknown, unknown>;
}
const twinCache = new Map<number, CompiledTwin>();

function compileTwin(schemaSeed: number): CompiledTwin {
  let c = twinCache.get(schemaSeed);
  if (c === undefined) {
    const r = G.rng(schemaSeed ^ 0x2545f491);
    const twin = genTwin(r);
    const opts = { delimiter: ([",", "\t", "|"] as const)[int(r, 3)], indent: 1 + int(r, 3) };
    c = {
      twin,
      str: toonStringify(twin.u, opts),
      par: toonParse(twin.c, { ...opts, flexibleOrder: r() < 0.3 }),
      val: validateAny(twin.c),
    };
    twinCache.set(schemaSeed, c);
  }
  return c;
}

test("parse enforces constraints exactly like validate, and accepts nothing validate rejects", () => {
  let accepted = 0;
  let rejected = 0;
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 12 })),
    ([n, s]) => {
      const seed = G.hashSeed(n + ":" + s);
      const c = compileTwin(seed % SCHEMA_SEEDS);
      const r = G.rng(seed);
      const value = genLoose(r, c.twin.u);
      const out = c.str(value);
      const why = G.describeCase(seed, c.twin.c, value, out);
      const want = c.val(value)[0];
      const got = c.par(out);
      assert.equal(got[0], want, why + "\nparse=" + JSON.stringify(got));
      if (got[0]) {
        accepted++;
        assert.deepStrictEqual(G.normalize(got[1]), G.normalize(value), why);
      } else rejected++;
      // Soundness on malformed text: whatever parses also validates
      for (let m = 0; m < 3; m++) {
        const text = mutateToon(r, out);
        const res = c.par(text);
        if (res[0]) {
          assert.ok(c.val(res[1])[0], why + "\nmutated=" + JSON.stringify(text));
        }
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
  assert.ok(accepted > NUM_RUNS / 10 && rejected > NUM_RUNS / 10, `${accepted}/${rejected}`);
});

const NUMBER_GRAMMAR = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const numberParse = toonParse(S.number());
const unionParse = toonParse(S.union(S.number(), S.string()));

test("number tokens follow the JSON number grammar exactly", () => {
  const alphabet = "0123456789-+.eE0011x ";
  Prop.assert(
    Arb.array(Arb.integer(0, alphabet.length - 1), { maxLength: 9 }),
    (idx) => {
      let tok = "";
      for (const i of idx) tok += alphabet[i];
      tok = tok.trim();
      const r = numberParse(tok);
      const n = Number(tok);
      const valid = NUMBER_GRAMMAR.test(tok) && Number.isFinite(n);
      assert.equal(r[0], valid, JSON.stringify(tok));
      if (valid) assert.ok(Object.is(r[1], n), tok);
      // Untyped (primitive union): non-numbers that are not keywords stay text
      const u = unionParse(tok);
      if (valid) assert.ok(Object.is(u[1], n), tok);
      else if (tok !== "") assert.equal(u[1], tok, tok);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

const QUOTED_GRAMMAR = /^"(?:[^"\\]|\\["\\nrt]|\\u[0-9a-fA-F]{4})*"$/;
const stringParse = toonParse(S.string());

const fieldStringParse = toonParse(S.object({ a: S.string(), b: S.integer() }));
const cellStringParse = toonParse(S.array(S.string()));

test("quoted tokens decode iff well-formed (spec §7.1 escapes), space-padded or not", () => {
  const alphabet = ['"', "\\", "a", "n", "t", "r", "u", "0", "0", "F", "x", ",", "/", "b", " "];
  Prop.assert(
    Arb.tuple(
      Arb.array(Arb.integer(0, alphabet.length - 1), { maxLength: 10 }),
      Arb.boolean(),
      Arb.integer(0, 2),
      Arb.integer(0, 2),
    ),
    ([idx, close, before, after]) => {
      let tok = '"';
      for (const i of idx) tok += alphabet[i];
      if (close) tok += '"';
      const padded = " ".repeat(before) + tok + " ".repeat(after);
      // Surrounding U+0020 spaces are not part of the token (spec §12)
      const inner = padded.replace(/^ +| +$/g, "");
      const valid = QUOTED_GRAMMAR.test(inner);
      // Within this alphabet the accepted grammar is a subset of JSON's
      const want = valid ? JSON.parse(inner) : undefined;
      const root = stringParse(padded);
      assert.equal(root[0], valid, padded);
      if (valid) assert.equal(root[1], want, padded);
      const field = fieldStringParse("a: " + padded + "\nb: 1");
      assert.equal(field[0], valid, padded);
      if (valid) assert.deepStrictEqual(field[1], { a: want, b: 1 }, padded);
      // As a cell: only when the token holds no delimiter outside its quotes
      if (!padded.includes(",") && !padded.includes("\\")) {
        const cell = cellStringParse("[2]: " + padded + ", x ");
        assert.equal(cell[0], valid, padded);
        if (valid) assert.deepStrictEqual(cell[1], [want, "x"], padded);
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

const headerParse = toonParse(S.object({ xs: S.array(S.string()) }));
const listHeaderParse = toonParse(S.array(S.object({ a: S.integer(), b: S.array(S.integer()) })));

test("array header counts of any size are an Err or a value, never a throw", () => {
  Prop.assert(
    Arb.array(Arb.integer(0, 9), { minLength: 1, maxLength: 40 }),
    (digits) => {
      const n = digits.join("");
      const r = headerParse(`xs[${n}]: a`);
      assert.equal(r[0], Number(n) === 1, n);
      const l = listHeaderParse(`[${n}]:\n  - a: 1\n    b[${n}]: 2`);
      assert.equal(l[0], Number(n) === 1, n);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

const flexClosed = toonParse(
  S.object({ a: S.integer(), b: S.optional(S.integer()), c: S.integer() }),
  { flexibleOrder: true },
);
const flexOpen = toonParse(
  S.object(
    { a: S.integer(), b: S.optional(S.integer()), c: S.integer() },
    {
      additionalProperties: true,
    },
  ),
  { flexibleOrder: true },
);

test("flexible order: any order of unique declared keys, nothing else", () => {
  const pool = ["a", "b", "c", "x", '"a"', "__proto__"];
  Prop.assert(
    Arb.array(Arb.integer(0, pool.length - 1), { maxLength: 6 }),
    (idx) => {
      const keys = idx.map((i) => pool[i]);
      const names = keys.map((k) => (k === '"a"' ? "a" : k));
      const text = keys.map((k, i) => `${k}: ${i}`).join("\n");
      const unique = new Set(names).size === names.length;
      const required = names.includes("a") && names.includes("c");
      const declared = names.every((k) => k === "a" || k === "b" || k === "c");
      const expected: Record<string, number> = {};
      names.forEach((k, i) => {
        if (k === "a" || k === "b" || k === "c") expected[k] = i;
      });
      const closed = flexClosed(text);
      assert.equal(closed[0], unique && required && declared, text);
      if (closed[0]) assert.deepStrictEqual({ ...(closed[1] as object) }, expected, text);
      const open = flexOpen(text);
      assert.equal(open[0], unique && required, text);
      if (open[0]) assert.deepStrictEqual({ ...(open[1] as object) }, expected, text);
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});

test("indent: an integer >= 1 compiles, anything else throws TypeError", () => {
  const schema = S.object({ o: S.object({ a: S.integer() }) });
  Prop.assert(
    Arb.oneOf(
      Arb.integer(-3, 9),
      Arb.float(-3, 9),
      Arb.constantFrom(NaN, Infinity, -Infinity, 0.5, 2.0000001),
    ),
    (indent) => {
      const ok = Number.isInteger(indent) && indent >= 1;
      for (const make of [toonStringify, toonParse]) {
        if (ok) make(schema, { indent });
        else assert.throws(() => make(schema, { indent }), TypeError);
      }
      if (ok) {
        const out = toonStringify(schema, { indent })({ o: { a: 1 } });
        assert.equal(out, "o:\n" + " ".repeat(indent) + "a: 1");
        assert.deepStrictEqual(toonParse(schema, { indent })(out), [true, { o: { a: 1 } }]);
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
});
