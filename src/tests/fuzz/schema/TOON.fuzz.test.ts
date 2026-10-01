import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../../schema/Schema.js";
import * as ST from "../../../schema/TOON.js";
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
