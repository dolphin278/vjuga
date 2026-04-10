import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as ST from "../../schema/TOON.js";
import type { SchemaError } from "../../schema/Validate.js";
import type { Result } from "../../Result.js";

// --- Helpers ---
function assertOk<T>(r: Result<T, SchemaError>): T {
  /* node:coverage ignore next 2 */
  if (!r[0]) throw new Error(`Expected Ok but got Err: ${JSON.stringify(r[1])}`);
  return r[1];
}
function assertErr(r: Result<unknown, SchemaError>): SchemaError {
  /* node:coverage ignore next 2 */
  if (r[0]) throw new Error("Expected Err but got Ok: " + JSON.stringify(r[1]));
  return r[1];
}

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
  const fn = ST.stringify(S.object({
    user: S.object({ name: S.string() }),
  }));
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
  assert.equal(
    result,
    "users[2]{id,name}:\n  1,Alice\n  2,Bob",
  );
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
  const fn = ST.parse(
    S.object({ name: S.string(), age: S.integer() }),
    { flexibleOrder: true },
  );
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
  const value = { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] };
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
  assert.deepEqual(
    assertOk(par(str({ user: { name: "Alice", score: 95.5 } }))),
    { user: { name: "Alice", score: 95.5 } },
  );
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
