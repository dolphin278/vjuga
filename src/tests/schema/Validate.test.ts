import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import { validate, type SchemaError } from "../../schema/Validate.js";
import { assertOk, assertErr } from "./_helpers.js";

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

test("object — rejects arrays", () => {
  // typeof [] === "object", so without Array.isArray guard an array
  // with matching properties (e.g. .length) would incorrectly pass.
  const v = validate(S.object({ length: S.number() }));
  assertErr(v([1, 2, 3]));
  assertErr(v([]));
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

test("discriminated union — rejects arrays", () => {
  const v = validate(
    S.union(
      S.object({ type: S.literal("a"), value: S.string() }),
      S.object({ type: S.literal("b"), value: S.number() }),
    ),
  );
  assertErr(v([1, 2]));
  assertErr(v([]));
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
  const v = validate(S.union(S.object({ name: S.string() }), S.object({ id: S.integer() })));
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
  const e = assertErr(v({ users: [{ id: 1, name: "Alice", tags: [42] }] }));
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

// ---------------------------------------------------------------------------
// Coverage: quickTypeCheck branches
// ---------------------------------------------------------------------------

test("union — integer | boolean | null dispatch", () => {
  // Exercises quickTypeCheck for integer, boolean, null cases
  const v = validate(S.union(S.integer(), S.boolean(), S.null_()));
  assertOk(v(42));
  assertOk(v(true));
  assertOk(v(null));
  assertErr(v("hello"));
});

test("union — large enum as last variant", () => {
  // enum > 4 values as last variant exercises full emitValidation path
  const v = validate(S.union(S.number(), S.enum_("a", "b", "c", "d", "e")));
  assertOk(v(42));
  assertOk(v("a"));
  assertOk(v("e"));
  assertErr(v(true));
});

test("union — array | tuple dispatch", () => {
  // Exercises quickTypeCheck for array/tuple kinds
  const v = validate(S.union(S.array(S.number()), S.string()));
  assertOk(v([1, 2]));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — object | string dispatch (non-discriminated)", () => {
  // Exercises emitObjectVariantTest path for non-discriminated object unions
  const v = validate(S.union(S.object({ x: S.number(), y: S.number() }), S.string()));
  assertOk(v({ x: 1, y: 2 }));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — non-discriminated objects fall through on property mismatch", () => {
  // When object variant's properties don't match, falls through to next variant
  const v = validate(S.union(S.object({ x: S.string() }), S.object({ y: S.number() })));
  assertOk(v({ x: "hello" }));
  assertOk(v({ y: 42 }));
});

test("union — nested union in quickTypeCheck", () => {
  // Exercises the union case in quickTypeCheck (recursive)
  const inner = S.union(S.string(), S.number());
  const v = validate(S.union(inner, S.boolean()));
  assertOk(v("hello"));
  assertOk(v(42));
  assertOk(v(true));
  assertErr(v(null));
});

test("enum — large set (>8 values)", () => {
  const v = validate(S.enum_(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  assertOk(v(1));
  assertOk(v(10));
  assertErr(v(11));
});

// ---------------------------------------------------------------------------
// Coverage: union — non-discriminated objects with object variant test
// ---------------------------------------------------------------------------

test("union — object variant without quick type check", () => {
  // Two object schemas where the first variant can't be distinguished by typeof —
  // triggers emitObjectVariantTest (tests object shape matching)
  const v = validate(
    S.union(S.object({ x: S.integer(), y: S.integer() }), S.object({ name: S.string() })),
  );
  assertOk(v({ x: 1, y: 2 }));
  assertOk(v({ name: "hi" }));
  // First variant tried first — fails shape check, falls through to second
  assertOk(v({ name: "hi", extra: true }));
});

test("union — quickTypeCheck null literal", () => {
  const v = validate(S.union(S.null_(), S.string()));
  assertOk(v(null));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — non-discriminated object-only variants (emitObjectVariantTest)", () => {
  // Both variants are objects without a discriminant key — triggers
  // emitObjectVariantTest which probes object shape with labeled breaks
  const v = validate(S.union(S.object({ x: S.integer() }), S.object({ y: S.string() })));
  assertOk(v({ x: 1 }));
  assertOk(v({ y: "hi" }));
  assertErr(v("not an object"));
  assertErr(v(null));
});

test("union — quickTypeCheck returns null for literal kind", () => {
  // literal and enum don't have a quickTypeCheck, so the union falls back
  // to trying each variant via emitValidation on the last variant
  const v = validate(S.union(S.literal("a"), S.literal("b")));
  assertOk(v("a"));
  assertOk(v("b"));
  assertErr(v("c"));
});

test("union — three object variants without discriminant", () => {
  const v = validate(
    S.union(
      S.object({ a: S.integer() }),
      S.object({ b: S.string() }),
      S.object({ c: S.boolean() }),
    ),
  );
  assertOk(v({ a: 1 }));
  assertOk(v({ b: "hi" }));
  assertOk(v({ c: true }));
  assertErr(v(42));
});

test("validate throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => validate(bad), /unreachable/i);
});

test("union — unknown kind variant throws at compile time", () => {
  // A variant with an unknown kind causes emitValidation to throw unreachable
  // during sub-validator compilation — detected at compile time, not runtime.
  const unknown = { kind: "CUSTOM", meta: undefined } as unknown as S.Schema;
  const u = {
    kind: "union",
    meta: { variants: [unknown, S.string()] },
  } as unknown as S.StringSchema;
  assert.throws(() => validate(u), /unreachable/i);
});

// ---------------------------------------------------------------------------
// Coverage: multipleOf with floating-point values
// ---------------------------------------------------------------------------

test("number — multipleOf with float (0.1)", () => {
  const v = validate(S.number({ multipleOf: 0.1 }));
  assertOk(v(0.3));
  assertOk(v(0.1));
  assertOk(v(1.0));
  assertErr(v(0.15));
});

test("integer — exclusiveMinimum and exclusiveMaximum", () => {
  const v = validate(S.integer({ exclusiveMinimum: 0, exclusiveMaximum: 10 }));
  assertErr(v(0));
  assertOk(v(1));
  assertOk(v(9));
  assertErr(v(10));
});

test("integer — multipleOf", () => {
  const v = validate(S.integer({ multipleOf: 3 }));
  assertOk(v(0));
  assertOk(v(9));
  assertErr(v(10));
});

test("number — Infinity rejected by maximum constraint", () => {
  const v = validate(S.number({ maximum: 100 }));
  assertErr(v(Infinity));
  assertOk(v(100));
});

// ---------------------------------------------------------------------------
// Coverage: union with large enum (quickTypeCheck null) — Bug 1 fix
// ---------------------------------------------------------------------------

test("union — large enum + integer (enum quickTypeCheck null)", () => {
  const v = validate(S.union(S.enum_("a", "b", "c", "d", "e"), S.integer()));
  assertOk(v("a"));
  assertOk(v("e"));
  assertOk(v(42));
  assertErr(v(true));
});

test("union — error includes path info", () => {
  const v = validate(S.object({ x: S.union(S.string(), S.integer()) }));
  const r = v({ x: true });
  assert.equal(r[0], false);
  const e = r[1] as SchemaError;
  assert.equal(e.path, "x");
});

// ---------------------------------------------------------------------------
// String format validation
// ---------------------------------------------------------------------------

test("string format: email — accepts valid", () => {
  const v = validate(S.string({ format: "email" }));
  assertOk(v("user@example.com"));
  assertOk(v("a+b@sub.domain.co"));
});

test("string format: email — rejects invalid", () => {
  const v = validate(S.string({ format: "email" }));
  const e = assertErr(v("not-an-email"));
  assert.equal(e.expected, "string(format=email)");
});

test("string format: uri — accepts valid", () => {
  const v = validate(S.string({ format: "uri" }));
  assertOk(v("https://example.com/path?q=1"));
  assertOk(v("ftp://files.example.com"));
});

test("string format: uri — rejects invalid", () => {
  const v = validate(S.string({ format: "uri" }));
  assertErr(v("not a uri"));
});

test("string format: uuid — accepts valid", () => {
  const v = validate(S.string({ format: "uuid" }));
  assertOk(v("550e8400-e29b-41d4-a716-446655440000"));
});

test("string format: uuid — rejects invalid", () => {
  const v = validate(S.string({ format: "uuid" }));
  assertErr(v("not-a-uuid"));
});

test("string format: iso-datetime — accepts valid", () => {
  const v = validate(S.string({ format: "iso-datetime" }));
  assertOk(v("2024-01-15T10:30:00Z"));
  assertOk(v("2024-01-15T10:30:00.123+05:00"));
});

test("string format: iso-datetime — rejects invalid", () => {
  const v = validate(S.string({ format: "iso-datetime" }));
  assertErr(v("2024-01-15"));
});

test("string format: unknown format — silently skipped", () => {
  // Unknown format strings should not cause errors
  const v = validate(S.string({ format: "custom-thing" as "email" }));
  assertOk(v("anything"));
});
