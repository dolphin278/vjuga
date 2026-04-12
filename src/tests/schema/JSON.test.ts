import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import { assertOk, assertErr } from "./_helpers.js";

// ---------------------------------------------------------------------------
// stringify — primitives
// ---------------------------------------------------------------------------

test("stringify string", () => {
  const fn = SJ.stringify(S.string());
  assert.equal(fn("hello"), '"hello"');
  assert.equal(fn(""), '""');
});

test("stringify string with special chars", () => {
  const fn = SJ.stringify(S.string());
  assert.equal(fn('a"b'), '"a\\"b"');
  assert.equal(fn("a\\b"), '"a\\\\b"');
  assert.equal(fn("a\nb"), '"a\\nb"');
  assert.equal(fn("a\tb"), '"a\\tb"');
  assert.equal(fn("a\rb"), '"a\\rb"');
});

test("stringify long string delegates to JSON.stringify", () => {
  const fn = SJ.stringify(S.string());
  const long = "x".repeat(200);
  assert.equal(fn(long), JSON.stringify(long));
});

test("stringify number", () => {
  const fn = SJ.stringify(S.number());
  assert.equal(fn(42), "42");
  assert.equal(fn(3.14), "3.14");
  assert.equal(fn(-1), "-1");
  assert.equal(fn(0), "0");
});

test("stringify integer", () => {
  const fn = SJ.stringify(S.integer());
  assert.equal(fn(42), "42");
});

test("stringify boolean", () => {
  const fn = SJ.stringify(S.boolean());
  assert.equal(fn(true), "true");
  assert.equal(fn(false), "false");
});

test("stringify null", () => {
  const fn = SJ.stringify(S.null_());
  assert.equal(fn(null), "null");
});

test("stringify literal", () => {
  assert.equal(SJ.stringify(S.literal("x"))("x"), '"x"');
  assert.equal(SJ.stringify(S.literal(42))(42), "42");
  assert.equal(SJ.stringify(S.literal(true))(true), "true");
  assert.equal(SJ.stringify(S.literal(null))(null), "null");
});

test("stringify enum", () => {
  const fn = SJ.stringify(S.enum_("a", "b", 1));
  assert.equal(fn("a"), '"a"');
  assert.equal(fn(1), "1");
});

// ---------------------------------------------------------------------------
// stringify — structural
// ---------------------------------------------------------------------------

test("stringify object", () => {
  const fn = SJ.stringify(S.object({ id: S.integer(), name: S.string() }));
  assert.equal(fn({ id: 1, name: "Alice" }), '{"id":1,"name":"Alice"}');
});

test("stringify empty object", () => {
  const fn = SJ.stringify(S.object({}));
  assert.equal(fn({}), "{}");
});

test("stringify object with optional field — present", () => {
  const fn = SJ.stringify(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.equal(fn({ name: "Alice", age: 30 }), '{"name":"Alice","age":30}');
});

test("stringify object with optional field — absent", () => {
  const fn = SJ.stringify(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.equal(fn({ name: "Bob" }), '{"name":"Bob"}');
});

test("stringify array", () => {
  const fn = SJ.stringify(S.array(S.string()));
  assert.equal(fn(["a", "b"]), '["a","b"]');
  assert.equal(fn([]), "[]");
});

test("stringify array of objects", () => {
  const fn = SJ.stringify(S.array(S.object({ x: S.number() })));
  assert.equal(fn([{ x: 1 }, { x: 2 }]), '[{"x":1},{"x":2}]');
});

test("stringify tuple", () => {
  const fn = SJ.stringify(S.tuple(S.string(), S.integer()));
  assert.equal(fn(["hello", 42]), '["hello",42]');
});

test("stringify empty tuple", () => {
  const fn = SJ.stringify(S.tuple());
  assert.equal(fn([]), "[]");
});

test("stringify record", () => {
  const fn = SJ.stringify(S.record(S.number()));
  const result = fn({ a: 1, b: 2 });
  assert.equal(result, '{"a":1,"b":2}');
});

test("stringify empty record", () => {
  const fn = SJ.stringify(S.record(S.number()));
  assert.equal(fn({}), "{}");
});

test("stringify nullable — present", () => {
  const fn = SJ.stringify(S.nullable(S.string()));
  assert.equal(fn("hello"), '"hello"');
});

test("stringify nullable — null", () => {
  const fn = SJ.stringify(S.nullable(S.string()));
  assert.equal(fn(null), "null");
});

test("stringify optional — present", () => {
  const fn = SJ.stringify(S.optional(S.string()));
  assert.equal(fn("hello"), '"hello"');
});

test("stringify optional — undefined", () => {
  const fn = SJ.stringify(S.optional(S.string()));
  assert.equal(fn(undefined), "null");
});

// ---------------------------------------------------------------------------
// stringify — union
// ---------------------------------------------------------------------------

test("stringify union — string | number", () => {
  const fn = SJ.stringify(S.union(S.string(), S.number()));
  assert.equal(fn("hello"), '"hello"');
  assert.equal(fn(42), "42");
});

test("stringify discriminated union", () => {
  const fn = SJ.stringify(
    S.union(
      S.object({ type: S.literal("circle"), r: S.number() }),
      S.object({ type: S.literal("rect"), w: S.number(), h: S.number() }),
    ),
  );
  assert.equal(fn({ type: "circle", r: 5 }), '{"type":"circle","r":5}');
  assert.equal(fn({ type: "rect", w: 3, h: 4 }), '{"type":"rect","w":3,"h":4}');
});

// ---------------------------------------------------------------------------
// stringify — nested
// ---------------------------------------------------------------------------

test("stringify nested object", () => {
  const fn = SJ.stringify(
    S.object({
      user: S.object({ name: S.string() }),
      scores: S.array(S.integer()),
    }),
  );
  const result = fn({ user: { name: "Alice" }, scores: [90, 85] });
  assert.equal(result, '{"user":{"name":"Alice"},"scores":[90,85]}');
});

// ---------------------------------------------------------------------------
// stringify — round-trip with JSON.parse
// ---------------------------------------------------------------------------

test("stringify round-trips with JSON.parse", () => {
  const schema = S.object({
    id: S.integer(),
    name: S.string(),
    active: S.boolean(),
    tags: S.array(S.string()),
    score: S.nullable(S.number()),
  });
  const fn = SJ.stringify(schema);
  const value = { id: 1, name: "Alice", active: true, tags: ["admin"], score: null };
  const json = fn(value);
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed, value);
});

// ---------------------------------------------------------------------------
// parse — valid inputs
// ---------------------------------------------------------------------------

test("parse string", () => {
  const fn = SJ.parse(S.string());
  assert.equal(assertOk(fn('"hello"')), "hello");
});

test("parse number", () => {
  const fn = SJ.parse(S.number());
  assert.equal(assertOk(fn("42")), 42);
});

test("parse integer", () => {
  const fn = SJ.parse(S.integer());
  assert.equal(assertOk(fn("42")), 42);
});

test("parse boolean", () => {
  const fn = SJ.parse(S.boolean());
  assert.equal(assertOk(fn("true")), true);
});

test("parse null", () => {
  const fn = SJ.parse(S.null_());
  assert.equal(assertOk(fn("null")), null);
});

test("parse object", () => {
  const fn = SJ.parse(S.object({ id: S.integer(), name: S.string() }));
  const r = assertOk(fn('{"id":1,"name":"Alice"}'));
  assert.deepEqual(r, { id: 1, name: "Alice" });
});

test("parse array", () => {
  const fn = SJ.parse(S.array(S.string()));
  assert.deepEqual(assertOk(fn('["a","b"]')), ["a", "b"]);
});

test("parse tuple", () => {
  const fn = SJ.parse(S.tuple(S.string(), S.integer()));
  assert.deepEqual(assertOk(fn('["hello",42]')), ["hello", 42]);
});

test("parse record", () => {
  const fn = SJ.parse(S.record(S.number()));
  assert.deepEqual(assertOk(fn('{"a":1,"b":2}')), { a: 1, b: 2 });
});

test("parse union", () => {
  const fn = SJ.parse(S.union(S.string(), S.number()));
  assert.equal(assertOk(fn('"hello"')), "hello");
  assert.equal(assertOk(fn("42")), 42);
});

test("parse optional", () => {
  const fn = SJ.parse(S.object({ name: S.string(), age: S.optional(S.integer()) }));
  assert.deepEqual(assertOk(fn('{"name":"Alice"}')), { name: "Alice" });
  assert.deepEqual(assertOk(fn('{"name":"Alice","age":30}')), { name: "Alice", age: 30 });
});

test("parse nullable", () => {
  const fn = SJ.parse(S.nullable(S.string()));
  assert.equal(assertOk(fn('"hello"')), "hello");
  assert.equal(assertOk(fn("null")), null);
});

test("parse literal", () => {
  const fn = SJ.parse(S.literal("hello"));
  assert.equal(assertOk(fn('"hello"')), "hello");
  assertErr(fn('"world"'));
});

test("parse enum", () => {
  const fn = SJ.parse(S.enum_("a", "b"));
  assertOk(fn('"a"'));
  assertErr(fn('"c"'));
});

// ---------------------------------------------------------------------------
// parse — invalid inputs
// ---------------------------------------------------------------------------

test("parse rejects invalid JSON", () => {
  const fn = SJ.parse(S.string());
  const e = assertErr(fn("not json"));
  assert.equal(e.expected, "valid JSON");
});

test("parse rejects type mismatch", () => {
  const fn = SJ.parse(S.string());
  assertErr(fn("42"));
});

test("parse rejects invalid object field", () => {
  const fn = SJ.parse(S.object({ id: S.integer() }));
  const e = assertErr(fn('{"id":"not a number"}'));
  assert.equal(e.path, "id");
});

test("parse rejects invalid array element", () => {
  const fn = SJ.parse(S.array(S.integer()));
  const e = assertErr(fn('[1, "two"]'));
  assert.match(e.path, /1/);
});

test("parse rejects non-object", () => {
  assertErr(SJ.parse(S.object({ a: S.string() }))('"string"'));
});

test("parse rejects array as object", () => {
  assertErr(SJ.parse(S.object({ length: S.number() }))("[1,2,3]"));
});

test("parse rejects non-array", () => {
  assertErr(SJ.parse(S.array(S.string()))("{}"));
});

test("parse rejects wrong tuple length", () => {
  assertErr(SJ.parse(S.tuple(S.string(), S.number()))('["a"]'));
});

test("parse rejects non-object for record", () => {
  assertErr(SJ.parse(S.record(S.number()))("[1]"));
});

// ---------------------------------------------------------------------------
// parse — prototype pollution protection
// ---------------------------------------------------------------------------

test("parse strips __proto__ keys", () => {
  const fn = SJ.parse(S.object({ name: S.string() }));
  const r = assertOk(fn('{"name":"Alice","__proto__":{"admin":true}}'));
  assert.equal(r.name, "Alice");
  // Verify the __proto__ payload didn't pollute the prototype chain
  assert.equal((r as Record<string, unknown>).admin, undefined);
  assert.equal(Object.hasOwn(r, "__proto__"), false);
});

test("parse strips constructor keys", () => {
  const fn = SJ.parse(S.record(S.string()));
  const r = assertOk(fn('{"a":"1","constructor":"evil"}'));
  assert.equal((r as Record<string, unknown>).a, "1");
  // "constructor" own property should have been deleted
  assert.equal(Object.hasOwn(r, "constructor"), false);
});

// ---------------------------------------------------------------------------
// Round-trip: stringify → parse
// ---------------------------------------------------------------------------

test("round-trip — simple object", () => {
  const schema = S.object({ id: S.integer(), name: S.string(), active: S.boolean() });
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  const value = { id: 1, name: "Alice", active: true };
  assert.deepEqual(assertOk(par(str(value))), value);
});

test("round-trip — nested with arrays", () => {
  const schema = S.object({
    users: S.array(S.object({ name: S.string(), tags: S.array(S.string()) })),
  });
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  const value = { users: [{ name: "Alice", tags: ["admin", "user"] }] };
  assert.deepEqual(assertOk(par(str(value))), value);
});

test("round-trip — nullable", () => {
  const schema = S.nullable(S.integer());
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  assert.equal(assertOk(par(str(42))), 42);
  assert.equal(assertOk(par(str(null))), null);
});

test("round-trip — enum", () => {
  const schema = S.enum_("a", "b", 1);
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  assert.equal(assertOk(par(str("a"))), "a");
  assert.equal(assertOk(par(str(1))), 1);
});

test("round-trip — record of arrays", () => {
  const schema = S.record(S.array(S.integer()));
  const str = SJ.stringify(schema);
  const par = SJ.parse(schema);
  const value = { a: [1, 2], b: [3] };
  assert.deepEqual(assertOk(par(str(value))), value);
});

// ---------------------------------------------------------------------------
// Coverage: stringify edge cases
// ---------------------------------------------------------------------------

test("stringify string with control chars", () => {
  const fn = SJ.stringify(S.string());
  const result = fn("a\x00b\x08c\x0cd");
  assert.equal(result, JSON.stringify("a\x00b\x08c\x0cd"));
});

test("stringify union — boolean | null dispatch", () => {
  const fn = SJ.stringify(S.union(S.boolean(), S.null_()));
  assert.equal(fn(true), "true");
  assert.equal(fn(null), "null");
});

test("stringify union — array | object dispatch", () => {
  const fn = SJ.stringify(S.union(S.array(S.number()), S.object({ x: S.number() })));
  assert.equal(fn([1, 2]), "[1,2]");
  assert.equal(fn({ x: 1 }), '{"x":1}');
});

// ---------------------------------------------------------------------------
// Coverage: parse edge cases
// ---------------------------------------------------------------------------

test("parse union — boolean | null dispatch", () => {
  const fn = SJ.parse(S.union(S.boolean(), S.null_()));
  assert.equal(assertOk(fn("true")), true);
  assert.equal(assertOk(fn("null")), null);
  assertErr(fn('"hello"'));
});

test("parse single-variant union", () => {
  const fn = SJ.parse(S.union(S.string()));
  assert.equal(assertOk(fn('"hello"')), "hello");
});

test("parse nested nullable", () => {
  const fn = SJ.parse(S.object({ x: S.nullable(S.integer()) }));
  assert.deepEqual(assertOk(fn('{"x":null}')), { x: null });
  assert.deepEqual(assertOk(fn('{"x":42}')), { x: 42 });
});

// ---------------------------------------------------------------------------
// Coverage: union with non-quick-checkable variants (getTypeCheck → null)
// ---------------------------------------------------------------------------

test("stringify union with literal variants (getTypeCheck returns null)", () => {
  // literal kind has no getTypeCheck — falls through to JSON.stringify fallback
  const fn = SJ.stringify(S.union(S.literal("a"), S.literal("b")));
  assert.equal(fn("a" as "a" | "b"), '"a"');
  assert.equal(fn("b" as "a" | "b"), '"b"');
});

test("stringify union with enum variant", () => {
  const fn = SJ.stringify(S.union(S.enum_("x", "y"), S.integer()));
  assert.equal(fn("x"), '"x"');
  assert.equal(fn(42), "42");
});

// ---------------------------------------------------------------------------
// Coverage: exhaustive default branches — invalid schema kind
// ---------------------------------------------------------------------------

test("stringify throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => SJ.stringify(bad), /unreachable/i);
});

test("parse throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => SJ.parse(bad), /unreachable/i);
});
