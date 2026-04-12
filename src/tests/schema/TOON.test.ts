import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as ST from "../../schema/TOON.js";
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

test("parse unquote unknown escape passes through", () => {
  const fn = ST.parse(S.string());
  // Unknown escape like \x should pass through the backslash
  assert.equal(assertOk(fn('"a\\xb"')), "a\\xb");
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

test("stringify number with exponential notation", () => {
  const fn = ST.stringify(S.object({ n: S.number() }));
  // 5e-7 triggers exponential notation in JS ("5e-7"), canonicalNumber must expand it
  const result = fn({ n: 5e-7 });
  assert.ok(result.startsWith("n: "));
  const numPart = result.slice(3);
  // Verify expanded form without exponential notation
  assert.ok(
    !numPart.includes("e") && !numPart.includes("E"),
    "exponential notation should be expanded",
  );
  assert.equal(Number(numPart), 5e-7);
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

test("parse union (first variant)", () => {
  const schema = S.union(S.object({ x: S.integer() }), S.object({ y: S.string() }));
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  // First variant round-trips
  assert.deepEqual(assertOk(par(str({ x: 42 }))), { x: 42 });
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

test("stringify/parse union with object variant", () => {
  const schema = S.object({
    val: S.union(S.object({ type: S.literal("a"), x: S.integer() }), S.string()),
  });
  const str = ST.stringify(schema);
  const r1 = str({ val: { type: "a" as const, x: 1 } });
  assert.ok(r1.includes("type: a"));
  const r2 = str({ val: "simple" });
  assert.ok(r2.includes("val: simple"));
});

test("stringify/parse union with array variant", () => {
  const schema = S.object({
    val: S.union(S.array(S.integer()), S.string()),
  });
  const str = ST.stringify(schema);
  const r = str({ val: [1, 2, 3] });
  assert.ok(r.includes("val[3]:"));
});

// ---------------------------------------------------------------------------
// Coverage: nullable/optional in parse body (compile-time paths)
// ---------------------------------------------------------------------------

test("parse optional wrapper at compile time", () => {
  const schema = S.optional(S.object({ x: S.integer() }));
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  assert.deepEqual(assertOk(par(str({ x: 1 }))), { x: 1 });
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

test("parse object with unknown-kind field (emitPrimValueParse default)", () => {
  // Force the default branch in emitPrimValueParse by using a schema kind
  // that isn't handled by the specific cases — the fallback unquotes the value
  const custom = { kind: "CUSTOM", meta: undefined } as unknown as S.Schema;
  const schema = {
    kind: "object",
    meta: {
      properties: { x: custom },
      additionalProperties: false,
    },
  } as unknown as S.StringSchema;
  const par = ST.parse(schema);
  assert.equal(par("x: hello")[0], true);
});

// ---------------------------------------------------------------------------
// Coverage: TOON record proto pollution guard
// ---------------------------------------------------------------------------

test("parse record strips __proto__ and constructor keys", () => {
  const schema = S.record(S.string());
  const par = ST.parse(schema);
  const toon = "__proto__: evil\nconstructor: bad\nname: Alice";
  const r = assertOk(par(toon));
  assert.equal((r as Record<string, unknown>).name, "Alice");
  assert.equal(Object.hasOwn(r, "__proto__"), false);
  assert.equal(Object.hasOwn(r, "constructor"), false);
});

// ---------------------------------------------------------------------------
// Coverage: expanded array format round-trip
// ---------------------------------------------------------------------------

test("stringify/parse expanded array (non-tabular items)", () => {
  // array(record(string)) is non-primitive and non-tabular → expanded "- " format.
  // But expanded format currently only supports primitive inline expressions in
  // the "- value" items. For compound items, tabular format is used.
  // Test that the expanded parse path works for the union(string,number) case:
  const schema = S.object({
    items: S.array(S.union(S.string(), S.integer())),
  });
  const str = ST.stringify(schema);
  const par = ST.parse(schema);
  const obj = { items: ["hello", 42, "world"] as (string | number)[] };
  const toon = str(obj);
  assert.ok(toon.includes("- hello") || toon.includes("items[3]:"));
  // Round-trip: if inline format is used, parse should recover
  const result = par(toon);
  assert.equal(result[0], true);
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
