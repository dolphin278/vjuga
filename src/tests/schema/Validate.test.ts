import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import { validate, type SchemaError } from "../../schema/Validate.js";
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
// Primitives
// ---------------------------------------------------------------------------

test("string — valid", () => {
  const v = validate(S.string());
  const r = assertOk(v("hello"));
  assert.equal(r, "hello");
});

test("string — invalid", () => {
  const v = validate(S.string());
  const e = assertErr(v(42));
  assert.equal(e.expected, "string");
  assert.equal(e.path, "");
});

test("string — minLength", () => {
  const v = validate(S.string({ minLength: 3 }));
  assertOk(v("abc"));
  const e = assertErr(v("ab"));
  assert.match(e.expected, /minLength/);
});

test("string — maxLength", () => {
  const v = validate(S.string({ maxLength: 3 }));
  assertOk(v("abc"));
  assertErr(v("abcd"));
});

test("string — pattern", () => {
  const v = validate(S.string({ pattern: "^[a-z]+$" }));
  assertOk(v("abc"));
  assertErr(v("ABC"));
  assertErr(v("123"));
});

test("number — valid", () => {
  const v = validate(S.number());
  assert.equal(assertOk(v(3.14)), 3.14);
  assert.equal(assertOk(v(0)), 0);
  assert.equal(assertOk(v(-1)), -1);
});

test("number — rejects NaN", () => {
  const v = validate(S.number());
  assertErr(v(NaN));
});

test("number — rejects non-number", () => {
  const v = validate(S.number());
  assertErr(v("hello"));
  assertErr(v(true));
  assertErr(v(null));
});

test("number — minimum", () => {
  const v = validate(S.number({ minimum: 0 }));
  assertOk(v(0));
  assertOk(v(1));
  assertErr(v(-1));
});

test("number — maximum", () => {
  const v = validate(S.number({ maximum: 100 }));
  assertOk(v(100));
  assertErr(v(101));
});

test("number — exclusiveMinimum", () => {
  const v = validate(S.number({ exclusiveMinimum: 0 }));
  assertOk(v(1));
  assertErr(v(0));
});

test("number — exclusiveMaximum", () => {
  const v = validate(S.number({ exclusiveMaximum: 100 }));
  assertOk(v(99));
  assertErr(v(100));
});

test("number — multipleOf", () => {
  const v = validate(S.number({ multipleOf: 5 }));
  assertOk(v(0));
  assertOk(v(10));
  assertErr(v(3));
});

test("integer — valid", () => {
  const v = validate(S.integer());
  assert.equal(assertOk(v(42)), 42);
  assert.equal(assertOk(v(0)), 0);
  assert.equal(assertOk(v(-1)), -1);
});

test("integer — rejects float", () => {
  const v = validate(S.integer());
  assertErr(v(3.14));
});

test("integer — rejects NaN", () => {
  assertErr(validate(S.integer())(NaN));
});

test("integer — rejects non-number", () => {
  assertErr(validate(S.integer())("hello"));
});

test("integer — constraints", () => {
  const v = validate(S.integer({ minimum: 1, maximum: 10 }));
  assertOk(v(1));
  assertOk(v(10));
  assertErr(v(0));
  assertErr(v(11));
});

test("boolean — valid", () => {
  const v = validate(S.boolean());
  assert.equal(assertOk(v(true)), true);
  assert.equal(assertOk(v(false)), false);
});

test("boolean — invalid", () => {
  assertErr(validate(S.boolean())(42));
  assertErr(validate(S.boolean())("true"));
});

test("null — valid", () => {
  const v = validate(S.null_());
  assert.equal(assertOk(v(null)), null);
});

test("null — invalid", () => {
  assertErr(validate(S.null_())(undefined));
  assertErr(validate(S.null_())(0));
});

test("literal — string", () => {
  const v = validate(S.literal("hello"));
  assertOk(v("hello"));
  assertErr(v("world"));
  assertErr(v(42));
});

test("literal — number", () => {
  const v = validate(S.literal(42));
  assertOk(v(42));
  assertErr(v(43));
});

test("literal — boolean", () => {
  const v = validate(S.literal(true));
  assertOk(v(true));
  assertErr(v(false));
});

test("literal — null", () => {
  const v = validate(S.literal(null));
  assertOk(v(null));
  assertErr(v(undefined));
});

test("enum — small (unrolled)", () => {
  const v = validate(S.enum_("a", "b", "c"));
  assertOk(v("a"));
  assertOk(v("b"));
  assertOk(v("c"));
  assertErr(v("d"));
  assertErr(v(1));
});

test("enum — large (Set)", () => {
  const v = validate(S.enum_(1, 2, 3, 4, 5, 6, 7, 8, 9));
  assertOk(v(1));
  assertOk(v(9));
  assertErr(v(10));
  assertErr(v("1"));
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

test("object — valid", () => {
  const v = validate(S.object({ name: S.string(), age: S.integer() }));
  const r = assertOk(v({ name: "Alice", age: 30 }));
  assert.equal(r.name, "Alice");
  assert.equal(r.age, 30);
});

test("object — rejects null", () => {
  const e = assertErr(validate(S.object({ a: S.string() }))(null));
  assert.equal(e.expected, "object");
  assert.equal(e.path, "");
});

test("object — rejects non-object", () => {
  assertErr(validate(S.object({ a: S.string() }))(42));
});

test("object — nested error path", () => {
  const v = validate(S.object({ user: S.object({ name: S.string() }) }));
  const e = assertErr(v({ user: { name: 42 } }));
  assert.equal(e.path, "user.name");
  assert.equal(e.expected, "string");
});

test("object — returns input as-is on success", () => {
  const input = { name: "test", extra: true };
  const v = validate(S.object({ name: S.string() }));
  const r = assertOk(v(input));
  // Returns the same reference — zero allocation on success path
  assert.equal(r, input);
});

test("array — valid", () => {
  const v = validate(S.array(S.string()));
  const r = assertOk(v(["a", "b", "c"]));
  assert.deepEqual(r, ["a", "b", "c"]);
});

test("array — empty", () => {
  assertOk(validate(S.array(S.string()))([]));
});

test("array — rejects non-array", () => {
  assertErr(validate(S.array(S.string()))("hello"));
  assertErr(validate(S.array(S.string()))({}));
});

test("array — element error includes index in path", () => {
  const v = validate(S.array(S.integer()));
  const e = assertErr(v([1, 2, "three"]));
  assert.match(e.path, /2/);
  assert.equal(e.expected, "integer");
});

test("array — minItems", () => {
  const v = validate(S.array(S.string(), { minItems: 2 }));
  assertOk(v(["a", "b"]));
  assertErr(v(["a"]));
});

test("array — maxItems", () => {
  const v = validate(S.array(S.string(), { maxItems: 2 }));
  assertOk(v(["a", "b"]));
  assertErr(v(["a", "b", "c"]));
});

test("array of objects", () => {
  const v = validate(S.array(S.object({ id: S.integer() })));
  assertOk(v([{ id: 1 }, { id: 2 }]));
  const e = assertErr(v([{ id: 1 }, { id: "two" }]));
  assert.match(e.path, /1/);
  assert.match(e.path, /id/);
});

test("tuple — valid", () => {
  const v = validate(S.tuple(S.string(), S.integer(), S.boolean()));
  assertOk(v(["hello", 42, true]));
});

test("tuple — wrong length", () => {
  const v = validate(S.tuple(S.string(), S.integer()));
  assertErr(v(["hello"]));
  assertErr(v(["hello", 42, true]));
});

test("tuple — wrong type", () => {
  const v = validate(S.tuple(S.string(), S.integer()));
  const e = assertErr(v(["hello", "world"]));
  assert.match(e.path, /1/);
});

test("tuple — rejects non-array", () => {
  assertErr(validate(S.tuple(S.string()))("hello"));
});

test("record — valid", () => {
  const v = validate(S.record(S.number()));
  assertOk(v({ a: 1, b: 2.5 }));
});

test("record — empty", () => {
  assertOk(validate(S.record(S.number()))({}));
});

test("record — invalid value", () => {
  const e = assertErr(validate(S.record(S.number()))({ a: "one" }));
  assert.match(e.path, /a/);
});

test("record — rejects non-object", () => {
  assertErr(validate(S.record(S.number()))(42));
  assertErr(validate(S.record(S.number()))([]));
  assertErr(validate(S.record(S.number()))(null));
});

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

test("optional — accepts undefined", () => {
  const v = validate(S.optional(S.string()));
  assertOk(v(undefined));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("nullable — accepts null", () => {
  const v = validate(S.nullable(S.string()));
  assertOk(v(null));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — string | number", () => {
  const v = validate(S.union(S.string(), S.number()));
  assertOk(v("hello"));
  assertOk(v(42));
  assertErr(v(true));
});

test("union — literal dispatch", () => {
  const v = validate(S.union(S.literal("a"), S.literal("b")));
  assertOk(v("a"));
  assertOk(v("b"));
  assertErr(v("c"));
});

test("union — single variant", () => {
  const v = validate(S.union(S.string()));
  assertOk(v("hello"));
  assertErr(v(42));
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

test("discriminated union — switch on tag", () => {
  const v = validate(
    S.union(
      S.object({ type: S.literal("circle"), radius: S.number() }),
      S.object({ type: S.literal("rect"), w: S.number(), h: S.number() }),
    ),
  );
  assertOk(v({ type: "circle", radius: 5 }));
  assertOk(v({ type: "rect", w: 3, h: 4 }));
  assertErr(v({ type: "triangle" }));
  assertErr(v({ type: "circle", radius: "five" }));
  assertErr(v({ type: "rect", w: 3, h: "four" }));
  assertErr(v(null));
  assertErr(v(42));
});

test("discriminated union — 3+ variants", () => {
  const v = validate(
    S.union(
      S.object({ kind: S.literal("a"), value: S.string() }),
      S.object({ kind: S.literal("b"), value: S.number() }),
      S.object({ kind: S.literal("c"), value: S.boolean() }),
    ),
  );
  assertOk(v({ kind: "a", value: "x" }));
  assertOk(v({ kind: "b", value: 1 }));
  assertOk(v({ kind: "c", value: true }));
  assertErr(v({ kind: "d" }));
});

// ---------------------------------------------------------------------------
// Non-discriminated union with objects
// ---------------------------------------------------------------------------

test("union — non-discriminated objects", () => {
  const v = validate(
    S.union(
      S.object({ name: S.string() }),
      S.object({ id: S.integer() }),
    ),
  );
  assertOk(v({ name: "Alice" }));
  assertOk(v({ id: 42 }));
  // Note: the first variant that matches wins
});

// ---------------------------------------------------------------------------
// Complex unions
// ---------------------------------------------------------------------------

test("union — with array variant", () => {
  const v = validate(S.union(S.string(), S.array(S.number())));
  assertOk(v("hello"));
  assertOk(v([1, 2, 3]));
  assertErr(v(42));
});

test("union — with tuple variant", () => {
  const v = validate(S.union(S.string(), S.tuple(S.number(), S.string())));
  assertOk(v("hello"));
  assertOk(v([42, "world"]));
});

test("union — with enum variant", () => {
  const v = validate(S.union(S.enum_("a", "b"), S.number()));
  assertOk(v("a"));
  assertOk(v(42));
  assertErr(v("c"));
});

test("union — with record variant", () => {
  const v = validate(S.union(S.string(), S.record(S.number())));
  assertOk(v("hello"));
  assertOk(v({ a: 1 }));
});

test("union — with optional variant", () => {
  const v = validate(S.union(S.optional(S.string()), S.number()));
  assertOk(v(undefined));
  assertOk(v("hello"));
  assertOk(v(42));
});

test("union — with nullable variant", () => {
  const v = validate(S.union(S.nullable(S.string()), S.number()));
  assertOk(v(null));
  assertOk(v("hello"));
  assertOk(v(42));
});

test("union — nested unions", () => {
  const v = validate(S.union(S.union(S.string(), S.number()), S.boolean()));
  assertOk(v("hello"));
  assertOk(v(42));
  assertOk(v(true));
  assertErr(v(null));
});

// ---------------------------------------------------------------------------
// Deeply nested
// ---------------------------------------------------------------------------

test("deeply nested schema", () => {
  const v = validate(
    S.object({
      users: S.array(
        S.object({
          id: S.integer(),
          name: S.string(),
          tags: S.array(S.string()),
          meta: S.optional(S.object({ role: S.enum_("admin", "user") })),
        }),
      ),
    }),
  );
  assertOk(
    v({
      users: [
        { id: 1, name: "Alice", tags: ["a"], meta: { role: "admin" } },
        { id: 2, name: "Bob", tags: [], meta: undefined },
      ],
    }),
  );
  const e = assertErr(
    v({ users: [{ id: 1, name: "Alice", tags: [42] }] }),
  );
  // Path should include array index and field
  assert.ok(e.path.length > 0);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("empty object", () => {
  const v = validate(S.object({}));
  assertOk(v({}));
  assertOk(v({ extra: true }));
  assertErr(v(null));
  assertErr(v(42));
});

test("-0 is a valid number", () => {
  const v = validate(S.number());
  assertOk(v(-0));
});

test("Infinity is a valid number", () => {
  const v = validate(S.number());
  assertOk(v(Infinity));
  assertOk(v(-Infinity));
});

test("array of arrays", () => {
  const v = validate(S.array(S.array(S.integer())));
  assertOk(v([[1, 2], [3]]));
  assertErr(v([[1, "two"]]));
});

test("nested optional", () => {
  const v = validate(S.object({ a: S.optional(S.optional(S.string())) }));
  assertOk(v({}));
  assertOk(v({ a: undefined }));
  assertOk(v({ a: "hello" }));
  assertErr(v({ a: 42 }));
});

test("record of arrays", () => {
  const v = validate(S.record(S.array(S.integer())));
  assertOk(v({ a: [1, 2], b: [3] }));
  assertErr(v({ a: [1, "two"] }));
});
