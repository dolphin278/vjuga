import { test } from "node:test";
import * as S from "../../schema/Schema.js";
import * as ST from "../../schema/TOON.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

const NUM_RUNS = 500;

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
  const par = ST.parse(schema, { flexibleOrder: true });
  Prop.assert(
    Arb.record({
      a: Arb.integer(0, 1000),
      b: Arb.filter(Arb.string({ maxLength: 20 }), (s) => !s.includes("\n")),
      c: Arb.boolean(),
    }),
    (obj) => {
      // Emit in reverse order
      const toon = `c: ${obj.c}\nb: ${obj.b}\na: ${obj.a}`;
      const r = par(toon);
      return r[0] === true && r[1].a === obj.a && r[1].b === obj.b && r[1].c === obj.c;
    },
    { numRuns: NUM_RUNS },
  );
});
