import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as ST from "../../schema/TOON.js";
import type { SchemaError } from "../../schema/Validate.js";
import { assertOk, assertErr } from "./_helpers.js";

// ---------------------------------------------------------------------------
// stringify — primitives
// ---------------------------------------------------------------------------

test("stringify string", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("hello"), "hello");
  assert.equal(fn(""), '""');
});

test("stringify string requiring quotes", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("true"), '"true"');
  assert.equal(fn("false"), '"false"');
  assert.equal(fn("null"), '"null"');
  assert.equal(fn("a:b"), '"a:b"');
  assert.equal(fn('a"b'), '"a\\"b"');
  assert.equal(fn("123"), '"123"');
});

test("stringify number", () => {
  const fn = ST.stringify(S.number());
  assert.equal(fn(42), "42");
  assert.equal(fn(3.14), "3.14");
  assert.equal(fn(-1), "-1");
});

test("stringify integer", () => {
  const fn = ST.stringify(S.integer());
  assert.equal(fn(42), "42");
});

test("stringify boolean", () => {
  const fn = ST.stringify(S.boolean());
  assert.equal(fn(true), "true");
  assert.equal(fn(false), "false");
});

test("stringify null", () => {
  const fn = ST.stringify(S.null_());
  assert.equal(fn(null), "null");
});

test("stringify NaN/Infinity → null", () => {
  const fn = ST.stringify(S.number());
  assert.equal(fn(NaN), "null");
  assert.equal(fn(Infinity), "null");
});

// ---------------------------------------------------------------------------
// stringify — objects
// ---------------------------------------------------------------------------

test("stringify simple object", () => {
  const fn = ST.stringify(S.object({ id: S.integer(), name: S.string() }));
  assert.equal(fn({ id: 1, name: "Alice" }), "id: 1\nname: Alice");
});

test("stringify object with optional — present", () => {
  const fn = ST.stringify(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.equal(fn({ name: "Alice", age: 30 }), "name: Alice\nage: 30");
});

test("stringify object with optional — absent", () => {
  const fn = ST.stringify(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.equal(fn({ name: "Bob" }), "name: Bob");
});

test("stringify nested object", () => {
  const fn = ST.stringify(
    S.object({
      user: S.object({ name: S.string() }),
    }),
  );
  assert.equal(fn({ user: { name: "Alice" } }), "user:\n  name: Alice");
});

test("stringify nullable field — null", () => {
  const fn = ST.stringify(S.object({ x: S.nullable(S.string()) }));
  assert.equal(fn({ x: null }), "x: null");
});

test("stringify nullable field — present", () => {
  const fn = ST.stringify(S.object({ x: S.nullable(S.string()) }));
  assert.equal(fn({ x: "hello" }), "x: hello");
});

// ---------------------------------------------------------------------------
// stringify — arrays
// ---------------------------------------------------------------------------

test("stringify inline array of primitives", () => {
  const fn = ST.stringify(S.object({ tags: S.array(S.string()) }));
  const result = fn({ tags: ["admin", "user", "dev"] });
  assert.equal(result, "tags[3]: admin,user,dev");
});

test("stringify empty array", () => {
  const fn = ST.stringify(S.object({ tags: S.array(S.string()) }));
  assert.equal(fn({ tags: [] }), "tags[0]: ");
});

test("stringify inline array of numbers", () => {
  const fn = ST.stringify(S.object({ nums: S.array(S.integer()) }));
  assert.equal(fn({ nums: [1, 2, 3] }), "nums[3]: 1,2,3");
});

test("stringify tabular array", () => {
  const fn = ST.stringify(
    S.object({
      users: S.array(S.object({ id: S.integer(), name: S.string() })),
    }),
  );
  const result = fn({
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  });
  assert.equal(result, "users[2]{id,name}:\n  1,Alice\n  2,Bob");
});

test("stringify empty tabular array", () => {
  const fn = ST.stringify(
    S.object({
      items: S.array(S.object({ id: S.integer() })),
    }),
  );
  assert.equal(fn({ items: [] }), "items[0]{id}:");
});

test("stringify tuple", () => {
  const fn = ST.stringify(S.object({ pair: S.tuple(S.string(), S.integer()) }));
  assert.equal(fn({ pair: ["hello", 42] }), "pair[2]: hello,42");
});

// ---------------------------------------------------------------------------
// stringify — unions
// ---------------------------------------------------------------------------

test("stringify union — string | number", () => {
  const fn = ST.stringify(S.union(S.string(), S.number()));
  assert.equal(fn("hello"), "hello");
  assert.equal(fn(42), "42");
});

// ---------------------------------------------------------------------------
// stringify — records
// ---------------------------------------------------------------------------

test("stringify record", () => {
  const fn = ST.stringify(S.record(S.number()));
  const result = fn({ a: 1, b: 2 });
  assert.equal(result, "a: 1\nb: 2");
});

// ---------------------------------------------------------------------------
// parse — primitives
// ---------------------------------------------------------------------------

test("parse string", () => {
  const fn = ST.parse(S.string());
  assert.equal(assertOk(fn("hello")), "hello");
});

test("parse quoted string", () => {
  const fn = ST.parse(S.string());
  assert.equal(assertOk(fn('"hello world"')), "hello world");
});

test("parse number", () => {
  const fn = ST.parse(S.number());
  assert.equal(assertOk(fn("42")), 42);
  assert.equal(assertOk(fn("3.14")), 3.14);
});

test("parse integer", () => {
  const fn = ST.parse(S.integer());
  assert.equal(assertOk(fn("42")), 42);
  assertErr(fn("3.14"));
});

test("parse boolean", () => {
  const fn = ST.parse(S.boolean());
  assert.equal(assertOk(fn("true")), true);
  assert.equal(assertOk(fn("false")), false);
  assertErr(fn("yes"));
});

test("parse null", () => {
  assert.equal(assertOk(ST.parse(S.null_())("null")), null);
  assertErr(ST.parse(S.null_())(""));
});

// ---------------------------------------------------------------------------
// parse — objects
// ---------------------------------------------------------------------------

test("parse simple object", () => {
  const fn = ST.parse(S.object({ id: S.integer(), name: S.string() }));
  const r = assertOk(fn("id: 1\nname: Alice"));
  assert.deepEqual(r, { id: 1, name: "Alice" });
});

test("parse object with optional — present", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.deepEqual(assertOk(fn("name: Alice\nage: 30")), { name: "Alice", age: 30 });
});

test("parse object with optional — absent", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.deepEqual(assertOk(fn("name: Bob")), { name: "Bob" });
});

test("parse nested object", () => {
  const fn = ST.parse(S.object({ user: S.object({ name: S.string() }) }));
  assert.deepEqual(assertOk(fn("user:\n  name: Alice")), { user: { name: "Alice" } });
});

// ---------------------------------------------------------------------------
// parse — arrays
// ---------------------------------------------------------------------------

test("parse inline array", () => {
  const fn = ST.parse(S.object({ tags: S.array(S.string()) }));
  assert.deepEqual(assertOk(fn("tags[3]: admin,user,dev")), { tags: ["admin", "user", "dev"] });
});

test("parse empty inline array", () => {
  const fn = ST.parse(S.object({ tags: S.array(S.string()) }));
  assert.deepEqual(assertOk(fn("tags[0]: ")), { tags: [] });
});

test("parse tabular array", () => {
  const fn = ST.parse(
    S.object({
      users: S.array(S.object({ id: S.integer(), name: S.string() })),
    }),
  );
  const result = assertOk(fn("users[2]{id,name}:\n  1,Alice\n  2,Bob"));
  assert.deepEqual(result, {
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  });
});

test("parse tuple", () => {
  const fn = ST.parse(S.object({ pair: S.tuple(S.string(), S.integer()) }));
  assert.deepEqual(assertOk(fn("pair[2]: hello,42")), { pair: ["hello", 42] });
});

// ---------------------------------------------------------------------------
// parse — flexible order
// ---------------------------------------------------------------------------

test("parse flexible order", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.integer() }), { flexibleOrder: true });
  // Reverse order from schema
  assert.deepEqual(assertOk(fn("age: 30\nname: Alice")), { name: "Alice", age: 30 });
});

// ---------------------------------------------------------------------------
// parse — records
// ---------------------------------------------------------------------------

test("parse record", () => {
  const fn = ST.parse(S.record(S.number()));
  assert.deepEqual(assertOk(fn("a: 1\nb: 2")), { a: 1, b: 2 });
});

// ---------------------------------------------------------------------------
// parse — errors
// ---------------------------------------------------------------------------

test("parse rejects invalid number", () => {
  assertErr(ST.parse(S.number())("abc"));
});

test("parse rejects end of input for object field", () => {
  assertErr(ST.parse(S.object({ name: S.string() }))(""));
});

// ---------------------------------------------------------------------------
// Round-trip: stringify → parse
// ---------------------------------------------------------------------------

test("round-trip — simple object", () => {
  const schema = S.object({ id: S.integer(), name: S.string(), active: S.boolean() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const value = { id: 1, name: "Alice", active: true };
  assert.deepEqual(assertOk(par(str(value))), value);
});

test("round-trip — object with optional", () => {
  const schema = S.object({ name: S.string(), age: S.optional(S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ name: "Alice", age: 30 }))), { name: "Alice", age: 30 });
  assert.deepEqual(assertOk(par(str({ name: "Bob" }))), { name: "Bob" });
});

test("round-trip — inline array", () => {
  const schema = S.object({ tags: S.array(S.string()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ tags: ["a", "b", "c"] }))), { tags: ["a", "b", "c"] });
});

test("round-trip — tabular array", () => {
  const schema = S.object({
    users: S.array(S.object({ id: S.integer(), name: S.string() })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const value = {
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  };
  assert.deepEqual(assertOk(par(str(value))), value);
});

test("round-trip — tuple", () => {
  const schema = S.object({ pair: S.tuple(S.string(), S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ pair: ["hello", 42] }))), { pair: ["hello", 42] });
});

test("round-trip — nullable", () => {
  const schema = S.object({ x: S.nullable(S.string()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ x: "hello" }))), { x: "hello" });
  assert.deepEqual(assertOk(par(str({ x: null }))), { x: null });
});

test("round-trip — nested object", () => {
  const schema = S.object({ user: S.object({ name: S.string(), score: S.number() }) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ user: { name: "Alice", score: 95.5 } }))), {
    user: { name: "Alice", score: 95.5 },
  });
});

test("round-trip — record of primitives", () => {
  const schema = S.record(S.number());
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ a: 1, b: 2 }))), { a: 1, b: 2 });
});

test("round-trip — enum", () => {
  const schema = S.object({ role: S.enum_("admin", "user") });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ role: "admin" }))), { role: "admin" });
});

test("round-trip — literal", () => {
  const schema = S.object({ type: S.literal("circle"), r: S.number() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ type: "circle", r: 5 }))), { type: "circle", r: 5 });
});

// ---------------------------------------------------------------------------
// Coverage: TOON quoting edge cases
// ---------------------------------------------------------------------------

test("stringify string with backslash", () => {
  const fn = ST.stringify(S.string());
  const result = fn("a\\b");
  assert.equal(result, '"a\\\\b"');
});

test("stringify string with newline", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("a\nb"), '"a\\nb"');
});

test("stringify string with tab and carriage return", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("a\tb"), '"a\\tb"');
  assert.equal(fn("a\rb"), '"a\\rb"');
});

test("stringify string starting with dash", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("-"), '"-"');
});

test("stringify string with brackets", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("[x]"), '"[x]"');
  assert.equal(fn("{x}"), '"{x}"');
});

test("stringify string leading/trailing whitespace", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn(" hello"), '" hello"');
  assert.equal(fn("hello "), '"hello "');
});

test("stringify string that looks like number with leading zero", () => {
  const fn = ST.stringify(S.string());
  assert.equal(fn("01"), '"01"');
});

test("parse unquote escapes", () => {
  const fn = ST.parse(S.string());
  assert.equal(assertOk(fn('"a\\\\b"')), "a\\b");
  assert.equal(assertOk(fn('"a\\"b"')), 'a"b');
  assert.equal(assertOk(fn('"a\\nb"')), "a\nb");
  assert.equal(assertOk(fn('"a\\rb"')), "a\rb");
  assert.equal(assertOk(fn('"a\\tb"')), "a\tb");
});

test("parse rejects an unknown escape (spec §7.1)", () => {
  const fn = ST.parse(S.string());
  assert.equal(assertErr(fn('"a\\xb"')).expected, "string");
});

// ---------------------------------------------------------------------------
// Coverage: TOON number canonicalization
// ---------------------------------------------------------------------------

test("stringify Infinity → null", () => {
  const fn = ST.stringify(S.number());
  assert.equal(fn(Infinity), "null");
  assert.equal(fn(-Infinity), "null");
});

test("stringify NaN → null", () => {
  const fn = ST.stringify(S.number());
  assert.equal(fn(NaN), "null");
});

// ---------------------------------------------------------------------------
// Coverage: TOON nullable/optional in object context
// ---------------------------------------------------------------------------

test("stringify object with nullable field — null value", () => {
  const fn = ST.stringify(S.object({ x: S.nullable(S.integer()) }));
  assert.equal(fn({ x: null }), "x: null");
});

test("stringify object with nullable field — present value", () => {
  const fn = ST.stringify(S.object({ x: S.nullable(S.integer()) }));
  assert.equal(fn({ x: 42 }), "x: 42");
});

test("stringify enum values", () => {
  const fn = ST.stringify(S.object({ role: S.enum_("admin", "user") }));
  assert.equal(fn({ role: "admin" }), "role: admin");
});

test("stringify literal values — number/boolean/null", () => {
  assert.equal(ST.stringify(S.literal(42))(42), "42");
  assert.equal(ST.stringify(S.literal(true))(true), "true");
  assert.equal(ST.stringify(S.literal(null))(null), "null");
});

// ---------------------------------------------------------------------------
// Coverage: TOON array formats
// ---------------------------------------------------------------------------

test("stringify array of booleans (inline)", () => {
  const fn = ST.stringify(S.object({ flags: S.array(S.boolean()) }));
  assert.equal(fn({ flags: [true, false, true] }), "flags[3]: true,false,true");
});

test("stringify array of nullable primitives (inline)", () => {
  const fn = ST.stringify(S.object({ vals: S.array(S.nullable(S.integer())) }));
  const result = fn({ vals: [1, null, 3] });
  assert.equal(result, "vals[3]: 1,null,3");
});

test("round-trip — array of booleans", () => {
  const schema = S.object({ flags: S.array(S.boolean()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ flags: [true, false] }))), { flags: [true, false] });
});

test("round-trip — array of numbers", () => {
  const schema = S.object({ scores: S.array(S.number()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ scores: [1.5, 2.7] }))), { scores: [1.5, 2.7] });
});

// ---------------------------------------------------------------------------
// Coverage: TOON parse error paths
// ---------------------------------------------------------------------------

test("parse rejects missing required field", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.integer() }));
  assertErr(fn("name: Alice"));
});

test("parse rejects invalid integer", () => {
  const fn = ST.parse(S.object({ n: S.integer() }));
  assertErr(fn("n: 3.14"));
});

test("parse rejects invalid boolean", () => {
  const fn = ST.parse(S.object({ b: S.boolean() }));
  assertErr(fn("b: yes"));
});

test("parse rejects invalid null", () => {
  const fn = ST.parse(S.object({ n: S.null_() }));
  assertErr(fn("n: none"));
});

test("parse rejects end of input for root primitive", () => {
  assertErr(ST.parse(S.number())(""));
});

test("parse literal — number", () => {
  const fn = ST.parse(S.object({ n: S.literal(42) }));
  assert.deepEqual(assertOk(fn("n: 42")), { n: 42 });
  assertErr(fn("n: 43"));
});

test("parse literal — boolean", () => {
  const fn = ST.parse(S.object({ b: S.literal(true) }));
  assert.deepEqual(assertOk(fn("b: true")), { b: true });
  assertErr(fn("b: false"));
});

test("parse literal — null", () => {
  const fn = ST.parse(S.object({ n: S.literal(null) }));
  assert.deepEqual(assertOk(fn("n: null")), { n: null });
  assertErr(fn("n: 0"));
});

test("parse invalid array header", () => {
  const fn = ST.parse(S.object({ items: S.array(S.string()) }));
  assertErr(fn("items: not-an-array"));
});

// ---------------------------------------------------------------------------
// Coverage: TOON expanded array format
// ---------------------------------------------------------------------------

test("stringify expanded array (non-primitive elements)", () => {
  const fn = ST.stringify(
    S.object({
      items: S.array(S.array(S.integer())),
    }),
  );
  // Array of arrays → expanded format with - prefix
  const result = fn({ items: [[1, 2]] });
  assert.ok(result.includes("[1]:"));
});

// ---------------------------------------------------------------------------
// Coverage: TOON record stringify/parse
// ---------------------------------------------------------------------------

test("round-trip — nested record", () => {
  const schema = S.object({ meta: S.record(S.number()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ meta: { a: 1, b: 2 } }))), { meta: { a: 1, b: 2 } });
});

// ---------------------------------------------------------------------------
// Coverage: TOON flexible order parse
// ---------------------------------------------------------------------------

test("parse flexible order — with optional missing", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.optional(S.integer()) }), {
    flexibleOrder: true,
  });
  assert.deepEqual(assertOk(fn("name: Alice")), { name: "Alice" });
});

test("parse flexible order — rejects missing required", () => {
  const fn = ST.parse(S.object({ name: S.string(), age: S.integer() }), { flexibleOrder: true });
  assertErr(fn("name: Alice"));
});

// ---------------------------------------------------------------------------
// Coverage: canonicalNumber exponential notation
// ---------------------------------------------------------------------------

test("numbers with exponent notation round-trip exactly (G9-1)", () => {
  const schema = S.object({ n: S.number() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  for (const n of [5e-7, 1e100, -1e30, 1e21, 1.5e300, 1e-21, 1.234567890123456e-10, 5e-324]) {
    const out = str({ n });
    assert.equal(out, "n: " + String(n));
    assert.deepEqual(assertOk(par(out)), { n });
  }
});

test("tabular field names are never interpolated into generated code (G9-8)", () => {
  const g = globalThis as { PWN?: number };
  g.PWN = 0;
  const evil = 'a"+(globalThis.PWN=1)+"';
  const schema = S.object({ xs: S.array(S.object({ [evil]: S.integer() })) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const out = str({ xs: [{ [evil]: 1 }] });
  assert.equal(g.PWN, 0);
  const e = assertErr(par(out.replace("\n  1", "\n  notanumber")));
  assert.equal(e.path, "xs.0." + evil);
  assert.equal(g.PWN, 0);
  // The quoted header round-trips
  assert.deepEqual(assertOk(par(out)), { xs: [{ [evil]: 1 }] });
  delete g.PWN;
});

// ---------------------------------------------------------------------------
// Coverage: optional compound fields (nested object, array)
// ---------------------------------------------------------------------------

test("stringify optional nested object", () => {
  const schema = S.object({
    name: S.string(),
    addr: S.optional(S.object({ city: S.string(), zip: S.string() })),
  });
  const fn = ST.stringify(schema);
  // Present
  const with_ = fn({ name: "Alice", addr: { city: "NYC", zip: "10001" } });
  assert.ok(with_.includes("city: NYC"));
  // Absent
  const without = fn({ name: "Alice" });
  assert.ok(!without.includes("addr"));
  assert.ok(!without.includes("city"));
});

test("parse optional nested object", () => {
  const schema = S.object({
    name: S.string(),
    addr: S.optional(S.object({ city: S.string(), zip: S.string() })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  // Round-trip with present
  const obj = { name: "Alice", addr: { city: "NYC", zip: "10001" } };
  assert.deepEqual(assertOk(par(str(obj))), obj);
  // Round-trip with absent
  const obj2 = { name: "Alice" };
  assert.deepEqual(assertOk(par(str(obj2))), obj2);
});

test("stringify optional nested array", () => {
  const schema = S.object({
    name: S.string(),
    tags: S.optional(S.array(S.string())),
  });
  const fn = ST.stringify(schema);
  const with_ = fn({ name: "Alice", tags: ["a", "b"] });
  assert.ok(with_.includes("tags[2]: a"));
  const without = fn({ name: "Alice" });
  assert.ok(!without.includes("tags"));
});

test("parse optional nested array", () => {
  const schema = S.object({
    name: S.string(),
    tags: S.optional(S.array(S.string())),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ name: "Alice", tags: ["a", "b"] }))), {
    name: "Alice",
    tags: ["a", "b"],
  });
  assert.deepEqual(assertOk(par(str({ name: "Alice" }))), { name: "Alice" });
});

// ---------------------------------------------------------------------------
// Coverage: root-level array and tuple parse
// ---------------------------------------------------------------------------

test("parse array field with non-primitive items (expanded format)", () => {
  const schema = S.object({
    items: S.array(S.object({ id: S.integer(), name: S.string() })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = {
    items: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  };
  assert.deepEqual(assertOk(par(str(obj))), obj);
});

test("parse tuple field", () => {
  const schema = S.object({ point: S.tuple(S.integer(), S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { point: [10, 20] as [number, number] };
  assert.deepEqual(assertOk(par(str(obj))), obj);
});

// ---------------------------------------------------------------------------
// Coverage: union stringify/parse
// ---------------------------------------------------------------------------

test("stringify union (string | number)", () => {
  const schema = S.object({ val: S.union(S.string(), S.integer()) });
  const fn = ST.stringify(schema);
  assert.ok(fn({ val: "hello" }).includes("val: hello"));
  assert.ok(fn({ val: 42 }).includes("val: 42"));
});

test("non-discriminated object union is rejected at compile time (G9-3)", () => {
  const schema = S.union(S.object({ x: S.integer() }), S.object({ y: S.string() }));
  assert.throws(() => ST.stringify(schema), /TOON: unsupported.*discriminated/);
  assert.throws(() => ST.parse(schema), /TOON: unsupported.*discriminated/);
});

// ---------------------------------------------------------------------------
// Coverage: nullable primitive parse
// ---------------------------------------------------------------------------

test("parse nullable string field", () => {
  const schema = S.object({ name: S.nullable(S.string()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ name: "Alice" }))), { name: "Alice" });
  assert.deepEqual(assertOk(par(str({ name: null }))), { name: null });
});

test("parse optional primitive field", () => {
  const schema = S.object({ x: S.optional(S.integer()), y: S.string() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ x: 5, y: "hi" }))), { x: 5, y: "hi" });
  assert.deepEqual(assertOk(par(str({ y: "hi" }))), { y: "hi" });
});

// ---------------------------------------------------------------------------
// Coverage: flexible order parse with nested object (depth > 0)
// ---------------------------------------------------------------------------

test("parse flexible order with all-primitive fields reversed", () => {
  const schema = S.object({ a: S.integer(), b: S.string(), c: S.boolean() });
  const par = ST.parse(schema, { flexibleOrder: true });
  // Fields in reverse order
  const toon = "c: true\nb: hello\na: 42";
  assert.deepEqual(assertOk(par(toon)), { a: 42, b: "hello", c: true });
});

// ---------------------------------------------------------------------------
// Coverage: deeply nested compound fields
// ---------------------------------------------------------------------------

test("stringify/parse deeply nested objects", () => {
  const schema = S.object({
    a: S.object({
      b: S.object({
        c: S.string(),
      }),
    }),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { a: { b: { c: "deep" } } };
  assert.deepEqual(assertOk(par(str(obj))), obj);
});

// ---------------------------------------------------------------------------
// Coverage: enum inlineExpr fallback / default case
// ---------------------------------------------------------------------------

test("stringify enum field in object", () => {
  const schema = S.object({ status: S.enum_("active", "inactive", "pending") });
  const fn = ST.stringify(schema);
  assert.ok(fn({ status: "active" }).includes("status: active"));
});

// ---------------------------------------------------------------------------
// Coverage: inline array with quoted strings (splitByDelimiter quote handling)
// ---------------------------------------------------------------------------

test("stringify/parse inline array with quoted strings", () => {
  const schema = S.object({ vals: S.array(S.string()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  // Strings that need quoting (contain special chars) exercise the quote
  // handling in splitByDelimiter's push-based path
  const obj = { vals: ['hello "world"', "a:b", "back\\slash"] };
  const toon = str(obj);
  assert.deepEqual(assertOk(par(toon)), obj);
});

// ---------------------------------------------------------------------------
// Coverage: optional/nullable at parse level
// ---------------------------------------------------------------------------

test("parse optional primitive in tabular expr", () => {
  const schema = S.object({
    data: S.array(S.object({ id: S.integer(), label: S.optional(S.string()) })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  // With optional present
  const obj1 = {
    data: [
      { id: 1, label: "hi" },
      { id: 2, label: "bye" },
    ],
  };
  assert.deepEqual(assertOk(par(str(obj1))), obj1);
  // Optional field renders as "" (empty) in tabular — parse recovers it
  const obj2 = { data: [{ id: 1, label: "hi" }] };
  const result = assertOk(par(str(obj2)));
  assert.equal(result.data[0].label, "hi");
});

test("parse nullable at schema root wrapping", () => {
  const schema = S.object({ x: S.nullable(S.integer()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ x: 42 }))), { x: 42 });
  assert.deepEqual(assertOk(par(str({ x: null }))), { x: null });
});

// ---------------------------------------------------------------------------
// Coverage: union with boolean/null/object/array type dispatch
// ---------------------------------------------------------------------------

test("stringify/parse union with boolean variant", () => {
  const schema = S.object({
    val: S.union(S.boolean(), S.string()),
  });
  const str = ST.stringify(schema);
  assert.ok(str({ val: true }).includes("val: true"));
  assert.ok(str({ val: "hi" }).includes("val: hi"));
});

test("stringify/parse union with null variant", () => {
  const schema = S.object({
    val: S.union(S.null_(), S.integer()),
  });
  const str = ST.stringify(schema);
  assert.ok(str({ val: null }).includes("val: null"));
  assert.ok(str({ val: 42 }).includes("val: 42"));
});

test("unions mixing compound and primitive variants are rejected (G9-3)", () => {
  for (const val of [
    S.union(S.object({ type: S.literal("a"), x: S.integer() }), S.string()),
    S.union(S.array(S.integer()), S.string()),
  ]) {
    assert.throws(() => ST.stringify(S.object({ val })), /TOON: unsupported/);
    assert.throws(() => ST.parse(S.object({ val })), /TOON: unsupported/);
  }
});

test("union(T, null) behaves like nullable(T)", () => {
  const schema = S.object({ o: S.union(S.object({ a: S.integer() }), S.null_()) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.equal(str({ o: null }), "o: null");
  assert.deepEqual(assertOk(par(str({ o: null }))), { o: null });
  assert.deepEqual(assertOk(par(str({ o: { a: 1 } }))), { o: { a: 1 } });
});

// ---------------------------------------------------------------------------
// Coverage: nullable/optional in parse body (compile-time paths)
// ---------------------------------------------------------------------------

test("optional compound outside an object field is rejected at compile time", () => {
  for (const schema of [
    S.optional(S.object({ x: S.integer() })),
    S.array(S.optional(S.array(S.integer()))),
    S.record(S.optional(S.object({}))),
    S.tuple(S.optional(S.object({}))),
  ]) {
    assert.throws(
      () => ST.stringify(schema),
      /TOON: unsupported.*only supported as an object field/,
    );
    assert.throws(() => ST.parse(schema), /TOON: unsupported/);
  }
});

test("root optional primitive: empty document is undefined", () => {
  const schema = S.optional(S.integer());
  assert.equal(ST.stringify(schema)(undefined), "");
  assert.equal(assertOk(ST.parse(schema)("")), undefined);
  assert.equal(assertOk(ST.parse(schema)("5")), 5);
});

test("parse nullable wrapper at compile time", () => {
  const schema = S.nullable(S.object({ x: S.integer() }));
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ x: 1 }))), { x: 1 });
});

// ---------------------------------------------------------------------------
// Coverage: root-level array/tuple parse
// ---------------------------------------------------------------------------

test("parse root-level array schema", () => {
  const schema = S.array(S.integer());
  const par = ST.parse(schema);
  const result = assertOk(par("[3]: 1,2,3"));
  assert.deepEqual(result, [1, 2, 3]);
});

test("parse root-level tuple schema", () => {
  const schema = S.tuple(S.string(), S.integer());
  const par = ST.parse(schema);
  const result = assertOk(par("[2]: hello,42"));
  assert.deepEqual(result, ["hello", 42]);
});

// ---------------------------------------------------------------------------
// Coverage: null kind in inline expr
// ---------------------------------------------------------------------------

test("stringify object with null field", () => {
  const schema = S.object({ x: S.null_() });
  const str = ST.stringify(schema);
  assert.ok(str({ x: null }).includes("x: null"));
});

test("stringify tabular with null column", () => {
  // S.null_() in inline expr triggers the "null" case in inlineExpr
  const schema = S.object({
    items: S.array(S.object({ id: S.integer(), empty: S.null_() })),
  });
  const str = ST.stringify(schema);
  const result = str({ items: [{ id: 1, empty: null }] });
  assert.ok(result.includes("null"));
});

// ---------------------------------------------------------------------------
// Coverage: simpleTypeCheck returns null for non-checkable union variants
// ---------------------------------------------------------------------------

test("stringify union with literal/enum (non-quick-checkable)", () => {
  const schema = S.object({
    val: S.union(S.literal("a"), S.literal("b")),
  });
  const str = ST.stringify(schema);
  assert.ok(str({ val: "a" as "a" | "b" }).includes("val: a"));
});

// ---------------------------------------------------------------------------
// Coverage: optional prim value parse path
// ---------------------------------------------------------------------------

test("parse optional string in prim value parse", () => {
  const schema = S.object({
    items: S.array(S.optional(S.string())),
  });
  const par = ST.parse(schema);
  const result = assertOk(par("items[2]: hello,world"));
  assert.deepEqual(result, { items: ["hello", "world"] });
});

// ---------------------------------------------------------------------------
// Coverage: default prim value parse fallback (unknown kind at parse boundary)
// ---------------------------------------------------------------------------

test("parse literal field round-trip", () => {
  const schema = S.object({ kind: S.literal("test"), val: S.integer() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ kind: "test" as const, val: 42 }))), {
    kind: "test",
    val: 42,
  });
});

// ---------------------------------------------------------------------------
// Coverage: flexible parse at depth > 0
// ---------------------------------------------------------------------------

test("parse flexible order — all-primitive flat object", () => {
  // Flexible order only supports flat key-value objects with primitive fields
  const schema = S.object({ x: S.integer(), y: S.string(), z: S.boolean() });
  const par = ST.parse(schema, { flexibleOrder: true });
  // Reverse order
  const result = assertOk(par("z: true\nx: 42\ny: hello"));
  assert.deepEqual(result, { x: 42, y: "hello", z: true });
});

test("stringify throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => ST.stringify(bad), /unreachable/i);
});

test("parse throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => ST.parse(bad), /unreachable/i);
});

test("factories reject a field with an unknown schema kind", () => {
  const custom = { kind: "CUSTOM", meta: undefined } as unknown as S.Schema;
  const schema = S.object({ x: custom });
  assert.throws(() => ST.parse(schema), /unreachable/i);
  assert.throws(() => ST.stringify(schema), /unreachable/i);
});

// ---------------------------------------------------------------------------
// Record proto pollution guard (G9-9 counterpart)
// ---------------------------------------------------------------------------

test("parse record drops __proto__ but keeps constructor", () => {
  const schema = S.record(S.string());
  const par = ST.parse(schema);
  const toon = "__proto__: evil\nconstructor: bad\nname: Alice";
  const r = assertOk(par(toon));
  assert.equal(r.name, "Alice");
  assert.equal(Object.hasOwn(r, "__proto__"), false);
  assert.equal(r.constructor, "bad");
  // Compound record values named __proto__ are parsed (validated) then dropped
  const nested = ST.parse(S.record(S.object({ a: S.integer() })));
  const n = assertOk(nested("__proto__:\n  a: 1\nk:\n  a: 2"));
  assert.deepEqual(Object.keys(n), ["k"]);
  assert.equal(Object.getPrototypeOf(n), Object.prototype);
});

// ---------------------------------------------------------------------------
// List items (G9-2)
// ---------------------------------------------------------------------------

test("primitive unions inside arrays use the inline form", () => {
  const schema = S.object({ items: S.array(S.union(S.string(), S.integer())) });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { items: ["hello", 42, "7"] as (string | number)[] };
  assert.equal(str(obj), 'items[3]: hello,42,"7"');
  assert.deepEqual(assertOk(par(str(obj))), obj);
});

test("list items are strict about the hyphen and indentation", () => {
  const par = ST.parse(S.object({ items: S.array(S.array(S.integer())) }));
  assert.deepEqual(assertOk(par("items[1]:\n  - [2]: 1,2")), { items: [[1, 2]] });
  assertErr(par("items[1]:\n- [2]: 1,2")); // wrong indentation
  assertErr(par("items[1]:\n  -[2]: 1,2")); // no space after hyphen
  assertErr(par("items[2]:\n  - [2]: 1,2")); // fewer items than declared
  assertErr(par("items[1]:\n  -")); // bare hyphen is not an array
});

// ---------------------------------------------------------------------------
// nullable compound fields
// ---------------------------------------------------------------------------

test("nullable object field — round-trip", () => {
  const schema = S.object({
    name: S.string(),
    address: S.nullable(S.object({ city: S.string(), zip: S.string() })),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { name: "Alice", address: { city: "NYC", zip: "10001" } };
  const toon = str(obj);
  const result = assertOk(par(toon));
  assert.deepEqual(result, obj);
});

test("record with special keys — round-trip", () => {
  const schema = S.record(S.string());
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { "key: with colon": "val1", normal: "val2" };
  const toon = str(obj);
  const result = assertOk(par(toon));
  assert.deepEqual(result, obj);
});

test("toonQuote/unquote control chars — round-trip", () => {
  const schema = S.object({ data: S.string() });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { data: "hello\x00world\x07end" };
  const toon = str(obj);
  assert.ok(toon.includes("\\u0000"));
  assert.ok(toon.includes("\\u0007"));
  const result = assertOk(par(toon));
  assert.deepEqual(result, obj);
});

// ---------------------------------------------------------------------------
// Helpers for the round-trip tests below
// ---------------------------------------------------------------------------

// Untyped views — `Infer` over the generic `Schema` is too deep for tsc.
const anyStringify = ST.stringify as unknown as (
  s: S.Schema,
  o?: ST.ToonStringifyOptions,
) => (v: unknown) => string;
const anyParse = ST.parse as unknown as (
  s: S.Schema,
  o?: ST.ToonParseOptions,
) => (s: string) => [true, unknown] | [false, SchemaError];

/** stringify → (exact output) → parse in schema order and flexible order. */
function rt(
  schema: S.Schema,
  value: unknown,
  expected?: string,
  opts?: ST.ToonStringifyOptions & ST.ToonParseOptions,
): string {
  const out = anyStringify(schema, opts)(value);
  if (expected !== undefined) assert.equal(out, expected);
  assert.deepEqual(assertOk(anyParse(schema, opts)(out)), value);
  assert.deepEqual(assertOk(anyParse(schema, { ...opts, flexibleOrder: true })(out)), value);
  return out;
}

// ---------------------------------------------------------------------------
// Nested list items (G9-2)
// ---------------------------------------------------------------------------

test("array of objects with compound fields uses list items", () => {
  const schema = S.object({
    xs: S.array(
      S.object({ id: S.integer(), tags: S.array(S.string()), o: S.object({ a: S.integer() }) }),
    ),
  });
  rt(
    schema,
    {
      xs: [
        { id: 1, tags: ["a", "b"], o: { a: 2 } },
        { id: 2, tags: [], o: { a: 3 } },
      ],
    },
    "xs[2]:\n  - id: 1\n    tags[2]: a,b\n    o:\n      a: 2\n  - id: 2\n    tags[0]: \n    o:\n      a: 3",
  );
});

test("list-item object whose first field is compound or absent", () => {
  const schema = S.array(
    S.object({
      first: S.optional(S.array(S.object({ a: S.integer() }))),
      n: S.optional(S.integer()),
    }),
  );
  rt(schema, [{ first: [{ a: 1 }], n: 5 }], "[1]:\n  - first[1]{a}:\n      1\n    n: 5");
  rt(schema, [{ n: 5 }, {}], "[2]:\n  - n: 5\n  -");
  // Bare "- " (trailing space) is also an empty object
  assert.deepEqual(assertOk(ST.parse(schema)("[1]:\n  - ")), [{}]);
});

test("array of empty objects and of nullable objects", () => {
  rt(S.object({ xs: S.array(S.object({})) }), { xs: [{}, {}] }, "xs[2]:\n  -\n  -");
  rt(
    S.array(S.nullable(S.object({ a: S.integer() }))),
    [null, { a: 1 }],
    "[2]:\n  - null\n  - a: 1",
  );
});

test("arrays of arrays, nullable arrays and tuples in list items", () => {
  rt(S.array(S.array(S.integer())), [[1, 2], [], [3]], "[3]:\n  - [2]: 1,2\n  - [0]: \n  - [1]: 3");
  rt(S.array(S.nullable(S.array(S.integer()))), [null, [1]], "[2]:\n  - null\n  - [1]: 1");
  rt(S.array(S.array(S.object({ a: S.object({}) }))), [[{ a: {} }]], "[1]:\n  - [1]:\n    - a:");
  rt(S.array(S.tuple(S.string(), S.integer())), [["x", 1]], "[1]:\n  - [2]: x,1");
});

test("tuples with compound items use list form", () => {
  const schema = S.object({
    t: S.tuple(S.string(), S.object({ a: S.integer() }), S.nullable(S.array(S.boolean()))),
  });
  rt(schema, { t: ["s", { a: 1 }, [true]] }, "t[3]:\n  - s\n  - a: 1\n  - [1]: true");
  rt(schema, { t: ["s", { a: 1 }, null] }, "t[3]:\n  - s\n  - a: 1\n  - null");
  const par = ST.parse(schema);
  assertErr(par("t[2]:\n  - s\n  - a: 1")); // wrong count
  assertErr(par("t[3]: s,x,y")); // inline data where a list is expected
  assertErr(par("t[3]:\n  - s\n  - a: 1")); // missing item
  rt(S.tuple(), [], "[0]: ");
});

test("tuple of optional primitives and root tuple", () => {
  rt(S.tuple(S.string(), S.optional(S.integer())), ["a", undefined], "[2]: a,");
  rt(S.tuple(S.optional(S.string())), [undefined], "[1]: ");
});

test("records with compound and nullable values", () => {
  rt(
    S.record(S.object({ a: S.integer() })),
    { k: { a: 1 }, "x y": { a: 2 } },
    "k:\n  a: 1\nx y:\n  a: 2",
  );
  rt(S.record(S.array(S.integer())), { k: [1, 2], e: [] }, "k[2]: 1,2\ne[0]: ");
  rt(
    S.record(S.nullable(S.object({ a: S.integer() }))),
    { k: null, j: { a: 1 } },
    "k: null\nj:\n  a: 1",
  );
  rt(S.record(S.optional(S.integer())), { k: undefined, j: 1 }, "k: \nj: 1");
  rt(S.object({ r: S.record(S.integer()), z: S.integer() }), { r: { "[k]": 1 }, z: 2 });
  // list item record: first entry on the hyphen line, empty record is a bare "-"
  rt(S.array(S.record(S.integer())), [{ a: 1, b: 2 }, {}], "[2]:\n  - a: 1\n    b: 2\n  -");
});

test("record parse errors", () => {
  const par = ST.parse(S.record(S.integer()));
  assertErr(par("k[1]: 1")); // array tail for a primitive value
  assertErr(par("k: x"));
  assertErr(par('"unclosed: 1')); // not a key line → leftover input
  assertErr(par(": 1")); // empty unquoted key
  const nested = ST.parse(S.record(S.object({ a: S.integer() })));
  assertErr(nested("k: 1")); // primitive where a block is expected
  assertErr(nested("k:\n  b: 1"));
});

// ---------------------------------------------------------------------------
// Discriminated unions (G9-3)
// ---------------------------------------------------------------------------

const Shape = S.union(
  S.object({ kind: S.literal("circle"), r: S.number() }),
  S.object({ size: S.integer(), kind: S.literal(2) }),
  S.object({ kind: S.literal(null), tags: S.array(S.string()) }),
);

test("discriminated unions round-trip at root, in fields, list items and records", () => {
  rt(Shape, { kind: "circle", r: 1.5 }, "kind: circle\nr: 1.5");
  rt(Shape, { size: 3, kind: 2 }, "size: 3\nkind: 2");
  rt(Shape, { kind: null, tags: ["a"] }, "kind: null\ntags[1]: a");
  rt(
    S.object({ s: Shape, n: S.integer() }),
    { s: { size: 1, kind: 2 }, n: 0 },
    "s:\n  size: 1\n  kind: 2\nn: 0",
  );
  rt(
    S.array(Shape),
    [
      { kind: "circle", r: 2 },
      { size: 4, kind: 2 },
    ],
    "[2]:\n  - kind: circle\n    r: 2\n  - size: 4\n    kind: 2",
  );
  rt(S.record(Shape), { a: { kind: null, tags: [] } });
  rt(S.object({ s: S.nullable(Shape) }), { s: null }, "s: null");
});

test("discriminated union errors", () => {
  const par = ST.parse(Shape);
  assert.deepEqual(assertErr(par("r: 1")).path, "kind");
  assert.deepEqual(assertErr(par("kind: square\nr: 1")).expected, "discriminant");
  assertErr(par("kind: circle\nr: x"));
  const str = ST.stringify(Shape);
  assert.throws(() => str({ kind: "square" } as never), /does not match any union variant/);
  // Literal values are referenced, never interpolated into generated source
  const g = globalThis as { PWN?: number };
  g.PWN = 0;
  const evil = '"+(globalThis.PWN=1)+"';
  rt(S.union(S.object({ t: S.literal(evil) }), S.object({ t: S.literal("b") })), { t: evil });
  assert.equal(g.PWN, 0);
  delete g.PWN;
});

test("flexible order: nested objects, discriminated unions, quoted keys", () => {
  const schema = S.object({
    a: S.integer(),
    o: S.object({ x: S.string(), y: S.optional(S.boolean()) }),
    s: Shape,
  });
  const par = ST.parse(schema, { flexibleOrder: true });
  const value = { a: 1, o: { x: "q", y: true }, s: { kind: "circle" as const, r: 3 } };
  assert.deepEqual(assertOk(par("s:\n  r: 3\n  kind: circle\no:\n  y: true\n  x: q\na: 1")), value);
  // Unneeded key quotes are tolerated
  assert.deepEqual(
    assertOk(par('"a": 1\no:\n  "x": q\n  y: true\ns:\n  kind: circle\n  r: 3')),
    value,
  );
  // Undeclared keys are not (G3-6), at any depth
  assert.deepEqual(assertErr(par("a: 1\nextra: 9\no:\n  x: q\ns:\n  kind: circle\n  r: 3")), {
    path: "",
    expected: "declared key",
    received: "extra: 9",
  });
  assert.deepEqual(
    assertErr(par("a: 1\no:\n  x: q\n  junk:\n    deep: 1\ns:\n  kind: circle\n  r: 3")),
    { path: "o", expected: "declared key", received: "  junk:" },
  );
  assertErr(par("o:\n  x: q\ns:\n  kind: circle\n  r: 3")); // missing a
  assertErr(par("a: 1\no:\n  y: true\ns:\n  kind: circle\n  r: 3")); // missing o.x
  // A non-key line ends the block
  assertErr(par("a: 1\n- junk\no:\n  x: q\ns:\n  kind: circle\n  r: 3"));
});

test("flexible order still requires schema-ordered tabular headers", () => {
  const schema = S.object({ xs: S.array(S.object({ a: S.integer(), b: S.integer() })) });
  const par = ST.parse(schema, { flexibleOrder: true });
  assert.deepEqual(assertOk(par("xs[1]{a,b}:\n  1,2")), { xs: [{ a: 1, b: 2 }] });
  assert.match(assertErr(par("xs[1]{b,a}:\n  2,1")).expected, /tabular header/);
});

// ---------------------------------------------------------------------------
// Optional / nullable cells (G9-6, G9-7)
// ---------------------------------------------------------------------------

test("empty cells mean absent; required cells reject them (G9-6)", () => {
  const schema = S.object({
    xs: S.array(
      S.object({
        a: S.optional(S.integer()),
        s: S.optional(S.string()),
        n: S.nullable(S.string()),
      }),
    ),
  });
  rt(
    schema,
    { xs: [{ n: null }, { a: 0, s: "", n: "null" }] },
    'xs[2]{a,s,n}:\n  ,,null\n  0,"","\\"null\\""'.replace('"\\"null\\""', '"null"'),
  );
  const par = ST.parse(S.object({ a: S.integer(), s: S.string() }));
  assertErr(par("a: \ns: x"));
  assertErr(par("a: 1\ns: "));
  assertErr(ST.parse(S.object({ xs: S.array(S.string()) }))("xs[2]: a,"));
});

test("nullable and optional compound fields round-trip (G9-7)", () => {
  const schema = S.object({
    o: S.nullable(S.object({ a: S.integer() })),
    xs: S.optional(S.nullable(S.array(S.integer()))),
    r: S.optional(S.record(S.integer())),
    z: S.integer(),
  });
  rt(schema, { o: null, xs: null, z: 1 }, "o: null\nxs: null\nz: 1");
  rt(schema, { o: { a: 1 }, z: 1 }, "o:\n  a: 1\nz: 1");
  rt(schema, { o: null, xs: [1], r: { k: 2 }, z: 1 });
  rt(S.nullable(S.object({ a: S.integer() })), null, "null");
  rt(S.nullable(S.array(S.integer())), [1], "[1]: 1");
  rt(S.nullable(S.string()), null, "null");
  rt(S.nullable(S.string()), "null", '"null"');
});

// ---------------------------------------------------------------------------
// Keys (G9-15), strings (G9-11), numbers & literals (G9-14)
// ---------------------------------------------------------------------------

test("keys are quoted only when needed (G9-15)", () => {
  rt(
    S.object({ "a-b": S.integer(), "x y": S.integer(), "1": S.integer() }),
    { "1": 3, "a-b": 1, "x y": 2 },
    "1: 3\na-b: 1\nx y: 2",
  );
  rt(
    S.object({
      "a\nb": S.string(),
      "": S.integer(),
      " k": S.integer(),
      "k\u00a0": S.integer(),
      'q"': S.integer(),
    }),
    { "a\nb": "v", "": 1, " k": 2, "k\u00a0": 3, 'q"': 4 },
    '"a\\nb": v\n"": 1\n" k": 2\n"k\u00a0": 3\n"q\\"": 4',
  );
  rt(
    S.object({ "a[0]": S.array(S.integer()), "{x}": S.object({}) }),
    { "a[0]": [1], "{x}": {} },
    '"a[0]"[1]: 1\n"{x}":',
  );
  // Keys containing the delimiter are quoted in tabular headers only
  rt(
    S.object({ "a,b": S.array(S.object({ "c,d": S.integer(), "e|f": S.integer() })) }),
    { "a,b": [{ "c,d": 1, "e|f": 2 }] },
    'a,b[1]{"c,d",e|f}:\n  1,2',
  );
  rt(
    S.object({ xs: S.array(S.object({ "c,d": S.integer(), "e|f": S.integer() })) }),
    { xs: [{ "c,d": 1, "e|f": 2 }] },
    'xs[1|]{c,d|"e|f"}:\n  1|2',
    { delimiter: "|" },
  );
});

test("properties named like Object.prototype members", () => {
  const schema = S.object({
    toString: S.optional(S.integer()),
    xs: S.array(S.object({ valueOf: S.optional(S.integer()), a: S.integer() })),
    constructor: S.optional(S.string()),
  });
  rt(schema, { xs: [{ a: 1 }] }, "xs[1]{valueOf,a}:\n  ,1");
  rt(schema, { toString: 1, xs: [{ valueOf: 2, a: 1 }], constructor: "c" });
});

test("strings with Unicode whitespace or line separators round-trip (G9-11)", () => {
  for (const s of [
    "a\u2028b",
    "\u00a0lead",
    "trail\ufeff",
    "\u2029",
    "ok\u00e9",
    "-a",
    "-5",
    "- x",
    "é",
  ]) {
    rt(S.string(), s);
    rt(S.object({ xs: S.array(S.string()), t: S.tuple(S.string()), v: S.string() }), {
      xs: [s, s],
      t: [s],
      v: s,
    });
  }
  assert.equal(ST.stringify(S.string())("-a"), "-a");
  assert.equal(ST.stringify(S.string())("-5"), '"-5"');
  assert.equal(ST.stringify(S.string())("é"), "é");
});

test("quoted cells with escaped quotes and delimiters split correctly", () => {
  rt(S.object({ xs: S.array(S.string()) }), { xs: ['a"b,c', "x\\", ",", '"'] });
  const par = ST.parse(S.object({ xs: S.array(S.string()) }));
  assertErr(par("xs[2]: a,b,c")); // too many
  assertErr(par("xs[3]: a,b")); // too few
  assertErr(par("xs[0]: a"));
  assert.deepEqual(assertOk(par("xs[0]:")), { xs: [] });
});

test("unquote handles every escape; unknown escapes and malformed quotes are errors (G3-2)", () => {
  const par = ST.parse(S.string());
  assert.equal(assertOk(par('"a\\nb\\rc\\td\\\\e\\"f"')), 'a\nb\rc\td\\e"f');
  assert.equal(assertOk(par('"\\u0041\\u00e9"')), "Aé");
  assert.equal(assertOk(par('"\\\\"')), "\\");
  assert.equal(assertOk(par('"x"')), "x");
  assert.equal(assertOk(par('""')), "");
  for (const bad of [
    '"\\uZZZZ"',
    '"\\q"',
    '"\\x"',
    '"\\u004"',
    '"\\u12"',
    '"ab\\"', // the closing quote is escaped: unterminated
    '"\\',
    '"',
    '"abc',
    '"a"b"',
    '"abc" x',
    '"a\\n"b"',
  ]) {
    assert.deepEqual(assertErr(par(bad)), { path: "", expected: "string", received: bad }, bad);
  }
  // Unquoted text containing quotes or backslashes is taken as-is
  assert.equal(assertOk(par("a\\x")), "a\\x");
});

test("a malformed quoted token never decodes to another value (G3-2)", () => {
  // union / nullable / optional: a decoder that signalled "malformed" with
  // null or undefined would let these accept the broken token.
  for (const schema of [
    S.union(S.string(), S.null_()),
    S.nullable(S.string()),
    S.object({ a: S.optional(S.union(S.string(), S.integer())) }),
    S.literal(null),
    S.enum_("a", 1),
    S.object({ a: S.literal("x") }),
  ]) {
    const par = anyParse(schema);
    for (const bad of ['"abc', '"\\q"', '"']) {
      const text = schema.kind === "object" ? "a: " + bad : bad;
      assertErr(par(text));
    }
  }
  const disc = anyParse(Shape);
  assert.equal(assertErr(disc('kind: "circle\nr: 1')).expected, "discriminant");
  // Malformed quoted keys: a record stops at the line, which is then left over
  const rec = anyParse(S.record(S.integer()));
  assert.deepEqual(assertOk(rec('"a\\"b": 1')), { 'a"b': 1 });
  assert.equal(assertErr(rec('"a\\qb": 1')).expected, "end of input");
  assert.equal(assertErr(rec('"ab: 1')).expected, "end of input");
  const flex = anyParse(S.object({ a: S.integer() }), { flexibleOrder: true });
  assert.equal(assertErr(flex('"a\\q": 1')).expected, "key 'a'");
});

test("number grammar is strict (G9-14)", () => {
  const num = ST.parse(S.number());
  for (const ok of ["0", "-0", "1.5", "1e5", "1E+5", "-2.5e-3", "1e+21", "0.5", "-0e0", "10"]) {
    assert.equal(assertOk(num(ok)), Number(ok), ok);
  }
  for (const bad of [
    "",
    "-",
    "1.",
    ".5",
    // JSON grammar (G3-2): no leading zeros, no bare `.` around the digits
    "05",
    "00",
    "-01",
    "-.5",
    "1.e5",
    "1.E2",
    "-",
    "--1",
    "1e+",
    "1.5.5",
    "1e5e5",
    "-x",
    "1a",
    "+1",
    "0x10",
    "0b1",
    "Infinity",
    "-Infinity",
    "NaN",
    "1e999",
    "1,5",
    "1 5",
    "1_0",
    "e5",
    "1e",
  ]) {
    assertErr(num(bad));
  }
  const int = ST.parse(S.integer());
  assert.equal(assertOk(int("1e3")), 1000);
  assertErr(int("1.5"));
  assertErr(int("9007199254740993"));
});

test("literals and enums decode by token type (G9-14)", () => {
  const f = ST.parse(S.object({ f: S.literal(false) }));
  assertErr(f("f: banana"));
  assertErr(f("f: "));
  assert.deepEqual(assertOk(f("f: false")), { f: false });
  rt(S.literal("123"), "123", '"123"');
  rt(S.literal(1.5), 1.5, "1.5");
  assertErr(ST.parse(S.literal(1.5))("1.50x"));
  const e = S.enum_("1", 1, "a b");
  rt(e, "1", '"1"');
  rt(e, 1, "1");
  rt(e, "a b", "a b");
  assert.equal(assertOk(ST.parse(e)('"a b"')), "a b");
  assertErr(ST.parse(e)("2"));
  assertErr(ST.parse(e)(""));
});

test("unions of primitives decode the token type first", () => {
  const u = S.union(S.string(), S.integer(), S.boolean(), S.null_());
  for (const v of ["5", 5, "true", true, false, "null", null, "", "x"]) rt(u, v);
  assert.equal(ST.stringify(u)("5"), '"5"');
  assert.equal(assertOk(ST.parse(u)("plain")), "plain");
  const nums = ST.parse(S.union(S.integer(), S.literal("x")));
  assertErr(nums("1.5"));
  const opt = S.object({ xs: S.array(S.union(S.optional(S.integer()), S.boolean())) });
  rt(opt, { xs: [1, undefined, true] }, "xs[3]: 1,,true");
  assertErr(ST.parse(S.union())("x"));
  assert.equal(ST.stringify(S.union(S.literal(1)))(1), "1");
});

// ---------------------------------------------------------------------------
// Headers, counts, structure errors
// ---------------------------------------------------------------------------

test("array headers: delimiter markers accepted, malformed rejected", () => {
  const schema = S.object({ xs: S.array(S.integer()) });
  const pipe = ST.parse(schema, { delimiter: "|" });
  assert.deepEqual(assertOk(pipe("xs[2|]: 1|2")), { xs: [1, 2] });
  assert.deepEqual(assertOk(pipe("xs[2]: 1|2")), { xs: [1, 2] });
  const par = ST.parse(schema);
  for (const bad of [
    "xs[]: 1",
    "xs[2: 1,2",
    "xs[2|]: 1,2",
    "xs[x]: 1",
    "xs:",
    "xs[1]:1",
    "xs[1]x 1",
  ]) {
    assertErr(par(bad));
  }
});

test("tabular rows: count, indentation and width are checked", () => {
  const schema = S.object({
    xs: S.array(S.object({ a: S.integer(), b: S.string() })),
    z: S.optional(S.integer()),
  });
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par("xs[1]{a,b}:\n  1,x\nz: 2")), { xs: [{ a: 1, b: "x" }], z: 2 });
  assertErr(par("xs[2]{a,b}:\n  1,x")); // missing row
  assertErr(par("xs[1]{a,b}:\n1,x")); // not indented
  assertErr(par("xs[1]{a,b}:\n  1")); // short row
  assertErr(par("xs[1]{a,b}:\n  1,x,y")); // long row
  assertErr(par("xs[1]{a}:\n  1")); // header mismatch
  assertErr(par("xs[1]{a,b}:\n  1,x\n  2,y")); // extra row → leftover input
  assert.deepEqual(assertOk(par("xs[0]{a,b}:")), { xs: [] });
});

test("structural errors are reported, never silently ignored", () => {
  const par = ST.parse(S.object({ o: S.object({ a: S.integer() }), b: S.boolean(), n: S.null_() }));
  assertErr(par("o: 5\nb: true\nn: null")); // block expected
  assertErr(par("o:\n  a: 1\nb: yes\nn: null"));
  assertErr(par("o:\n  a: 1\nb: true\nn: nil"));
  assertErr(par("o:\n  a: 1\nb: true\nn: null\nextra: 1")); // leftover
  assert.deepEqual(assertOk(par("o:\n  a: 1\nb: true\nn: null\n\n")), {
    o: { a: 1 },
    b: true,
    n: null,
  });
  // A longer key with the same prefix is not mistaken for an optional field
  const opt = ST.parse(S.object({ a: S.optional(S.object({})), ab: S.integer() }));
  assert.deepEqual(assertOk(opt("ab: 1")), { ab: 1 });
  const list = ST.parse(S.object({ xs: S.array(S.object({ a: S.object({}) })) }));
  assertErr(list("xs[1]: x")); // inline data where a list is expected
  assertErr(list("xs[1]:\n  - [1]: 2")); // array where an object is expected
});

test("root arrays and records stringify and parse (G9-15)", () => {
  rt(S.array(S.integer()), [1, 2], "[2]: 1,2");
  rt(S.array(S.object({ a: S.integer() })), [{ a: 1 }], "[1]{a}:\n  1");
  rt(S.record(S.string()), {}, "");
  rt(S.object({}), {}, "");
  assertErr(ST.parse(S.array(S.integer()))(""));
  assertErr(ST.parse(S.integer())("1\n2"));
});

test("indent option applies to nested blocks, rows and list items", () => {
  const schema = S.object({
    o: S.object({
      xs: S.array(S.object({ a: S.integer() })),
      ys: S.array(S.object({ b: S.array(S.integer()) })),
    }),
  });
  rt(
    schema,
    { o: { xs: [{ a: 1 }], ys: [{ b: [2] }] } },
    "o:\n    xs[1]{a}:\n        1\n    ys[1]:\n        - b[1]: 2",
    { indent: 4 },
  );
  rt(schema, { o: { xs: [{ a: 1 }], ys: [{ b: [2] }] } }, undefined, {
    indent: 1,
    delimiter: "\t",
  });
});

// ---------------------------------------------------------------------------
// G3: constraints, number grammar, header counts, flexible keys, options
// ---------------------------------------------------------------------------

test("parse enforces leaf constraints and item counts like validate (G3-1)", () => {
  const cases: [S.Schema, string, SchemaError][] = [
    [
      S.object({ name: S.string({ minLength: 3 }) }),
      "name: a",
      { path: "name", expected: "string(minLength=3)", received: "a" },
    ],
    [
      S.object({ email: S.string({ format: "email" }) }),
      "email: nope",
      { path: "email", expected: "string(format=email)", received: "nope" },
    ],
    [
      S.object({ id: S.integer({ minimum: 0 }) }),
      "id: -5",
      { path: "id", expected: "integer(>=0)", received: -5 },
    ],
    [
      S.object({ d: S.string({ pattern: "^\\d+$" }) }),
      'd: "abc"',
      { path: "d", expected: "string(pattern=^\\d+$)", received: "abc" },
    ],
    [
      S.object({ xs: S.array(S.integer(), { maxItems: 1 }) }),
      "xs[3]: 1,2,3",
      { path: "xs", expected: "array(maxItems=1)", received: "3" },
    ],
    [
      S.object({ xs: S.array(S.integer(), { minItems: 2 }) }),
      "xs[1]: 1",
      { path: "xs", expected: "array(minItems=2)", received: "1" },
    ],
    [
      S.array(S.object({ n: S.string({ minLength: 3 }) })),
      "[1]{n}:\n  a",
      { path: "0.n", expected: "string(minLength=3)", received: "a" },
    ],
    [
      S.record(S.number({ multipleOf: 2 })),
      "k: 3",
      { path: "k", expected: "number(%2)", received: 3 },
    ],
    [
      S.tuple(S.optional(S.number({ maximum: 1 })), S.nullable(S.string({ maxLength: 1 }))),
      "[2]: ,ab",
      { path: "1", expected: "string(maxLength=1)", received: "ab" },
    ],
    [
      S.array(S.array(S.string(), { minItems: 1 })),
      "[1]:\n  - [0]:",
      { path: "0", expected: "array(minItems=1)", received: "0" },
    ],
  ];
  for (const [schema, text, error] of cases) {
    assert.deepEqual(assertErr(anyParse(schema)(text)), error, text);
  }
  // Absent / null values skip the constraints, as in validate
  const opt = S.object({
    a: S.optional(S.string({ minLength: 2 })),
    b: S.nullable(S.integer({ minimum: 5 })),
  });
  rt(opt, { b: null });
  rt(opt, { a: "xy", b: 5 });
  rt(S.object({ xs: S.array(S.integer(), { minItems: 1, maxItems: 2 }) }), { xs: [1, 2] });
  rt(S.union(S.string({ minLength: 1 }), S.null_()), "a");
  assertErr(anyParse(S.union(S.string({ minLength: 2 }), S.null_()))("a"));
});

test("text outside the number grammar decodes as a string where strings are allowed (G3-2)", () => {
  const U = S.union(S.string(), S.number());
  for (const s of ["-.5", "-.0", "-.5e1", "-01"]) {
    rt(S.object({ x: U }), { x: s });
    rt(S.array(U), [s]);
    rt(S.array(S.object({ a: U, b: S.string() })), [{ a: s, b: "q" }]);
  }
  const D = S.union(
    S.object({ k: S.literal("-.5"), a: S.number() }),
    S.object({ k: S.literal("b"), z: S.string() }),
  );
  rt(D, { k: "-.5", a: 1 }, "k: -.5\na: 1");
  assert.equal(assertOk(anyParse(U)("-0.5")), -0.5);
  assert.equal(assertOk(anyParse(U)("1.e5")), "1.e5");
  // A leading-zero token is not a number
  assertErr(anyParse(S.literal(5))("05"));
  assert.equal(assertOk(anyParse(S.enum_("05", 5))("05")), "05");
  rt(S.enum_("05", 5), 5, "5");
});

test("huge array header counts are an Err, never a throw (G3-3)", () => {
  const huge = ["4294967296", "9".repeat(400)];
  const shapes: [S.Schema, (n: string) => string][] = [
    [S.object({ xs: S.array(S.string()) }), (n) => `xs[${n}]: a`],
    [S.array(S.integer()), (n) => `[${n}]: 1`],
    [S.array(S.object({ a: S.integer() })), (n) => `[${n}]{a}:\n  1`],
    [S.object({ xs: S.array(S.array(S.string())) }), (n) => `xs[${n}]:\n  - [1]: a`],
    [S.tuple(S.string(), S.integer()), (n) => `[${n}]: a,1`],
  ];
  for (const [schema, text] of shapes) {
    const par = anyParse(schema);
    for (const n of huge) assert.equal(assertErr(par(text(n))).expected, "array header", n);
    // The largest valid array length is a count mismatch, not a RangeError
    assertErr(par(text("4294967295")));
  }
  // Inline: more cells announced than the line could hold
  assert.match(assertErr(anyParse(S.array(S.string()))("[100000000]: a")).expected, /inline items/);
});

test("flexible order rejects duplicate and undeclared keys (G3-6)", () => {
  const O = S.object({ a: S.integer(), b: S.integer() });
  const flex = anyParse(O, { flexibleOrder: true });
  assert.deepEqual(assertOk(flex("b: 2\na: 1")), { a: 1, b: 2 });
  assert.deepEqual(assertErr(flex("a: 1\nb: 2\nevil: 3")), {
    path: "",
    expected: "declared key",
    received: "evil: 3",
  });
  assert.equal(assertErr(flex("a: 1\nevil: 3\nb: 2")).expected, "declared key");
  assert.deepEqual(assertErr(flex("a: 1\na: 9\nb: 2")), {
    path: "",
    expected: "unique key",
    received: "a: 9",
  });
  // A quoted spelling of a key is the same key
  assert.equal(assertErr(flex('a: 1\n"a": 9\nb: 2')).expected, "unique key");
  // __proto__ is just another undeclared key
  assert.equal(assertErr(flex("__proto__: 1\na: 1\nb: 2")).expected, "declared key");
  // Nested and list-item objects
  const nested = anyParse(S.object({ o: S.object({ x: S.integer() }) }), { flexibleOrder: true });
  assert.deepEqual(assertErr(nested("o:\n  x: 1\n  x: 2")), {
    path: "o",
    expected: "unique key",
    received: "  x: 2",
  });
  const list = anyParse(S.array(S.object({ x: S.integer(), y: S.array(S.integer()) })), {
    flexibleOrder: true,
  });
  assert.deepEqual(assertOk(list("[1]:\n  - y[1]: 2\n    x: 1")), [{ x: 1, y: [2] }]);
  assert.equal(assertErr(list("[1]:\n  - x: 2\n    x: 1")).expected, "unique key");
  // additionalProperties: undeclared keys (and their children) are skipped,
  // duplicates are still rejected
  const open = anyParse(S.object({ a: S.integer() }, { additionalProperties: true }), {
    flexibleOrder: true,
  });
  assert.deepEqual(assertOk(open("x: 1\nj:\n  deep: 2\na: 5")), { a: 5 });
  assert.equal(assertErr(open("a: 5\na: 6")).expected, "unique key");
  assert.equal(assertErr(open("x: 5\nx: 6\na: 1")).expected, "unique key");
});

test("value tokens are stripped of surrounding spaces in every position (F3-C3, spec §12)", () => {
  const str = anyParse(S.string());
  assert.equal(assertOk(str('  "x" ')), "x");
  assert.equal(assertOk(str(" x ")), "x");
  assert.deepEqual(assertOk(anyParse(S.object({ a: S.string() }))('a: "x" ')), { a: "x" });
  assert.deepEqual(assertOk(anyParse(S.object({ a: S.string() }))("a:  abc  ")), { a: "abc" });
  const arr = anyParse(S.array(S.string()));
  assert.deepEqual(assertOk(arr('[2]: "a", "b"')), ["a", "b"]);
  assert.deepEqual(assertOk(arr('[2]: "a" ,"b" ')), ["a", "b"]);
  assert.deepEqual(assertOk(arr('[2]: " a" , b ')), [" a", "b"]); // inside quotes kept
  const tab = anyParse(S.array(S.object({ n: S.integer(), s: S.optional(S.string()) })));
  assert.deepEqual(assertOk(tab("[2]{n,s}:\n   1 , x\n  2,  ")), [{ n: 1, s: "x" }, { n: 2 }]);
  const list = anyParse(S.tuple(S.integer(), S.object({ a: S.integer() })));
  assert.deepEqual(assertOk(list("[2]:\n  -  7 \n  - a:  1 ")), [7, { a: 1 }]);
  assert.deepEqual(assertOk(anyParse(S.record(S.boolean()))("k:  true ")), { k: true });
  assert.deepEqual(assertOk(anyParse(Shape)("kind:  circle \nr: 1")), { kind: "circle", r: 1 });
  // Only U+0020: a tab or NBSP is part of the token
  assertErr(anyParse(S.integer())("1\t"));
  assert.equal(assertOk(str("x ")), "x ");
  assertErr(str('"x"\t'));
});

test("indent must be an integer >= 1 (G3-7)", () => {
  const schema = S.object({
    o: S.object({ q: S.optional(S.string()) }),
    q: S.optional(S.string()),
  });
  for (const indent of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => ST.stringify(schema, { indent }), {
      name: "TypeError",
      message: "TOON: indent must be an integer >= 1, got " + indent,
    });
    assert.throws(() => ST.parse(schema, { indent }), TypeError);
  }
  rt(schema, { o: {}, q: "x" }, "o:\nq: x", { indent: 1 });
  rt(schema, { o: { q: "y" } }, "o:\n   q: y", { indent: 3 });
});

test("non-comma delimiters are declared in every array header (G3-8)", () => {
  const schema = S.object({
    xs: S.array(S.string()),
    t: S.tuple(S.integer(), S.integer()),
    rows: S.array(S.object({ a: S.integer(), b: S.string() })),
    ls: S.array(S.array(S.integer())),
    lt: S.tuple(S.object({ a: S.integer() })),
  });
  const value = {
    xs: ["p", "q"],
    t: [1, 2],
    rows: [{ a: 1, b: "x" }],
    ls: [[1, 2], []],
    lt: [{ a: 3 }],
  };
  const lines = (d: string) =>
    `xs[2${d}]: p${d || ","}q\nt[2${d}]: 1${d || ","}2\nrows[1${d}]{a${d || ","}b}:\n  1${d || ","}x\n` +
    `ls[2${d}]:\n  - [2${d}]: 1${d || ","}2\n  - [0${d}]: \nlt[1${d}]:\n  - a: 3`;
  rt(schema, value, lines("|"), { delimiter: "|" });
  rt(schema, value, lines("\t"), { delimiter: "\t" });
  // Comma has no marker; the unmarked form is still accepted for any delimiter
  rt(schema, value, lines(""));
  const pipe = anyParse(S.array(S.integer()), { delimiter: "|" });
  assert.deepEqual(assertOk(pipe("[2]: 1|2")), [1, 2]);
  assertErr(pipe("[2\t]: 1|2"));
});
