import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";

// ---------------------------------------------------------------------------
// Builder smoke tests — verify each builder returns correct { kind, meta }
// ---------------------------------------------------------------------------

test("string() returns StringSchema", () => {
  const s = S.string();
  assert.equal(s.kind, "string");
  assert.equal(s.meta, undefined);
});

test("string() with constraints", () => {
  const s = S.string({ minLength: 1, maxLength: 10, pattern: "^a" });
  assert.equal(s.kind, "string");
  assert.equal(s.meta?.minLength, 1);
  assert.equal(s.meta?.maxLength, 10);
  assert.equal(s.meta?.pattern, "^a");
});

test("string() with format", () => {
  const s = S.string({ format: "email" });
  assert.equal(s.meta?.format, "email");
});

test("number() returns NumberSchema", () => {
  const s = S.number();
  assert.equal(s.kind, "number");
  assert.equal(s.meta, undefined);
});

test("number() with constraints", () => {
  const s = S.number({ minimum: 0, maximum: 100, multipleOf: 5 });
  assert.equal(s.meta?.minimum, 0);
  assert.equal(s.meta?.maximum, 100);
  assert.equal(s.meta?.multipleOf, 5);
});

test("number() with exclusive constraints", () => {
  const s = S.number({ exclusiveMinimum: 0, exclusiveMaximum: 100 });
  assert.equal(s.meta?.exclusiveMinimum, 0);
  assert.equal(s.meta?.exclusiveMaximum, 100);
});

test("integer() returns IntegerSchema", () => {
  const s = S.integer();
  assert.equal(s.kind, "integer");
  assert.equal(s.meta, undefined);
});

test("integer() with constraints", () => {
  const s = S.integer({ minimum: 1, maximum: 99 });
  assert.equal(s.meta?.minimum, 1);
  assert.equal(s.meta?.maximum, 99);
});

test("boolean() returns BooleanSchema", () => {
  const s = S.boolean();
  assert.equal(s.kind, "boolean");
  assert.equal(s.meta, undefined);
});

test("null_() returns NullSchema", () => {
  const s = S.null_();
  assert.equal(s.kind, "null");
  assert.equal(s.meta, undefined);
});

test("literal() with string", () => {
  const s = S.literal("hello");
  assert.equal(s.kind, "literal");
  assert.equal(s.meta.value, "hello");
});

test("literal() with number", () => {
  const s = S.literal(42);
  assert.equal(s.meta.value, 42);
});

test("literal() with boolean", () => {
  const s = S.literal(true);
  assert.equal(s.meta.value, true);
});

test("literal() with null", () => {
  const s = S.literal(null);
  assert.equal(s.meta.value, null);
});

test("enum_() with strings", () => {
  const s = S.enum_("a", "b", "c");
  assert.equal(s.kind, "enum");
  assert.deepEqual(s.meta.values, ["a", "b", "c"]);
});

test("enum_() with numbers", () => {
  const s = S.enum_(1, 2, 3);
  assert.deepEqual(s.meta.values, [1, 2, 3]);
});

test("enum_() with mixed", () => {
  const s = S.enum_("a", 1);
  assert.deepEqual(s.meta.values, ["a", 1]);
});

test("object() returns ObjectSchema with properties", () => {
  const s = S.object({ name: S.string(), age: S.integer() });
  assert.equal(s.kind, "object");
  assert.equal(s.meta.properties.name.kind, "string");
  assert.equal(s.meta.properties.age.kind, "integer");
  assert.equal(s.meta.additionalProperties, false);
});

test("object() with additionalProperties: true", () => {
  const s = S.object({ name: S.string() }, { additionalProperties: true });
  assert.equal(s.meta.additionalProperties, true);
});

test("object() with empty opts defaults additionalProperties to false", () => {
  const s = S.object({ name: S.string() }, {});
  assert.equal(s.meta.additionalProperties, false);
});

test("array() returns ArraySchema", () => {
  const s = S.array(S.string());
  assert.equal(s.kind, "array");
  assert.equal(s.meta.items.kind, "string");
  assert.equal(s.meta.minItems, undefined);
  assert.equal(s.meta.maxItems, undefined);
});

test("array() with size constraints", () => {
  const s = S.array(S.integer(), { minItems: 1, maxItems: 10 });
  assert.equal(s.meta.minItems, 1);
  assert.equal(s.meta.maxItems, 10);
});

test("array() with empty opts leaves minItems and maxItems undefined", () => {
  const s = S.array(S.string(), {});
  assert.equal(s.meta.minItems, undefined);
  assert.equal(s.meta.maxItems, undefined);
});

test("tuple() returns TupleSchema", () => {
  const s = S.tuple(S.string(), S.integer(), S.boolean());
  assert.equal(s.kind, "tuple");
  assert.equal(s.meta.items.length, 3);
  assert.equal(s.meta.items[0].kind, "string");
  assert.equal(s.meta.items[1].kind, "integer");
  assert.equal(s.meta.items[2].kind, "boolean");
});

test("record() returns RecordSchema", () => {
  const s = S.record(S.number());
  assert.equal(s.kind, "record");
  assert.equal(s.meta.values.kind, "number");
});

test("union() returns UnionSchema", () => {
  const s = S.union(S.string(), S.number());
  assert.equal(s.kind, "union");
  assert.equal(s.meta.variants.length, 2);
});

test("optional() returns OptionalSchema", () => {
  const s = S.optional(S.string());
  assert.equal(s.kind, "optional");
  assert.equal(s.meta.inner.kind, "string");
});

test("nullable() returns NullableSchema", () => {
  const s = S.nullable(S.string());
  assert.equal(s.kind, "nullable");
  assert.equal(s.meta.inner.kind, "string");
});

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

test("deeply nested schema", () => {
  const s = S.object({
    user: S.object({
      name: S.string(),
      tags: S.array(S.string()),
    }),
    scores: S.array(S.tuple(S.string(), S.number())),
  });
  assert.equal(s.meta.properties.user.kind, "object");
  assert.equal(s.meta.properties.scores.kind, "array");
});

// ---------------------------------------------------------------------------
// Type inference — compile-time tests
// ---------------------------------------------------------------------------

test("Infer — compile-time type checks", () => {
  const UserSchema = S.object({
    id: S.integer(),
    name: S.string(),
    email: S.optional(S.string()),
    active: S.boolean(),
    tags: S.array(S.string()),
    role: S.enum_("admin", "user"),
    metadata: S.nullable(S.object({ key: S.string() })),
  });
  type User = S.Infer<typeof UserSchema>;

  // This block only verifies type inference — no runtime assertions.
  // If the types are wrong, TypeScript will error at compile time.
  const _user: User = {
    id: 1,
    name: "test",
    active: true,
    tags: ["a"],
    role: "admin",
    metadata: { key: "v" },
  };
  // Optional field can be omitted
  void _user;

  // @ts-expect-error — role must be "admin" | "user"
  const _bad: User = { id: 1, name: "", active: true, tags: [], role: "unknown", metadata: null };
  void _bad;
});

test("Infer — tuple inference", () => {
  const s = S.tuple(S.string(), S.number(), S.boolean());
  type T = S.Infer<typeof s>;
  const _v: T = ["hello", 42, true];
  void _v;

  // @ts-expect-error — wrong tuple element type
  const _bad: T = [42, "hello", true];
  void _bad;
});

test("Infer — union inference", () => {
  const s = S.union(S.string(), S.number());
  type T = S.Infer<typeof s>;
  const _a: T = "hello";
  const _b: T = 42;
  void _a;
  void _b;

  // @ts-expect-error — boolean is not in the union
  const _bad: T = true;
  void _bad;
});

test("Infer — literal inference", () => {
  const s = S.literal("hello");
  type T = S.Infer<typeof s>;
  const _v: T = "hello";
  void _v;

  // @ts-expect-error — wrong literal value
  const _bad: T = "world";
  void _bad;
});

test("Infer — nullable inference", () => {
  const s = S.nullable(S.string());
  type T = S.Infer<typeof s>;
  const _a: T = "hello";
  const _b: T = null;
  void _a;
  void _b;

  // @ts-expect-error — undefined is not null
  const _bad: T = undefined;
  void _bad;
});

test("Infer — record inference", () => {
  const s = S.record(S.number());
  type T = S.Infer<typeof s>;
  const _v: T = { a: 1, b: 2 };
  void _v;
});

// ---------------------------------------------------------------------------
// toJsonSchema
// ---------------------------------------------------------------------------

test("toJsonSchema — string", () => {
  assert.deepEqual(S.toJsonSchema(S.string()), { type: "string" });
});

test("toJsonSchema — string with constraints", () => {
  assert.deepEqual(S.toJsonSchema(S.string({ minLength: 1, maxLength: 10, pattern: "^a" })), {
    type: "string",
    minLength: 1,
    maxLength: 10,
    pattern: "^a",
  });
});

test("toJsonSchema — string with format", () => {
  assert.deepEqual(S.toJsonSchema(S.string({ format: "email" })), {
    type: "string",
    format: "email",
  });
});

test("toJsonSchema — number", () => {
  assert.deepEqual(S.toJsonSchema(S.number()), { type: "number" });
});

test("toJsonSchema — number with constraints", () => {
  assert.deepEqual(
    S.toJsonSchema(
      S.number({
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
        multipleOf: 5,
      }),
    ),
    {
      type: "number",
      minimum: 0,
      maximum: 100,
      exclusiveMinimum: -1,
      exclusiveMaximum: 101,
      multipleOf: 5,
    },
  );
});

test("toJsonSchema — integer", () => {
  assert.deepEqual(S.toJsonSchema(S.integer()), { type: "integer" });
});

test("toJsonSchema — integer with constraints", () => {
  assert.deepEqual(S.toJsonSchema(S.integer({ minimum: 1 })), { type: "integer", minimum: 1 });
});

test("toJsonSchema — boolean", () => {
  assert.deepEqual(S.toJsonSchema(S.boolean()), { type: "boolean" });
});

test("toJsonSchema — null", () => {
  assert.deepEqual(S.toJsonSchema(S.null_()), { type: "null" });
});

test("toJsonSchema — literal string", () => {
  assert.deepEqual(S.toJsonSchema(S.literal("hello")), { const: "hello" });
});

test("toJsonSchema — literal number", () => {
  assert.deepEqual(S.toJsonSchema(S.literal(42)), { const: 42 });
});

test("toJsonSchema — literal boolean", () => {
  assert.deepEqual(S.toJsonSchema(S.literal(true)), { const: true });
});

test("toJsonSchema — literal null", () => {
  assert.deepEqual(S.toJsonSchema(S.literal(null)), { const: null });
});

test("toJsonSchema — enum", () => {
  assert.deepEqual(S.toJsonSchema(S.enum_("a", "b", 1)), { enum: ["a", "b", 1] });
});

test("toJsonSchema — object with required and optional", () => {
  const s = S.object({
    name: S.string(),
    age: S.optional(S.integer()),
  });
  const js = S.toJsonSchema(s);
  assert.deepEqual(js, {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
    },
    required: ["name"],
    additionalProperties: false,
  });
});

test("toJsonSchema — object all required", () => {
  const s = S.object({ a: S.string(), b: S.number() });
  const js = S.toJsonSchema(s);
  assert.deepEqual((js as Record<string, unknown>).required, ["a", "b"]);
});

test("toJsonSchema — object all optional", () => {
  const s = S.object({ a: S.optional(S.string()) });
  const js = S.toJsonSchema(s);
  assert.equal("required" in js, false);
});

test("toJsonSchema — object with additionalProperties", () => {
  const s = S.object({ a: S.string() }, { additionalProperties: true });
  const js = S.toJsonSchema(s);
  assert.equal((js as Record<string, unknown>).additionalProperties, true);
});

test("toJsonSchema — array", () => {
  assert.deepEqual(S.toJsonSchema(S.array(S.string())), {
    type: "array",
    items: { type: "string" },
  });
});

test("toJsonSchema — array with constraints", () => {
  assert.deepEqual(S.toJsonSchema(S.array(S.string(), { minItems: 1, maxItems: 5 })), {
    type: "array",
    items: { type: "string" },
    minItems: 1,
    maxItems: 5,
  });
});

test("toJsonSchema — tuple", () => {
  assert.deepEqual(S.toJsonSchema(S.tuple(S.string(), S.number())), {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "number" }],
    items: false,
  });
});

test("toJsonSchema — record", () => {
  assert.deepEqual(S.toJsonSchema(S.record(S.number())), {
    type: "object",
    additionalProperties: { type: "number" },
  });
});

test("toJsonSchema — union", () => {
  assert.deepEqual(S.toJsonSchema(S.union(S.string(), S.number())), {
    anyOf: [{ type: "string" }, { type: "number" }],
  });
});

test("toJsonSchema — optional (top-level)", () => {
  // Top-level optional just emits the inner schema
  assert.deepEqual(S.toJsonSchema(S.optional(S.string())), { type: "string" });
});

test("toJsonSchema — nullable", () => {
  assert.deepEqual(S.toJsonSchema(S.nullable(S.string())), {
    anyOf: [{ type: "string" }, { type: "null" }],
  });
});

test("toJsonSchema — nested object", () => {
  const s = S.object({
    user: S.object({ name: S.string() }),
  });
  assert.deepEqual(S.toJsonSchema(s), {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    required: ["user"],
    additionalProperties: false,
  });
});

// ---------------------------------------------------------------------------
// fromJsonSchema
// ---------------------------------------------------------------------------

test("fromJsonSchema — string", () => {
  const r = S.fromJsonSchema({ type: "string" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "string");
});

test("fromJsonSchema — string with constraints", () => {
  const r = S.fromJsonSchema({
    type: "string",
    minLength: 1,
    maxLength: 10,
    pattern: "^a",
    format: "email",
  });
  assert.equal(r[0], true);
  const s = r[1] as S.StringSchema;
  assert.equal(s.meta?.minLength, 1);
  assert.equal(s.meta?.maxLength, 10);
  assert.equal(s.meta?.pattern, "^a");
  assert.equal(s.meta?.format, "email");
});

test("fromJsonSchema — number", () => {
  const r = S.fromJsonSchema({ type: "number" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "number");
});

test("fromJsonSchema — number with constraints", () => {
  const r = S.fromJsonSchema({
    type: "number",
    minimum: 0,
    maximum: 100,
    exclusiveMinimum: -1,
    exclusiveMaximum: 101,
    multipleOf: 5,
  });
  assert.equal(r[0], true);
  const s = r[1] as S.NumberSchema;
  assert.equal(s.meta?.minimum, 0);
  assert.equal(s.meta?.maximum, 100);
  assert.equal(s.meta?.exclusiveMinimum, -1);
  assert.equal(s.meta?.exclusiveMaximum, 101);
  assert.equal(s.meta?.multipleOf, 5);
});

test("fromJsonSchema — integer", () => {
  const r = S.fromJsonSchema({ type: "integer" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "integer");
});

test("fromJsonSchema — boolean", () => {
  const r = S.fromJsonSchema({ type: "boolean" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "boolean");
});

test("fromJsonSchema — null", () => {
  const r = S.fromJsonSchema({ type: "null" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "null");
});

test("fromJsonSchema — const string", () => {
  const r = S.fromJsonSchema({ const: "hello" });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "literal");
  assert.equal((r[1] as S.LiteralSchema<string>).meta.value, "hello");
});

test("fromJsonSchema — const number", () => {
  const r = S.fromJsonSchema({ const: 42 });
  assert.equal(r[0], true);
  assert.equal((r[1] as S.LiteralSchema<number>).meta.value, 42);
});

test("fromJsonSchema — const boolean", () => {
  const r = S.fromJsonSchema({ const: true });
  assert.equal(r[0], true);
  assert.equal((r[1] as S.LiteralSchema<boolean>).meta.value, true);
});

test("fromJsonSchema — const null", () => {
  const r = S.fromJsonSchema({ const: null });
  assert.equal(r[0], true);
  assert.equal((r[1] as S.LiteralSchema<null>).meta.value, null);
});

test("fromJsonSchema — const unsupported type", () => {
  const r = S.fromJsonSchema({ const: [1, 2] });
  assert.equal(r[0], false);
});

test("fromJsonSchema — enum", () => {
  const r = S.fromJsonSchema({ enum: ["a", "b", 1] });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "enum");
  assert.deepEqual((r[1] as S.EnumSchema<readonly (string | number)[]>).meta.values, ["a", "b", 1]);
});

test("fromJsonSchema — enum with invalid values", () => {
  const r = S.fromJsonSchema({ enum: [true] });
  assert.equal(r[0], false);
});

test("fromJsonSchema — object with required", () => {
  const r = S.fromJsonSchema({
    type: "object",
    properties: { name: { type: "string" }, age: { type: "integer" } },
    required: ["name"],
    additionalProperties: false,
  });
  assert.equal(r[0], true);
  const s = r[1] as S.ObjectSchema<Record<string, S.Schema>>;
  assert.equal(s.kind, "object");
  assert.equal(s.meta.properties.name.kind, "string");
  // age is not in required → wrapped in optional
  assert.equal(s.meta.properties.age.kind, "optional");
  assert.equal(s.meta.additionalProperties, false);
});

test("fromJsonSchema — object without properties", () => {
  const r = S.fromJsonSchema({ type: "object", properties: {} });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "object");
});

test("fromJsonSchema — object with no properties key (defaults to empty)", () => {
  // Covers the js.properties ?? {} branch: when no "properties" key is present
  // and additionalProperties is not a schema object (e.g. boolean true).
  const r = S.fromJsonSchema({ type: "object", additionalProperties: true });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "object");
  const s = r[1] as S.ObjectSchema<Record<string, S.Schema>>;
  assert.equal(Object.keys(s.meta.properties).length, 0);
  assert.equal(s.meta.additionalProperties, true);
});

test("fromJsonSchema — object with default additionalProperties", () => {
  const r = S.fromJsonSchema({ type: "object", properties: {} });
  assert.equal(r[0], true);
  const s = r[1] as S.ObjectSchema<Record<string, S.Schema>>;
  // When additionalProperties is not specified, defaults to true (JSON Schema default)
  assert.equal(s.meta.additionalProperties, true);
});

test("fromJsonSchema — record (additionalProperties as schema)", () => {
  const r = S.fromJsonSchema({ type: "object", additionalProperties: { type: "number" } });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "record");
  assert.equal((r[1] as S.RecordSchema<S.Schema>).meta.values.kind, "number");
});

test("fromJsonSchema — array with items", () => {
  const r = S.fromJsonSchema({ type: "array", items: { type: "string" } });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "array");
  assert.equal((r[1] as S.ArraySchema<S.Schema>).meta.items.kind, "string");
});

test("fromJsonSchema — array with size constraints", () => {
  const r = S.fromJsonSchema({
    type: "array",
    items: { type: "string" },
    minItems: 1,
    maxItems: 5,
  });
  assert.equal(r[0], true);
  const s = r[1] as S.ArraySchema<S.Schema>;
  assert.equal(s.meta.minItems, 1);
  assert.equal(s.meta.maxItems, 5);
});

test("fromJsonSchema — array without items", () => {
  const r = S.fromJsonSchema({ type: "array" });
  assert.equal(r[0], false);
});

test("fromJsonSchema — tuple (prefixItems)", () => {
  const r = S.fromJsonSchema({
    type: "array",
    prefixItems: [{ type: "string" }, { type: "number" }],
    items: false,
  });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "tuple");
  const t = r[1] as S.TupleSchema<readonly S.Schema[]>;
  assert.equal(t.meta.items.length, 2);
  assert.equal(t.meta.items[0].kind, "string");
  assert.equal(t.meta.items[1].kind, "number");
});

test("fromJsonSchema — anyOf (union)", () => {
  const r = S.fromJsonSchema({ anyOf: [{ type: "string" }, { type: "number" }] });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "union");
});

test("fromJsonSchema — nullable pattern (anyOf with null)", () => {
  const r = S.fromJsonSchema({ anyOf: [{ type: "string" }, { type: "null" }] });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "nullable");
  assert.equal((r[1] as S.NullableSchema<S.Schema>).meta.inner.kind, "string");
});

test("fromJsonSchema — $ref rejected", () => {
  const r = S.fromJsonSchema({ $ref: "#/definitions/Foo" });
  assert.equal(r[0], false);
});

test("fromJsonSchema — allOf rejected", () => {
  const r = S.fromJsonSchema({ allOf: [{ type: "string" }] });
  assert.equal(r[0], false);
});

test("fromJsonSchema — oneOf rejected", () => {
  const r = S.fromJsonSchema({ oneOf: [{ type: "string" }] });
  assert.equal(r[0], false);
});

test("fromJsonSchema — not rejected", () => {
  const r = S.fromJsonSchema({ not: { type: "string" } });
  assert.equal(r[0], false);
});

test("fromJsonSchema — if/then/else rejected", () => {
  // eslint-disable-next-line unicorn/no-thenable
  const r = S.fromJsonSchema({ if: { type: "string" }, then: { type: "number" } });
  assert.equal(r[0], false);
});

test("fromJsonSchema — unknown schema", () => {
  const r = S.fromJsonSchema({ foo: "bar" });
  assert.equal(r[0], false);
});

// ---------------------------------------------------------------------------
// Round-trip: toJsonSchema → fromJsonSchema
// ---------------------------------------------------------------------------

test("round-trip — string", () => {
  const s = S.string({ minLength: 1 });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "string");
  assert.equal((r[1] as S.StringSchema).meta?.minLength, 1);
});

test("round-trip — number", () => {
  const s = S.number({ minimum: 0 });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "number");
  assert.equal((r[1] as S.NumberSchema).meta?.minimum, 0);
});

test("round-trip — integer", () => {
  const s = S.integer({ maximum: 100 });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "integer");
});

test("round-trip — boolean", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.boolean()));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "boolean");
});

test("round-trip — null", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.null_()));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "null");
});

test("round-trip — literal", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.literal("hello")));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "literal");
});

test("round-trip — enum", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.enum_("a", "b")));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "enum");
});

test("round-trip — object", () => {
  const s = S.object({ name: S.string(), age: S.optional(S.integer()) });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "object");
  const obj = r[1] as S.ObjectSchema<Record<string, S.Schema>>;
  assert.equal(obj.meta.properties.name.kind, "string");
  assert.equal(obj.meta.properties.age.kind, "optional");
});

test("round-trip — array", () => {
  const s = S.array(S.string(), { minItems: 1 });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "array");
});

test("round-trip — tuple", () => {
  const s = S.tuple(S.string(), S.number());
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "tuple");
});

test("round-trip — record", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.record(S.number())));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "record");
});

test("round-trip — union", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.union(S.string(), S.number())));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "union");
});

test("round-trip — nullable", () => {
  const r = S.fromJsonSchema(S.toJsonSchema(S.nullable(S.string())));
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "nullable");
});

test("toJsonSchema throws on unknown schema kind", () => {
  const bad = { kind: "INVALID", meta: undefined } as unknown as S.Schema;
  assert.throws(() => S.toJsonSchema(bad), /unreachable/i);
});

test("fromJsonSchema — nullable with null variant first", () => {
  // Third-party JSON Schema may put {type:"null"} first in anyOf
  const r = S.fromJsonSchema({ anyOf: [{ type: "null" }, { type: "string" }] });
  assert.equal(r[0], true);
  assert.equal(r[1].kind, "nullable");
  assert.equal(r[1].meta.inner.kind, "string");
});

// ---------------------------------------------------------------------------
// findDiscriminant — branch coverage
// ---------------------------------------------------------------------------

test("findDiscriminant — returns null when a property is not a literal (non-literal candidate)", () => {
  // Both variants are objects with key "type", but one uses string() not literal()
  const variants = [
    S.object({ type: S.literal("circle"), radius: S.number() }),
    S.object({ type: S.string(), w: S.number() }),
  ];
  assert.equal(S.findDiscriminant(variants), null);
});

test("findDiscriminant — returns null when two variants share the same discriminant value (duplicate)", () => {
  // Both use literal("circle") — not a valid discriminant
  const variants = [
    S.object({ type: S.literal("circle"), r: S.number() }),
    S.object({ type: S.literal("circle"), w: S.number() }),
  ];
  assert.equal(S.findDiscriminant(variants), null);
});

test("findDiscriminant — returns null when a candidate key is absent in one variant", () => {
  // Second variant lacks "type"
  const variants = [
    S.object({ type: S.literal("circle"), r: S.number() }),
    S.object({ w: S.number() }),
  ];
  assert.equal(S.findDiscriminant(variants), null);
});
