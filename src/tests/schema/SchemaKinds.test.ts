/**
 * unknown / allOf / not / conditional / oneOf kinds across Schema, Validate,
 * JSON and TOON.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import * as ST from "../../schema/TOON.js";
import { validate as validateTyped, type SchemaError } from "../../schema/Validate.js";
import type { Result } from "../../Result.js";

type Check = (v: unknown) => Result<unknown, SchemaError>;
// Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
const validate = (s: S.Schema): Check => validateTyped(s as S.StringSchema) as Check;
const accepts = (s: S.Schema, v: unknown): boolean => validate(s)(v)[0];
function errorOf(s: S.Schema, v: unknown): SchemaError {
  const r = validate(s)(v);
  assert.equal(r[0], false, "expected rejection of " + JSON.stringify(v));
  return r[1] as SchemaError;
}

// ---------------------------------------------------------------------------
// Builders and type inference
// ---------------------------------------------------------------------------

test("builders produce two-property {kind, meta} nodes", () => {
  assert.deepEqual(S.unknown(), { kind: "unknown", meta: undefined });
  const a = S.allOf(S.string(), S.number());
  assert.equal(a.kind, "allOf");
  assert.equal(a.meta.variants.length, 2);
  const n = S.not(S.string());
  assert.equal(n.kind, "not");
  assert.equal(n.meta.inner.kind, "string");
  const c = S.conditional(S.number());
  assert.equal(c.kind, "conditional");
  assert.equal(c.meta.then.kind, "unknown");
  assert.equal(c.meta.else.kind, "unknown");
  const c2 = S.conditional(S.number(), S.integer(), S.string());
  assert.equal(c2.meta.then.kind, "integer");
  assert.equal(c2.meta.else.kind, "string");
  const o = S.oneOf(S.string(), S.number());
  assert.equal(o.kind, "union");
  assert.equal(o.meta.exclusive, true);
  for (const s of [S.unknown(), a, n, c, o]) assert.deepEqual(Object.keys(s), ["kind", "meta"]);
});

test("union() output is unchanged (no exclusive key)", () => {
  assert.deepEqual(Object.keys(S.union(S.string()).meta), ["variants"]);
});

test("Infer — new kinds", () => {
  const Both = S.allOf(
    S.object({ a: S.string() }, { additionalProperties: true }),
    S.object({ b: S.number() }, { additionalProperties: true }),
  );
  const both: S.Infer<typeof Both> = { a: "x", b: 1 };
  const one: S.Infer<ReturnType<typeof S.oneOf<[S.StringSchema, S.NumberSchema]>>> = 1;
  const cond: S.Infer<S.ConditionalSchema<S.NumberSchema, S.IntegerSchema, S.StringSchema>> = "s";
  const u: S.Infer<S.UnknownSchema> = { anything: true };
  const nn: S.Infer<S.NotSchema<S.StringSchema>> = 3;
  const empty: S.Infer<S.AllOfSchema<[]>> = 0;
  assert.ok(both && one && cond && u && nn !== undefined && empty === 0);
});

test("isPrimitive is false for the new kinds", () => {
  for (const s of [S.unknown(), S.allOf(S.string()), S.not(S.string()), S.conditional(S.null_())]) {
    assert.equal(S.isPrimitive(s), false);
  }
});

// ---------------------------------------------------------------------------
// toJsonSchema
// ---------------------------------------------------------------------------

test("toJsonSchema emits {}, allOf, oneOf, not, if/then/else", () => {
  assert.deepEqual(S.toJsonSchema(S.unknown()), {});
  assert.deepEqual(S.toJsonSchema(S.allOf(S.string(), S.null_())), {
    allOf: [{ type: "string" }, { type: "null" }],
  });
  assert.deepEqual(S.toJsonSchema(S.oneOf(S.string(), S.null_())), {
    oneOf: [{ type: "string" }, { type: "null" }],
  });
  assert.deepEqual(S.toJsonSchema(S.not(S.string())), { not: { type: "string" } });
  assert.deepEqual(S.toJsonSchema(S.conditional(S.number(), S.integer(), S.string())), {
    if: { type: "number" },
    // eslint-disable-next-line unicorn/no-thenable
    then: { type: "integer" },
    else: { type: "string" },
  });
  // required unknown() property stays required
  assert.deepEqual(S.toJsonSchema(S.object({ a: S.unknown() })), {
    type: "object",
    properties: { a: {} },
    required: ["a"],
    additionalProperties: false,
  });
});

test("toJsonSchema → fromJsonSchema round-trips the new kinds", () => {
  const s = S.object({
    a: S.oneOf(S.string(), S.integer()),
    b: S.optional(S.allOf(S.number({ minimum: 0 }), S.integer())),
    c: S.not(S.null_()),
    d: S.conditional(S.string(), S.string({ minLength: 2 }), S.number()),
    e: S.unknown(),
  });
  const r = S.fromJsonSchema(S.toJsonSchema(s));
  assert.equal(r[0], true);
  const back = r[1] as S.ObjectSchema<Record<string, S.Schema>>;
  assert.equal(back.meta.properties.a.kind, "union");
  assert.equal(back.meta.properties.b.kind, "optional");
  assert.equal(back.meta.properties.c.kind, "not");
  assert.equal(back.meta.properties.d.kind, "conditional");
  assert.equal(back.meta.properties.e.kind, "unknown");
  for (const v of [
    { a: "x", c: 1, d: "ab", e: null },
    { a: 1, b: 2, c: "x", d: 3, e: [] },
    { a: true, c: 1, d: "ab", e: 0 },
    { a: "x", c: null, d: "ab", e: 0 },
    { a: "x", c: 1, d: "a", e: 0 },
    { a: "x", c: 1, d: "ab" },
    { a: "x", b: 1.5, c: 1, d: "ab", e: 0 },
  ]) {
    assert.equal(accepts(back, v), accepts(s, v), JSON.stringify(v));
  }
});

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

test("unknown accepts every defined value, rejects undefined", () => {
  for (const v of [null, 0, "", [], {}, false]) assert.equal(accepts(S.unknown(), v), true);
  assert.deepEqual(errorOf(S.unknown(), undefined), {
    path: "",
    expected: "any value",
    received: undefined,
  });
  // required unknown property must be present; optional may be absent
  const s = S.object({ a: S.unknown(), b: S.optional(S.unknown()) });
  assert.equal(accepts(s, { a: null }), true);
  assert.equal(errorOf(s, { b: 1 }).path, "a");
});

test("allOf requires every variant; first failing variant reports", () => {
  const s = S.allOf(S.number({ minimum: 0 }), S.integer());
  assert.equal(accepts(s, 3), true);
  assert.equal(errorOf(s, -1).expected, "number(>=0)");
  assert.equal(errorOf(s, 1.5).expected, "integer");
  assert.equal(accepts(S.allOf(), undefined), true);
});

test("not rejects matches and undefined", () => {
  const s = S.not(S.string());
  assert.equal(accepts(s, 1), true);
  assert.deepEqual(errorOf(s, "x"), { path: "", expected: "not(string)", received: "x" });
  assert.equal(errorOf(s, undefined).expected, "not(string)");
  // inner without an exact check uses a boolean sub-validator
  const deep = S.not(S.object({ a: S.string() }));
  assert.equal(accepts(deep, { a: 1 }), true);
  assert.equal(accepts(deep, { a: "x" }), false);
});

test("conditional picks then / else by the if check", () => {
  const s = S.conditional(S.number(), S.number({ minimum: 2 }), S.string());
  assert.equal(accepts(s, 3), true);
  assert.equal(errorOf(s, 1).expected, "number(>=2)");
  assert.equal(accepts(s, "x"), true);
  assert.equal(errorOf(s, true).expected, "string");
  // non-exact if → boolean sub-validator
  const t = S.conditional(
    S.object({ k: S.literal("a") }, { additionalProperties: true }),
    S.object({ k: S.string(), n: S.number() }),
  );
  assert.equal(accepts(t, { k: "a", n: 1 }), true);
  assert.equal(accepts(t, { k: "a" }), false);
  assert.equal(accepts(t, { k: "b" }), true);
});

test("oneOf requires exactly one match", () => {
  const s = S.oneOf(S.integer(), S.number({ minimum: 2 }));
  assert.equal(accepts(s, 1), true); // integer only
  assert.equal(accepts(s, 2.5), true); // number only
  assert.deepEqual(errorOf(s, 3), {
    path: "",
    expected: "oneOf(exactly one, matched 2)",
    received: 3,
  });
  assert.equal(errorOf(s, "x").expected, "number"); // zero matches → last variant's error
  assert.equal(errorOf(S.oneOf(), 1).expected, "never");
  assert.equal(accepts(S.oneOf(S.unknown(), S.unknown()), 1), false);
  assert.equal(errorOf(S.object({ x: S.oneOf(S.string(), S.string()) }), { x: "a" }).path, "x");
});

test("nested non-exact oneOf reads each value a linear number of times", () => {
  // Each level's last variant is the previous level: re-running it in the
  // boolean sub-validators used to double the work per level (~2^depth reads).
  const depth = 16;
  let s: S.Schema = S.object({ z: S.string() });
  for (let i = 0; i < depth; i++) s = S.oneOf(S.object({ ["k" + i]: S.string() }), s);
  let reads = 0;
  const input = {};
  Object.defineProperty(input, "z", {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  assert.deepEqual(errorOf(s, input), { path: "z", expected: "string", received: 1 });
  assert.ok(reads <= depth + 2, `z read ${reads} times`);
  assert.equal(accepts(s, { z: "a" }), true);
});

test("oneOf inside a boolean sub-validator: zero and two matches both fail", () => {
  // The oneOf is a non-last union variant, so it runs as a boolean sub-validator
  const inner = S.oneOf(
    S.object({ a: S.string() }),
    S.object({ a: S.string() }, { additionalProperties: true }),
  );
  const s = S.union(inner, S.literal(0));
  assert.equal(accepts(s, { a: "x" }), false); // matched 2
  assert.equal(accepts(s, { a: "x", b: 1 }), true); // matched 1
  assert.equal(accepts(s, { a: 1 }), false); // matched 0
  assert.equal(accepts(s, 0), true);
});

test("discriminated oneOf keeps the switch path", () => {
  const s = S.oneOf(
    S.object({ t: S.literal("a"), x: S.number() }),
    S.object({ t: S.literal("b"), y: S.string() }),
  );
  assert.match(validate(s).toString(), /switch/);
  assert.equal(accepts(s, { t: "a", x: 1 }), true);
  assert.equal(accepts(s, { t: "c" }), false);
});

test("exact checks of the new kinds inside a plain union", () => {
  // every variant has an exact check → whole union is one expression
  const cases: [S.Schema, unknown, boolean][] = [
    [S.oneOf(S.string(), S.literal("a")), "a", false],
    [S.oneOf(S.string(), S.literal("a")), "b", true],
    [S.oneOf(), "b", false],
    [S.allOf(S.string(), S.literal("a")), "a", true],
    [S.allOf(S.string(), S.literal("a")), "b", false],
    [S.allOf(), "b", true],
    [S.unknown(), undefined, false],
    [S.not(S.string()), "a", false],
    [S.not(S.string()), 1, true],
    [S.not(S.string()), undefined, false],
    [S.conditional(S.string(), S.literal("a"), S.boolean()), "a", true],
    [S.conditional(S.string(), S.literal("a"), S.boolean()), "b", false],
    [S.conditional(S.string(), S.literal("a"), S.boolean()), true, true],
  ];
  for (const [s, v, want] of cases) {
    // the first union variant is tried via exactCheck; the sentinel never matches
    assert.equal(accepts(S.union(s, S.literal("\u0000sentinel")), v), want);
  }
  // non-exact inner kinds fall back to boolean sub-validators
  const sub: [S.Schema, unknown, boolean][] = [
    [S.oneOf(S.object({}), S.string()), {}, true],
    [S.allOf(S.object({}), S.unknown()), {}, true],
    [S.not(S.object({})), {}, false],
    [S.conditional(S.object({}), S.unknown()), {}, true],
    [S.conditional(S.string(), S.object({})), "x", false],
  ];
  for (const [s, v, want] of sub) assert.equal(accepts(S.union(s, S.null_()), v), want);
});

test("extra-key fast path stays exact around undefined-accepting kinds", () => {
  // conditional whose else accepts undefined: absent key + one extra key must not cancel out
  const s = S.object({
    a: S.conditional(S.string(), S.string(), S.optional(S.number())),
    b: S.allOf(S.optional(S.string()), S.optional(S.literal("x"))),
    c: S.oneOf(S.optional(S.number()), S.string()),
  });
  assert.equal(accepts(s, { a: "x", b: "x", c: 1 }), true);
  assert.equal(accepts(s, { c: 1 }), true);
  assert.equal(errorOf(s, { c: 1, extra: 1 }).path, "extra");
  assert.equal(errorOf(s, { a: "x", c: 1, extra: 1 }).path, "extra");
  // not / unknown reject undefined → counted statically
  const t = S.object({ n: S.not(S.null_()), u: S.unknown() });
  assert.equal(accepts(t, { n: 1, u: 2 }), true);
  assert.equal(errorOf(t, { n: 1, u: 2, z: 0 }).path, "z");
});

// ---------------------------------------------------------------------------
// JSON / TOON
// ---------------------------------------------------------------------------

test("JSON.stringify: unknown / not as-is, allOf / conditional by declared keys", () => {
  const s = S.object({
    u: S.unknown(),
    a: S.allOf(S.object({ x: S.number() }, { additionalProperties: true })),
    n: S.not(S.null_()),
    c: S.conditional(S.string(), S.string()),
    o: S.oneOf(S.string(), S.integer()),
  });
  const v = { u: { deep: [1, "x"] }, a: { x: 1, y: 2 }, n: { m: 3 }, c: "s", o: 4 };
  const out = SJ.stringify(s)(v as never);
  // `a` declares only x (like an open object); unknown / not declare nothing
  assert.equal(out, JSON.stringify({ ...v, a: { x: 1 } }));
  assert.deepEqual(SJ.parse(s)(out), [true, { ...v, a: { x: 1 } }]);
  assert.equal(SJ.parse(s)(JSON.stringify({ ...v, n: null }))[0], false);
});

/** stringify over the base `Schema` type (Infer<> is too deep for tsc there). */
const str = (s: S.Schema): ((v: unknown) => string) =>
  SJ.stringify(s as S.StringSchema) as (v: unknown) => string;

test("JSON.stringify of lowered JSON Schemas does not leak undeclared keys", () => {
  const user = { id: 1, password: "hunter2" };
  const props = { id: { type: "integer" } };
  const lowered = (js: S.JsonSchemaObject): S.Schema => S.fromJsonSchema(js)[1] as S.Schema;
  // Untyped object keywords → conditional; $ref + sibling required → allOf
  const untyped = lowered({ properties: props });
  const refd = lowered({
    $defs: { U: { type: "object", properties: props } },
    $ref: "#/$defs/U",
    required: ["id"],
  });
  assert.equal(untyped.kind, "conditional");
  assert.equal(refd.kind, "allOf");
  assert.equal(str(untyped)(user), '{"id":1}');
  assert.equal(str(refd)(user), '{"id":1}');
  assert.equal(str(untyped)("not an object"), '"not an object"'); // else: unknown
});

test("JSON.stringify allOf merges object shapes key by key", () => {
  const s = S.allOf(
    S.object({ a: S.string(), b: S.optional(S.object({ x: S.number() })) }),
    S.object({ b: S.object({ y: S.number() }, { additionalProperties: true }), c: S.integer() }),
    S.unknown(),
  );
  const v = { a: "s", b: { x: 1, y: 2, z: 3 }, c: 4, d: 5 };
  assert.equal(str(s)(v), '{"a":"s","b":{"x":1,"y":2},"c":4}');
  // Own reads only: an absent `toString` key is skipped, not Object.prototype's
  const proto = S.allOf(S.object({ toString: S.optional(S.string()) }), S.object({ k: S.null_() }));
  assert.equal(str(proto)({ k: null }), '{"k":null}');
  assert.equal(str(proto)({ k: null, toString: "t" }), '{"toString":"t","k":null}');
  // Same through per-call resolution (the conditional's guard is not bare)
  const kGuard = S.object({ k: S.null_() }, { additionalProperties: true });
  const dynamic = S.allOf(
    S.object({ toString: S.optional(S.string()) }, { additionalProperties: true }),
    S.conditional(kGuard, kGuard, S.unknown()),
  );
  assert.equal(str(dynamic)({ k: null }), '{"k":null}');
  assert.equal(str(dynamic)({ k: null, toString: "t", z: 1 }), '{"toString":"t","k":null}');
});

test("JSON.stringify allOf: type-guard conditionals resolve at compile time", () => {
  const anyObj = S.object({}, { additionalProperties: true });
  const a = S.object({ a: S.string() }, { additionalProperties: true });
  const b = S.object({ b: S.number() }, { additionalProperties: true });
  const v = { a: "x", b: 1, c: 2 };
  // Decided statically: the object variant rules out a string / number guard
  // and satisfies a bare object guard
  const cases: [S.Schema, string][] = [
    [S.allOf(a, S.conditional(S.string(), S.unknown(), b)), '{"a":"x","b":1}'],
    [S.allOf(a, S.conditional(S.number(), S.unknown(), b)), '{"a":"x","b":1}'],
    [S.allOf(a, S.conditional(anyObj, b, S.unknown())), '{"a":"x","b":1}'],
    // Not a bare type guard / branch depends on the value: resolved per call
    [S.allOf(a, S.conditional(S.string({ minLength: 1 }), S.unknown(), b)), '{"a":"x","b":1}'],
    [S.allOf(a, S.conditional(S.number({ minimum: 0 }), S.unknown(), b)), '{"a":"x","b":1}'],
    [
      S.allOf(a, S.conditional(S.object({ a: S.string() }, { additionalProperties: true }), b)),
      '{"a":"x","b":1}',
    ],
    [S.allOf(a, S.conditional(anyObj, S.union(b, S.string()), S.unknown())), '{"a":"x","b":1}'],
    [S.allOf(a, S.nullable(b)), '{"a":"x","b":1}'],
  ];
  for (const [schema, want] of cases) assert.equal(str(schema)(v), want);
  // No variant fixes the type: per call
  assert.equal(str(S.allOf(S.string(), S.conditional(anyObj, b, S.unknown())))("s"), '"s"');
  // An array variant rules out an object guard
  const arr = S.allOf(
    S.array(S.object({ x: S.number() }, { additionalProperties: true })),
    S.conditional(
      anyObj,
      S.unknown(),
      S.array(S.object({ y: S.number() }, { additionalProperties: true })),
    ),
  );
  assert.equal(str(arr)([{ x: 1, y: 2, z: 3 }]), '[{"x":1,"y":2}]');
  // A "__proto__" property survives the merge as data
  const proto = S.fromJsonSchema(
    JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
  )[1] as S.Schema;
  const merged = S.allOf(proto, S.object({ k: S.null_() }, { additionalProperties: true }));
  assert.equal(
    str(merged)(JSON.parse('{"__proto__":"p","k":null,"z":0}')),
    '{"__proto__":"p","k":null}',
  );
});

test("JSON.stringify allOf with a record emits every own key", () => {
  const s = S.allOf(
    S.record(S.object({ v: S.number() }, { additionalProperties: true })),
    S.object({ id: S.object({ v: S.number(), w: S.number() }, { additionalProperties: true }) }),
  );
  const v = Object.assign(Object.create({ inherited: 1 }), {
    q: { v: 1, junk: 0 },
    id: { v: 2, w: 3, junk: 0 },
  });
  assert.equal(str(s)(v), '{"id":{"v":2,"w":3},"q":{"v":1}}');
});

test("JSON.stringify allOf of array shapes merges per element", () => {
  const point = S.object({ x: S.number() }, { additionalProperties: true });
  const s = S.allOf(
    S.array(point),
    S.tuple(S.object({ y: S.number() }, { additionalProperties: true }), point),
  );
  assert.equal(
    str(s)([
      { x: 1, y: 2, z: 0 },
      { x: 3, y: 4 },
    ]),
    '[{"x":1,"y":2},{"x":3}]',
  );
  assert.equal(str(S.allOf(S.array(S.number()), S.array(S.integer())))([]), "[]");
  // Only unknown / not apply: emitted as-is
  assert.equal(str(S.allOf(S.unknown(), S.not(S.string())))([{ a: 1 }]), '[{"a":1}]');
  // Shapes that cannot describe the element (invalid input) leave it as-is
  assert.equal(str(S.allOf(S.array(S.unknown()), S.string()))([{ a: 1 }]), '[{"a":1}]');
});

test("JSON.stringify conditional / union / optional / nullable inside allOf", () => {
  const s = S.conditional(
    S.object({ t: S.literal("a") }, { additionalProperties: true }),
    S.object({ t: S.literal("a"), x: S.number() }, { additionalProperties: true }),
    S.allOf(
      S.union(
        S.object({ t: S.literal("b"), y: S.number() }, { additionalProperties: true }),
        S.string(),
      ),
      S.unknown(),
    ),
  );
  assert.equal(str(s)({ t: "a", x: 1, y: 2 }), '{"t":"a","x":1}');
  assert.equal(str(s)({ t: "b", x: 1, y: 2 }), '{"t":"b","y":2}');
  assert.equal(str(s)("plain"), '"plain"');
  assert.throws(() => str(s)({ t: 7 }), /does not match any union variant/);
  const opt = S.allOf(S.optional(S.nullable(S.object({ a: S.number() }))), S.unknown());
  assert.equal(str(opt)(undefined), "null");
  assert.equal(str(opt)(null), "null");
  assert.equal(str(opt)({ a: 1, b: 2 }), '{"a":1}');
});

test("JSON.stringify allOf of primitive shapes serializes the value", () => {
  assert.equal(
    str(S.allOf(S.string({ minLength: 1 }), S.string({ maxLength: 9 })))('a"b'),
    '"a\\"b"',
  );
  assert.equal(str(S.allOf(S.number(), S.number({ minimum: 0 })))(NaN), "null");
  assert.equal(str(S.allOf(S.integer(), S.number()))(3), "3");
  assert.equal(str(S.allOf(S.boolean(), S.literal(true)))(true), "true");
  assert.equal(str(S.allOf(S.null_(), S.nullable(S.string())))(null), "null");
});

test("JSON.stringify dispatches unions containing new kinds by validator", () => {
  const s = S.union(S.not(S.string()), S.string());
  assert.equal(SJ.stringify(s)("x" as never), '"x"');
  assert.equal(SJ.stringify(s)(1 as never), "1");
  // stringify assumes valid input: the first validating variant serializes it
  const t = S.oneOf(S.allOf(S.number()), S.conditional(S.string()), S.unknown());
  assert.equal(SJ.stringify(t)("x" as never), '"x"');
  assert.equal(SJ.stringify(t)(2 as never), "2");
});

test("TOON rejects unknown / allOf / not / conditional at compile time", () => {
  for (const s of [
    S.unknown(),
    S.allOf(S.string()),
    S.not(S.string()),
    S.conditional(S.string()),
  ]) {
    assert.throws(() => ST.stringify(S.object({ a: s })), /TOON: unsupported.*no TOON layout/);
    assert.throws(() => ST.parse(S.object({ a: s })), /TOON: unsupported/);
  }
});

test("TOON primitive oneOf parses with exactly-one semantics", () => {
  const s = S.object({ v: S.oneOf(S.integer(), S.number({ minimum: 2 })) });
  const str = ST.stringify(s);
  const par = ST.parse(s);
  assert.deepEqual(par(str({ v: 1 })), [true, { v: 1 }]);
  assert.deepEqual(par(str({ v: 2.5 })), [true, { v: 2.5 }]);
  assert.equal(par(str({ v: 3 } as never))[0], false); // matches both
  // oneOf(T, null) is not collapsed to nullable — null must match exactly one
  const n = S.object({ v: S.oneOf(S.nullable(S.string()), S.null_()) });
  assert.equal(ST.parse(n)("v: null")[0], false);
  assert.deepEqual(ST.parse(n)("v: x"), [true, { v: "x" }]);
});

test("allOf / conditional properties that accept undefined may be absent", () => {
  const s = S.object({
    a: S.allOf(S.optional(S.string()), S.optional(S.unknown())),
    c: S.conditional(S.string(), S.string(), S.optional(S.number())),
    r: S.allOf(S.string()),
    u: S.oneOf(S.optional(S.string()), S.optional(S.literal("x"))),
  });
  assert.equal(S.propertyMayBeAbsent(s.meta.properties.a), true);
  assert.equal(S.propertyMayBeAbsent(s.meta.properties.c), true);
  assert.equal(S.propertyMayBeAbsent(s.meta.properties.r), false);
  assert.equal(S.propertyMayBeAbsent(S.optional(S.string())), true);
  assert.equal(
    S.propertyMayBeAbsent(S.conditional(S.optional(S.null_()), S.optional(S.string()))),
    true,
  );
  assert.equal(S.propertyMayBeAbsent(S.conditional(S.optional(S.null_()), S.string())), false);
  assert.equal(S.propertyMayBeAbsent(S.allOf(S.nullable(S.optional(S.string())))), true);
  assert.equal(S.propertyMayBeAbsent(S.allOf(S.union(S.string(), S.optional(S.null_())))), true);
  assert.equal(S.propertyMayBeAbsent(s.meta.properties.u), false); // oneOf kind is "union"
  assert.equal(S.propertyMayBeAbsent(S.allOf(s.meta.properties.u)), false); // both match undefined
  assert.equal(S.propertyMayBeAbsent(S.allOf(S.oneOf(S.optional(S.string()), S.null_()))), true);
  assert.equal(S.propertyMayBeAbsent(S.allOf(S.literal("x"))), false);
  // toJsonSchema leaves them out of `required`
  assert.deepEqual((S.toJsonSchema(s) as { required: string[] }).required, ["r", "u"]);
  // stringify omits absent keys and emits valid JSON; parse round-trips
  const str = SJ.stringify(s);
  const par = SJ.parse(s);
  assert.equal(str({ r: "x", u: "y" } as never), '{"r":"x","u":"y"}');
  assert.equal(str({ a: "s", c: 1, r: "x", u: "y" } as never), '{"a":"s","c":1,"r":"x","u":"y"}');
  assert.deepEqual(par('{"r":"x","u":"y"}'), [true, { r: "x", u: "y" }]);
  // outside an object field, undefined emits null like optional(T)
  assert.equal(
    SJ.stringify(S.array(S.allOf(S.optional(S.string()))))([undefined] as never),
    "[null]",
  );
});
