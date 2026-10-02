import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import { validate, type SchemaError } from "../../schema/Validate.js";
import { jsLiteral, eqExpr, neExpr } from "../../schema/Codegen.js";
import { parse as jsonParse } from "../../schema/JSON.js";
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
  const v = validate(S.object({ name: S.string() }, { additionalProperties: true }));
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
  const e = assertErr(v({ extra: true }));
  assert.equal(e.path, "extra");
  assert.equal(e.expected, "no additional properties");
  assertOk(validate(S.object({}, { additionalProperties: true }))({ extra: true }));
  assertErr(v(null));
  assertErr(v(42));
});

test("-0 is a valid number", () => {
  const v = validate(S.number());
  assertOk(v(-0));
});

test("number — rejects ±Infinity (not JSON-representable)", () => {
  const v = validate(S.number());
  assert.equal(assertErr(v(Infinity)).expected, "number");
  assertErr(v(-Infinity));
  assertOk(v(Number.MAX_VALUE));
  assertOk(v(-Number.MIN_VALUE));
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

test("object — key containing + in error path", () => {
  const v = validate(S.object({ "a+b": S.string() }));
  const e = assertErr(v({ "a+b": 42 }));
  assert.equal(e.path, "a+b");
  assert.equal(e.expected, "string");
});

test("object — special chars in key error path", () => {
  const v = validate(S.object({ 'key"with"quotes': S.number() }));
  const e = assertErr(v({ 'key"with"quotes': "wrong" }));
  assert.equal(e.path, 'key"with"quotes');
  assert.equal(e.expected, "number");
});

// ---------------------------------------------------------------------------
// Coverage: exactCheck branches (inline union variant checks)
// ---------------------------------------------------------------------------

test("union — integer | boolean | null dispatch", () => {
  // Exercises exactCheck for integer, boolean, null cases
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

test("union — array | string dispatch", () => {
  // Array variants have no exact inline check — tried via a boolean sub-validator
  const v = validate(S.union(S.array(S.number()), S.string()));
  assertOk(v([1, 2]));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — object | string dispatch (non-discriminated)", () => {
  // Object variants are tried via a compiled boolean sub-validator
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

test("union — nested union with an exact inline check", () => {
  // A union of exact-checkable variants is itself exact-checkable (recursive)
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
// Coverage: union — non-discriminated object variants (boolean sub-validators)
// ---------------------------------------------------------------------------

test("union — object variant without an exact inline check", () => {
  // Two object schemas: the first variant is tried by a full sub-validator
  const v = validate(
    S.union(S.object({ x: S.integer(), y: S.integer() }), S.object({ name: S.string() })),
  );
  assertOk(v({ x: 1, y: 2 }));
  assertOk(v({ name: "hi" }));
  // First variant fails, second rejects the undeclared key
  assertErr(v({ name: "hi", extra: true }));
  const open = validate(
    S.union(
      S.object({ x: S.integer() }),
      S.object({ name: S.string() }, { additionalProperties: true }),
    ),
  );
  assertOk(open({ name: "hi", extra: true }));
});

test("union — null variant exact check", () => {
  const v = validate(S.union(S.null_(), S.string()));
  assertOk(v(null));
  assertOk(v("hello"));
  assertErr(v(42));
});

test("union — non-discriminated object-only variants", () => {
  // Both variants are objects without a discriminant key — the first is tried
  // via a boolean sub-validator, the last inline (its error is reported)
  const v = validate(S.union(S.object({ x: S.integer() }), S.object({ y: S.string() })));
  assertOk(v({ x: 1 }));
  assertOk(v({ y: "hi" }));
  assertErr(v("not an object"));
  assertErr(v(null));
});

test("union — literal variants use inline equality checks", () => {
  // Literals are exact-checkable: `v === "a"` for non-last variants
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
// Coverage: union with large enum (no exact check -> sub-validator)
// ---------------------------------------------------------------------------

test("union — large enum + integer (enum via sub-validator)", () => {
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

// ---------------------------------------------------------------------------
// Code injection — hostile strings never reach generated source unescaped
// ---------------------------------------------------------------------------

const HOSTILE = [
  '"',
  "'",
  "\\",
  '\\"',
  "\n",
  "\r\n",
  " ",
  " ",
  "${globalThis.__pwned = 1}",
  "`",
  "*/",
  "//",
  '"+(globalThis.__pwned=1)+"',
  "');globalThis.__pwned=1;('",
  "a+b",
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "",
];

function assertNotPwned(): void {
  assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
}

test("injection — hostile object keys: correct accept/reject and exact error path", () => {
  for (const key of HOSTILE) {
    const v = validate(S.object({ [key]: S.string() }));
    const good = { [key]: "ok" };
    assertOk(v(good));
    const e = assertErr(v({ [key]: 1 }));
    assert.equal(e.path, key);
    assert.equal(e.expected, "string");
    // An empty key is indistinguishable from the root in dot paths
    if (key === "") continue;
    // Nested under a static parent and under a dynamic (array) parent
    const nested = validate(S.object({ p: S.array(S.object({ [key]: S.integer() })) }));
    const ne = assertErr(nested({ p: [{ [key]: 1 }, { [key]: "x" }] }));
    assert.equal(ne.path, "p.1." + key);
    const deep = validate(S.object({ [key]: S.object({ [key]: S.boolean() }) }));
    const de = assertErr(deep({ [key]: { [key]: 0 } }));
    assert.equal(de.path, key + "." + key);
    // Extra-key error under a hostile parent path
    const strict = validate(S.object({ [key]: S.object({}) }));
    const se = assertErr(strict({ [key]: { z: 1 } }));
    assert.equal(se.path, key + ".z");
    // Record values under hostile parent (dynamic path)
    const rec = validate(S.object({ [key]: S.record(S.number()) }));
    const re = assertErr(rec({ [key]: { [key]: "x" } }));
    assert.equal(re.path, key + "." + key);
  }
  assertNotPwned();
});

test("injection — hostile extra key names in error paths", () => {
  const v = validate(S.object({ a: S.number() }));
  for (const key of HOSTILE) {
    if (key === "a") continue;
    const input = { a: 1, [key]: 1 };
    const e = assertErr(v(input));
    assert.equal(e.path, key);
    assert.equal(e.expected, "no additional properties");
  }
  assertNotPwned();
});

test("injection — hostile regex patterns are labels, never code", () => {
  const patterns = [
    '^"[a-z]+"$',
    '^a"$',
    '^"+(globalThis.__pwned=1)+"',
    "^\\\\$",
    " ",
    "${x}",
    "`",
  ];
  for (const pattern of patterns) {
    const v = validate(S.string({ pattern }));
    const re = new RegExp(pattern);
    for (const s of ['"abc"', "abc", "zzz", "\\", " ", "${x}", "`", 'a"']) {
      const r = v(s);
      assert.equal(r[0], re.test(s), `pattern ${pattern} on ${s}`);
      if (!r[0]) assert.equal(r[1].expected, `string(pattern=${pattern})`);
    }
  }
  // Same via untrusted JSON Schema text
  const text = JSON.stringify({ type: "string", pattern: '^"+(globalThis.__pwned=1)+"' });
  const [ok, schema] = S.fromJsonSchema(JSON.parse(text) as S.JsonSchemaObject);
  assert.ok(ok);
  assertErr(validate(schema as S.StringSchema)("zzz"));
  assertNotPwned();
});

test("injection — hostile literal, enum, and discriminant values", () => {
  for (const s of HOSTILE) {
    const lit = validate(S.literal(s));
    assertOk(lit(s));
    const le = assertErr(lit(s + "x"));
    assert.equal(le.expected, "literal(" + jsLiteral(s) + ")");
    const small = validate(S.enum_(s, "other"));
    assertOk(small(s));
    assertErr(small(s + "x"));
    const big = validate(S.enum_(s, "1", "2", "3", "4", "5", "6", "7", "8"));
    assertOk(big(s));
    assertErr(big(s + "x"));
    const inUnion = validate(S.union(S.literal(s), S.enum_(s + "x", "q"), S.number()));
    assertOk(inUnion(s));
    assertOk(inUnion(s + "x"));
    assertErr(inUnion(s + "y"));
    const disc = validate(
      S.union(
        S.object({ [s === "t" ? "u" : "t"]: S.literal(s), a: S.number() }),
        S.object({ [s === "t" ? "u" : "t"]: S.literal(s + "!"), b: S.string() }),
      ),
    );
    const tk = s === "t" ? "u" : "t";
    assertOk(disc({ [tk]: s, a: 1 }));
    assertOk(disc({ [tk]: s + "!", b: "x" }));
    const de = assertErr(disc({ [tk]: s + "?", a: 1 }));
    assert.equal(de.path, tk);
  }
  assertNotPwned();
});

test("injection — non-primitive constraint values throw TypeError at compile time", () => {
  const evil = { toString: () => "0) || (globalThis.__pwned = 1" } as unknown as number;
  assert.throws(() => validate(S.string({ minLength: evil })), TypeError);
  assert.throws(() => validate(S.number({ minimum: evil })), TypeError);
  assert.throws(() => validate(S.array(S.string(), { maxItems: evil })), TypeError);
  assert.throws(() => validate(S.literal(evil)), TypeError);
  assertNotPwned();
});

// ---------------------------------------------------------------------------
// Codegen literal helpers
// ---------------------------------------------------------------------------

test("Codegen.jsLiteral — round-trips primitives through eval", () => {
  const values: unknown[] = [
    ...HOSTILE,
    0,
    -0,
    1.5,
    -2,
    1e21,
    5e-324,
    NaN,
    Infinity,
    -Infinity,
    true,
    false,
    null,
    undefined,
  ];
  for (const v of values) {
    const back = new Function("return " + jsLiteral(v))() as unknown;
    assert.ok(Object.is(back, v), `round-trip ${String(v)}`);
  }
  assert.equal(jsLiteral("  "), '"\\u2028\\u2029"');
  assert.equal(jsLiteral(-0), "-0");
  assert.throws(() => jsLiteral({}), TypeError);
  assert.throws(() => jsLiteral(1n), TypeError);
  assert.throws(() => jsLiteral(Symbol("s")), TypeError);
});

test("Codegen.eqExpr / neExpr — SameValueZero semantics", () => {
  const check = (expr: string, x: unknown) => new Function("x", "return " + expr)(x) as boolean;
  assert.equal(check(eqExpr("x", NaN), NaN), true);
  assert.equal(check(eqExpr("x", NaN), 1), false);
  assert.equal(check(neExpr("x", NaN), NaN), false);
  assert.equal(check(eqExpr("x", 0), -0), true);
  assert.equal(check(eqExpr("x", "a"), "a"), true);
  assert.equal(check(neExpr("x", "a"), "b"), true);
});

// ---------------------------------------------------------------------------
// Unions accept a value only if some variant FULLY validates it
// ---------------------------------------------------------------------------

test("union — negative: object variants are validated deeply", () => {
  const v = validate(S.union(S.object({ a: S.string() }), S.object({ b: S.number() })));
  assertErr(v({}));
  assertErr(v({ a: 5 }));
  assertErr(v({ a: "x", b: 1 })); // matches neither strict shape
  assertOk(v({ a: "x" }));
  assertOk(v({ b: 1 }));
});

test("union — negative: constrained primitives are not shallow-checked", () => {
  const strMin = validate(S.union(S.string({ minLength: 5 }), S.number()));
  assertErr(strMin("x"));
  assertOk(strMin("hello"));
  assertOk(strMin(1));
  const intMin = validate(S.union(S.integer({ minimum: 0 }), S.string()));
  assertErr(intMin(-5));
  assertOk(intMin(5));
  const pat = validate(S.union(S.string({ pattern: "^a" }), S.boolean()));
  assertErr(pat("b"));
  assertOk(pat("a"));
  const fmt = validate(S.union(S.string({ format: "uuid" }), S.null_()));
  assertErr(fmt("nope"));
  const lenOnly = validate(S.union(S.string({ maxLength: 2 }), S.null_()));
  assertErr(lenOnly("abc"));
  assertOk(lenOnly("ab"));
  const num = validate(S.union(S.number({ multipleOf: 2 }), S.string()));
  assertErr(num(3));
});

test("union — negative: arrays, tuples, records, nested wrappers", () => {
  const arr = validate(S.union(S.array(S.string()), S.null_()));
  assertErr(arr([1, 2]));
  assertOk(arr(["a"]));
  const tup = validate(S.union(S.tuple(S.string(), S.number()), S.null_()));
  assertErr(tup([1, "a"]));
  assertOk(tup(["a", 1]));
  const rec = validate(S.union(S.record(S.number()), S.string()));
  assertErr(rec({ a: "x" }));
  const opt = validate(S.union(S.optional(S.object({ x: S.number() })), S.string()));
  assertErr(opt({ x: "no" }));
  assertOk(opt(undefined));
  assertOk(opt({ x: 1 }));
  const nul = validate(S.union(S.nullable(S.integer({ maximum: 3 })), S.boolean()));
  assertErr(nul(10));
  assertOk(nul(null));
  const optExact = validate(S.union(S.optional(S.string()), S.nullable(S.number()), S.boolean()));
  assertOk(optExact(undefined));
  assertOk(optExact(null));
  assertErr(optExact({}));
  const nested = validate(S.union(S.union(S.string(), S.array(S.number())), S.boolean()));
  assertErr(nested(["x"]));
  assertOk(nested([1]));
  const nonFinite = validate(S.union(S.number(), S.string()));
  assertErr(nonFinite(Infinity));
  assertErr(nonFinite(NaN));
});

test("union — sub-validators nest (union inside object inside union)", () => {
  const v = validate(
    S.union(
      S.object({ k: S.union(S.array(S.integer()), S.object({ z: S.string() })) }),
      S.string(),
    ),
  );
  assertOk(v({ k: [1] }));
  assertOk(v({ k: { z: "a" } }));
  assertErr(v({ k: { z: 1 } }));
  assertErr(v({ k: ["a"] }));
});

test("union — empty union matches nothing", () => {
  const v = validate(S.union());
  const e = assertErr(v(1));
  assert.equal(e.expected, "never");
  assertErr(validate(S.union(S.union(), S.string()))(1));
  assertOk(validate(S.union(S.union(), S.string()))("a"));
});

// ---------------------------------------------------------------------------
// additionalProperties: false (the default) is enforced
// ---------------------------------------------------------------------------

test("additionalProperties — strict default rejects undeclared own keys", () => {
  const v = validate(S.object({ a: S.string(), b: S.optional(S.number()) }));
  assertOk(v({ a: "x" }));
  assertOk(v({ a: "x", b: 1 }));
  // Optional key present with value undefined is declared, not extra
  assertOk(v({ a: "x", b: undefined }));
  const e = assertErr(v({ a: "x", evil: 1 }));
  assert.equal(e.path, "evil");
  assert.equal(e.received, 1);
  // Extra + absent optional: counts can match by coincidence — slow path catches it
  assertErr(v({ a: "x", c: 1 }));
  // Inherited enumerable keys are not "own" — not extras
  const proto = { inherited: 1 };
  const child = Object.create(proto) as Record<string, unknown>;
  child.a = "x";
  assertOk(v(child));
  // Non-enumerable own extras are invisible (same as Object.keys)
  const hidden = { a: "x" };
  Object.defineProperty(hidden, "secret", { value: 1, enumerable: false });
  assertOk(v(hidden));
  // Symbol keys are ignored
  assertOk(v({ a: "x", [Symbol("s")]: 1 }));
});

test("additionalProperties — true allows extras; nested strict objects still checked", () => {
  const v = validate(
    S.object({ inner: S.object({ x: S.number() }) }, { additionalProperties: true }),
  );
  assertOk(v({ inner: { x: 1 }, extra: true }));
  const e = assertErr(v({ inner: { x: 1, y: 2 } }));
  assert.equal(e.path, "inner.y");
});

test("additionalProperties — required key whose schema accepts undefined", () => {
  const v = validate(
    S.object({
      a: S.union(S.optional(S.string()), S.number()),
      b: S.nullable(S.optional(S.string())),
      c: S.literal(undefined as unknown as null),
    }),
  );
  assertOk(v({}));
  assertOk(v({ a: "x", b: null }));
  assertErr(v({ z: 1 }));
});

test("additionalProperties — discriminated union variants are strict", () => {
  const v = validate(
    S.union(
      S.object({ type: S.literal("a"), x: S.number() }),
      S.object({ type: S.literal("b") }, { additionalProperties: true }),
    ),
  );
  assertOk(v({ type: "a", x: 1 }));
  const e = assertErr(v({ type: "a", x: 1, y: 2 }));
  assert.equal(e.path, "y");
  assertOk(v({ type: "b", anything: 1 }));
});

test("additionalProperties — wide objects", () => {
  const props: Record<string, S.IntegerSchema> = {};
  const value: Record<string, number> = {};
  for (let i = 0; i < 40; i++) {
    props["k" + i] = S.integer();
    value["k" + i] = i;
  }
  const v = validate(S.object(props));
  assertOk(v(value));
  assert.equal(assertErr(v({ ...value, k40: 1 })).path, "k40");
});

// ---------------------------------------------------------------------------
// Own-property semantics
// ---------------------------------------------------------------------------

test("own properties — keys that exist on Object.prototype", () => {
  const v = validate(
    S.object({
      constructor: S.optional(S.string()),
      toString: S.optional(S.number()),
      hasOwnProperty: S.optional(S.boolean()),
    }),
  );
  assertOk(v({}));
  assertOk(v(JSON.parse("{}")));
  assertOk(v({ constructor: "c", toString: 1, hasOwnProperty: true }));
  assertErr(v({ constructor: 1 }));
  const req = validate(S.object({ constructor: S.string() }));
  assert.equal(assertErr(req({})).path, "constructor");
});

test("own properties — declared __proto__ key", () => {
  const v = validate(S.object({ ["__proto__"]: S.optional(S.string()), a: S.number() }));
  assertOk(v({ a: 1 }));
  assertOk(v(JSON.parse('{"__proto__":"x","a":1}')));
  assertErr(v(JSON.parse('{"__proto__":5,"a":1}')));
  const req = validate(S.object({ ["__proto__"]: S.string() }));
  assertErr(req({}));
  assertOk(req(JSON.parse('{"__proto__":"x"}')));
});

test("own properties — inherited values never satisfy a property", () => {
  const v = validate(S.object({ name: S.string() }));
  assertErr(v(Object.create({ name: "x" })));
  class WithGetter {
    get name(): string {
      return "x";
    }
  }
  assertErr(v(new WithGetter()));
  class WithField {
    name = "x";
  }
  assertOk(v(new WithField()));
  const nullProto = Object.create(null) as Record<string, unknown>;
  nullProto.name = "x";
  assertOk(v(nullProto));
  const disc = validate(S.union(S.object({ t: S.literal("a") }), S.object({ t: S.literal("b") })));
  assertErr(disc(Object.create({ t: "a" })));
  const own = Object.create({ inherited: 1 }) as Record<string, unknown>;
  own.t = "a";
  assertOk(disc(own));
  // An own __proto__ data property (from JSON.parse) disables the fast read path
  const j = validate(S.object({ name: S.string() }, { additionalProperties: true }));
  assertOk(j(JSON.parse('{"__proto__":{"name":1},"name":"x"}')));
  assertErr(j(JSON.parse('{"__proto__":{"name":"x"}}')));
});

test("own properties — only proto-colliding keys skip the prototype flag", () => {
  const v = validate(S.object({ toString: S.string() }));
  assertOk(v({ toString: "x" }));
  assertErr(v({}));
  const disc = validate(
    S.union(S.object({ constructor: S.literal("a") }), S.object({ constructor: S.literal("b") })),
  );
  assertOk(disc({ constructor: "a" }));
  assertErr(disc({}));
});

test("hoisting — each property is read exactly once", () => {
  let reads = 0;
  const o = {};
  Object.defineProperty(o, "a", {
    enumerable: true,
    get() {
      reads++;
      return reads === 1 ? 5 : "changed";
    },
  });
  const v = validate(S.object({ a: S.integer({ minimum: 0, maximum: 10, multipleOf: 5 }) }));
  assertOk(v(o));
  assert.equal(reads, 1);
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

test("string format — prototype member names are unknown formats, never lookups", () => {
  for (const format of ["constructor", "toString", "__proto__", "hasOwnProperty", "hostname"]) {
    const v = validate(S.string({ format: format as "email" }));
    assertOk(v("hello"));
    assertErr(v(1));
    const u = validate(S.union(S.string({ format: format as "email" }), S.null_()));
    assertOk(u("hello"));
  }
});

// ---------------------------------------------------------------------------
// Non-finite and special numeric values in literals / enums / discriminants
// ---------------------------------------------------------------------------

test("literal / enum — Infinity, -Infinity, NaN, -0 are matched exactly", () => {
  const inf = validate(S.enum_(Infinity, "x"));
  assertOk(inf(Infinity));
  assertErr(inf(null));
  assert.equal(assertErr(inf(1)).expected, 'enum(Infinity,"x")');
  const nan = validate(S.enum_(NaN, 1));
  assertOk(nan(NaN));
  assertErr(nan(null));
  const bigNan = validate(S.enum_(NaN, 1, 2, 3, 4, 5, 6, 7, 8));
  assertOk(bigNan(NaN));
  assertErr(bigNan(null));
  const litNan = validate(S.literal(NaN));
  assertOk(litNan(NaN));
  assert.equal(assertErr(litNan(0)).expected, "literal(NaN)");
  const litNegInf = validate(S.literal(-Infinity));
  assertOk(litNegInf(-Infinity));
  assertErr(litNegInf(null));
  const zero = validate(S.literal(0));
  assertOk(zero(-0));
  const negZero = validate(S.literal(-0));
  assertOk(negZero(0));
  const u = validate(S.union(S.enum_(-Infinity, "a"), S.literal(NaN), S.string()));
  assertErr(u(null));
  assertOk(u(-Infinity));
  assertOk(u(NaN));
});

test("discriminated union — Infinity tag; NaN tag falls back to untagged union", () => {
  const u = validate(
    S.union(S.object({ k: S.literal(Infinity), a: S.number() }), S.object({ k: S.literal(1) })),
  );
  assertOk(u({ k: Infinity, a: 1 }));
  assertErr(u({ k: null, a: 1 }));
  const e = assertErr(u({ k: 2 }));
  assert.equal(e.expected, "one of: Infinity, 1");
  const n = validate(
    S.union(S.object({ k: S.literal(NaN), a: S.number() }), S.object({ k: S.literal(1) })),
  );
  assertOk(n({ k: NaN, a: 1 }));
  assertOk(n({ k: 1 }));
  assertErr(n({ k: null, a: 1 }));
});

// ---------------------------------------------------------------------------
// multipleOf
// ---------------------------------------------------------------------------

test("multipleOf — relative tolerance for fractional divisors", () => {
  const tiny = validate(S.number({ multipleOf: 1e-10 }));
  assertErr(tiny(1.5e-10));
  assertErr(tiny(3.7e-11));
  assertOk(tiny(3e-10));
  const tenth = validate(S.number({ multipleOf: 0.1 }));
  assertOk(tenth(0.3));
  assertOk(tenth(0.1 + 0.2));
  assertOk(tenth(123456789.1));
  assertOk(tenth(-0.7));
  assertOk(tenth(0));
  assertErr(tenth(0.35));
  assertErr(tenth(50000000.05));
  const neg = validate(S.number({ multipleOf: -0.5 }));
  assertOk(neg(1.5));
  assertErr(neg(1.25));
});

// ---------------------------------------------------------------------------
// Standard formats (JSON Schema 2020-12 names)
// ---------------------------------------------------------------------------

test("string format: date / date-time / time / ipv4 / ipv6 are enforced", () => {
  const cases: [S.StringConstraints["format"], string, string][] = [
    ["date", "2024-02-29", "tomorrow"],
    ["date", "2024-02-29", "2023-02-29"],
    ["date-time", "2024-02-29T12:00:00Z", "2024-02-29 12:00:00Z"],
    ["time", "12:00:00+01:00", "12:00"],
    ["ipv4", "10.0.0.1", "10.0.0.256"],
    ["ipv6", "::ffff:10.0.0.1", "1::2::3"],
    ["email", '"joe bloggs"@example.com', "te..st@example.com"],
    ["uri", "mailto:joe@example.com", "https://example.com/a b"],
  ];
  for (const [format, good, bad] of cases) {
    const v = validate(S.string({ format }));
    assertOk(v(good));
    const e = assertErr(v(bad));
    assert.equal(e.expected, `string(format=${format})`);
    assert.equal(e.received, bad);
  }
});

test("string format: enforced inside unions, oneOf, not, conditional and allOf", () => {
  const date = S.string({ format: "date" });
  assertErr(validate(S.union(date, S.number()))("tomorrow"));
  assertOk(validate(S.union(date, S.number()))("2024-01-01"));
  assertErr(validate(S.union(S.number(), date))("tomorrow"));
  assertOk(validate(S.not(date))("tomorrow"));
  assertErr(validate(S.not(date))("2024-01-01"));
  assertErr(validate(S.oneOf(date, S.number()))("tomorrow"));
  assertErr(validate(S.allOf(date, S.string()))("tomorrow"));
  assertErr(validate(S.conditional(S.string(), date))("tomorrow"));
  assertErr(validate(S.union(S.nullable(date), S.number()))("tomorrow"));
  assertErr(validate(S.object({ d: S.optional(date) }))({ d: "tomorrow" }));
});

// ---------------------------------------------------------------------------
// allErrors — collect every failure
// ---------------------------------------------------------------------------

function errorsOf(r: readonly [boolean, unknown]): SchemaError[] {
  assert.equal(r[0], false, "expected Err");
  assert.ok(Array.isArray(r[1]));
  return r[1] as SchemaError[];
}

const paths = (r: readonly [boolean, unknown]): string[] => errorsOf(r).map((e) => e.path);

test("allErrors: N bad fields → N errors with their paths", () => {
  const s = S.object({
    id: S.integer({ minimum: 1 }),
    name: S.string(),
    born: S.string({ format: "date" }),
    tags: S.array(S.string()),
    pos: S.tuple(S.number(), S.number()),
    meta: S.record(S.boolean()),
    deep: S.object({ a: S.object({ b: S.literal(1) }) }),
    opt: S.optional(S.number()),
  });
  const v = validate(s, { allErrors: true });
  const r = v({
    id: 0,
    name: 1,
    born: "tomorrow",
    tags: ["a", 1, "b", false],
    pos: [1, "x"],
    meta: { a: true, b: 1, c: "x" },
    deep: { a: { b: 2 } },
    opt: "x",
  });
  assert.deepEqual(paths(r), [
    "id",
    "name",
    "born",
    "tags.1",
    "tags.3",
    "pos.1",
    "meta.b",
    "meta.c",
    "deep.a.b",
    "opt",
  ]);
  const errors = errorsOf(r);
  assert.deepEqual(errors[0], { path: "id", expected: "integer(>=1)", received: 0 });
  assert.deepEqual(errors[2], {
    path: "born",
    expected: "string(format=date)",
    received: "tomorrow",
  });
});

test("allErrors: success returns the input itself; default signature unchanged", () => {
  const s = S.object({ a: S.string() });
  const input = { a: "x" };
  const r = validate(s, { allErrors: true })(input);
  assert.equal(r[0], true);
  assert.equal(r[1], input);
  // allErrors: false is the default first-error mode, byte for byte
  assert.equal(validate(s, { allErrors: false }).toString(), validate(s).toString());
  assert.equal(validate(s, {}).toString(), validate(s).toString());
  const e = assertErr(validate(s, { allErrors: false })({ a: 1 }));
  assert.equal(e.path, "a");
});

test("allErrors: a value whose type check failed is not descended into", () => {
  const v = validate(
    S.object({ o: S.object({ a: S.string(), b: S.string() }), l: S.array(S.number()) }),
    {
      allErrors: true,
    },
  );
  assert.deepEqual(errorsOf(v({ o: 5, l: "x" })), [
    { path: "o", expected: "object", received: 5 },
    { path: "l", expected: "array", received: "x" },
  ]);
  assert.deepEqual(errorsOf(v(null)), [{ path: "", expected: "object", received: null }]);
  // Tuple length is part of its type check
  assert.deepEqual(paths(validate(S.tuple(S.string()), { allErrors: true })([1, 2])), [""]);
});

test("allErrors: every constraint of one value reports, and elements still do", () => {
  const str = validate(S.string({ minLength: 5, pattern: "^a", format: "email" }), {
    allErrors: true,
  });
  assert.deepEqual(
    errorsOf(str("bc")).map((e) => e.expected),
    ["string(minLength=5)", "string(pattern=^a)", "string(format=email)"],
  );
  const num = validate(S.number({ minimum: 10, multipleOf: 3, maximum: 0 }), { allErrors: true });
  assert.equal(errorsOf(num(5)).length, 3);
  const frac = validate(S.number({ multipleOf: 0.5, exclusiveMaximum: 0, exclusiveMinimum: 9 }), {
    allErrors: true,
  });
  assert.equal(errorsOf(frac(0.3)).length, 3);
  const arr = validate(S.array(S.boolean(), { minItems: 4, maxItems: 1 }), { allErrors: true });
  assert.deepEqual(paths(arr([1, true, 2])), ["", "", "0", "2"]);
});

test("allErrors: every undeclared key is reported", () => {
  const v = validate(S.object({ a: S.string(), b: S.optional(S.number()) }), { allErrors: true });
  assert.deepEqual(errorsOf(v({ a: 1, x: 1, y: 2 })), [
    { path: "a", expected: "string", received: 1 },
    { path: "x", expected: "no additional properties", received: 1 },
    { path: "y", expected: "no additional properties", received: 2 },
  ]);
  // Optional set to undefined + inherited enumerables take the slow path but are no extras
  const proto = { inherited: 1 };
  const o = Object.assign(Object.create(proto) as object, { a: "x", b: undefined });
  assert.equal(v(o)[0], true);
  assert.deepEqual(
    paths(validate(S.object({ n: S.object({}) }), { allErrors: true })({ n: { z: 1 } })),
    ["n.z"],
  );
});

test("allErrors: untagged unions and oneOf report a single error; conditional collects", () => {
  const variant = S.object({ a: S.string(), b: S.string() });
  const u = validate(S.object({ u: S.union(S.number(), variant) }), { allErrors: true });
  assert.deepEqual(errorsOf(u({ u: { a: 1, b: 2 } })), [
    { path: "u.a", expected: "string", received: 1 },
  ]);
  const arr = validate(S.union(S.number(), S.array(S.string())), { allErrors: true });
  assert.deepEqual(paths(arr([1, 2])), ["0"]);
  const one = validate(
    S.oneOf(S.string({ minLength: 1 }), S.object({ a: S.string(), b: S.string() })),
    {
      allErrors: true,
    },
  );
  assert.deepEqual(paths(one({ a: 1, b: 2 })), ["a"]);
  const both = validate(S.oneOf(S.string(), S.string({ minLength: 1 })), { allErrors: true });
  assert.deepEqual(errorsOf(both("x")), [
    { path: "", expected: "oneOf(exactly one, matched 2)", received: "x" },
  ]);
  const cond = validate(
    S.conditional(S.object({}, { additionalProperties: true }), variant, S.string()),
    {
      allErrors: true,
    },
  );
  // The branch is chosen by `if`, so it collects like a plain value
  assert.deepEqual(paths(cond({ a: 1, b: 2, c: 3 })), ["a", "b", "c"]);
  assert.deepEqual(paths(cond(1)), [""]);
  const none = validate(S.object({ n: S.union(), o: S.oneOf() }), { allErrors: true });
  assert.deepEqual(
    errorsOf(none({ n: 1, o: 2 })).map((e) => e.expected),
    ["never", "never"],
  );
  const notS = validate(S.object({ x: S.not(S.string()), y: S.unknown() }), { allErrors: true });
  assert.deepEqual(paths(notS({ x: "s" })), ["x", "y"]);
});

test("allErrors: discriminated unions report the matched variant's errors", () => {
  const ev = S.union(
    S.object({ type: S.literal("click"), x: S.number(), y: S.number() }),
    S.object({ type: S.literal("key"), code: S.string() }),
  );
  const v = validate(S.array(ev), { allErrors: true });
  assert.deepEqual(paths(v([{ type: "click", x: "1", y: "2", z: 0 }, { type: "nope" }, 5])), [
    "0.x",
    "0.y",
    "0.z",
    "1.type",
    "2",
  ]);
});

test("allErrors: allOf checks every variant at the same value", () => {
  const v = validate(
    S.allOf(
      S.object({ a: S.string() }, { additionalProperties: true }),
      S.object({ b: S.string() }, { additionalProperties: true }),
    ),
    { allErrors: true },
  );
  assert.deepEqual(paths(v({ a: 1, b: 2 })), ["a", "b"]);
  // A failed type check at the allOf's own value stops the remaining variants
  assert.deepEqual(paths(v(3)), [""]);
});

test("allErrors: errors[0] equals the first-error result", () => {
  const s = S.object({
    a: S.union(S.string(), S.object({ q: S.number() })),
    b: S.array(S.integer({ maximum: 2 }), { maxItems: 1 }),
    c: S.enum_("x", "y"),
  });
  const first = validate(s);
  const all = validate(s, { allErrors: true });
  for (const value of [
    { a: {}, b: [3], c: "z" },
    { a: "s", b: [1, 9], c: "x" },
    { a: "s", b: [], c: "q" },
  ]) {
    const e = assertErr(first(value));
    assert.deepEqual(errorsOf(all(value))[0], e);
  }
});

test("allErrors does not leak into schema/JSON parse or boolean sub-validators", () => {
  const s = S.object({ a: S.union(S.number(), S.object({ b: S.string() })) });
  validate(s, { allErrors: true });
  assert.equal(validate(s).toString().includes("_es"), false);
  assert.equal(jsonParse(s).toString().includes("_es"), false);
  assert.deepEqual(jsonParse(s)('{"a":{"b":1}}')[1], {
    path: "a.b",
    expected: "string",
    received: 1,
  });
});

test("allErrors: an extra key is reported even when a required key is missing", () => {
  const v = validate(S.object({ name: S.string() }), { allErrors: true });
  assert.deepEqual(paths(v({ nmae: "x" })), ["name", "nmae"]);
  const d = validate(
    S.union(
      S.object({ type: S.literal("a"), x: S.number() }),
      S.object({ type: S.literal("b"), y: S.number() }),
    ),
    { allErrors: true },
  );
  assert.deepEqual(paths(d({ type: "a", z: 1 })), ["x", "z"]);
});

test("allErrors: untyped JSON Schema keyword groups report every field", () => {
  const r = S.fromJsonSchema({
    properties: { a: { type: "string" }, b: { type: "integer" } },
    required: ["a", "b"],
    additionalProperties: false,
  });
  assert.ok(r[0]);
  const v = validate(r[1] as S.StringSchema, { allErrors: true }) as (
    x: unknown,
  ) => readonly [boolean, unknown];
  assert.deepEqual(paths(v({ a: 1, b: "x", c: 0 })), ["a", "b", "c"]);
});
