/**
 * fromJsonSchema — JSON Schema 2020-12 lowering: $ref, combinators, boolean
 * schemas, type arrays, untyped keyword groups, and every Err path.
 */
// JSON Schema `then` keyword fixtures are plain data, never awaited
/* eslint-disable unicorn/no-thenable */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../schema/Schema.js";
import * as SJ from "../../schema/JSON.js";
import { validate as validateTyped, type SchemaError } from "../../schema/Validate.js";
import type { Result } from "../../Result.js";

type Check = (v: unknown) => Result<unknown, SchemaError>;
const validate = (s: S.Schema): Check => validateTyped(s as S.StringSchema) as Check;

function lower(js: unknown, options?: S.FromJsonSchemaOptions): S.Schema {
  const r = S.fromJsonSchema(js as S.JsonSchemaObject, options);
  assert.equal(r[0], true, "expected Ok, got " + String(r[1]));
  return r[1] as S.Schema;
}
function lowerErr(js: unknown, options?: S.FromJsonSchemaOptions): string {
  const r = S.fromJsonSchema(js as S.JsonSchemaObject, options);
  assert.equal(r[0], false, "expected Err");
  return r[1] as string;
}
/** Assert accept/reject verdicts for a lowered schema. */
function verdicts(
  js: unknown,
  good: unknown[],
  bad: unknown[],
  options?: S.FromJsonSchemaOptions,
): void {
  const check = validate(lower(js, options));
  for (const v of good) assert.equal(check(v)[0], true, "should accept " + JSON.stringify(v));
  for (const v of bad) assert.equal(check(v)[0], false, "should reject " + JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// $ref
// ---------------------------------------------------------------------------

test("$ref — $defs, definitions, root, array index", () => {
  verdicts({ $defs: { a: { type: "string" } }, $ref: "#/$defs/a" }, ["x"], [1]);
  verdicts({ definitions: { a: { type: "integer" } }, $ref: "#/definitions/a" }, [1], ["x"]);
  verdicts(
    { type: "object", properties: { n: { type: "number" }, m: { $ref: "#/properties/n" } } },
    [{ n: 1, m: 2 }],
    [{ m: "x" }],
  );
  verdicts({ allOf: [{ type: "string" }, { $ref: "#/allOf/0" }] }, ["x"], [1]);
});

test("$ref — pointer escapes ~0 ~1 and percent-decoding", () => {
  const defs = {
    "a/b": { type: "string" },
    "c~d": { type: "number" },
    "e f": { type: "boolean" },
    "g%h": { type: "null" },
  };
  verdicts({ $defs: defs, $ref: "#/$defs/a~1b" }, ["x"], [1]);
  verdicts({ $defs: defs, $ref: "#/$defs/c~0d" }, [1], ["x"]);
  verdicts({ $defs: defs, $ref: "#/$defs/e%20f" }, [true], [1]);
  verdicts({ $defs: defs, $ref: "#/$defs/g%25h" }, [null], [1]);
  assert.match(lowerErr({ $defs: defs, $ref: "#/$defs/%E0%A4%A" }), /malformed percent-encoding/);
});

test("$ref — shared targets lower to one node", () => {
  const s = lower({
    type: "object",
    properties: { a: { $ref: "#/$defs/x" }, b: { $ref: "#/$defs/x" } },
    required: ["a", "b"],
    $defs: { x: { type: "object", properties: { v: { type: "string" } } } },
  }) as S.ObjectSchema<Record<string, S.Schema>>;
  assert.equal(s.meta.properties.a, s.meta.properties.b);
});

test("$ref — recursion and cyclic input are Err, never hang", () => {
  assert.match(lowerErr({ properties: { a: { $ref: "#" } } }), /recursive \$ref is not supported/);
  assert.match(
    lowerErr({ $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } }, $ref: "#/$defs/a" }),
    /recursive \$ref/,
  );
  const cyc: Record<string, unknown> = { type: "object" };
  cyc.properties = { self: cyc };
  assert.match(lowerErr(cyc), /cyclic JSON Schema input/);
});

test("$ref — unresolved / malformed refs are Err", () => {
  assert.match(
    lowerErr({ $ref: "other.json" }),
    /unresolved \$ref "other.json" \(supply it via options.refs\)/,
  );
  assert.match(lowerErr({ $ref: "#/nope" }), /unresolved \$ref pointer/);
  assert.match(lowerErr({ $defs: { a: 1 }, $ref: "#/$defs/a/b" }), /unresolved \$ref pointer/);
  assert.match(lowerErr({ $ref: "#missing" }), /unresolved \$ref anchor/);
  assert.match(lowerErr({ $ref: 5 }), /\$ref must be a string/);
  assert.match(lowerErr({ $ref: "http://[bad" }), /unresolved \$ref "http:\/\/\[bad"/);
  assert.match(lowerErr({ $id: "http://[bad" }), /invalid \$id/);
  // error locations point into the document
  assert.match(lowerErr({ properties: { "a/b": { $ref: "#/x" } } }), /\(at #\/properties\/a~1b\)$/);
});

test("$ref — boolean targets", () => {
  verdicts({ $defs: { t: true }, $ref: "#/$defs/t" }, [1, "x"], []);
  verdicts({ $defs: { f: false }, $ref: "#/$defs/f" }, [], [1, "x"]);
});

test("$ref — $id resources, relative resolution, anchors", () => {
  const doc = {
    $id: "http://example.com/root.json",
    $defs: {
      a: { $id: "item.json", type: "integer" },
      b: { $anchor: "name", type: "string" },
      c: {
        $id: "http://other.com/x/",
        $defs: { inner: { type: "boolean" } },
        $ref: "#/$defs/inner",
      },
    },
    type: "object",
    properties: {
      i: { $ref: "item.json" },
      n: { $ref: "#name" },
      full: { $ref: "http://example.com/root.json#/$defs/b" },
      c: { $ref: "http://other.com/x/" },
    },
  };
  verdicts(doc, [{ i: 1, n: "s", full: "t", c: true }], [{ i: "x" }, { n: 1 }, { c: 1 }]);
  // a pointer walking through a nested $id resolves refs against that resource
  verdicts({ $ref: "#/$defs/c", $defs: doc.$defs }, [true], [1]);
});

test("$ref — non-local refs via options.refs (resolved URI, raw key, inner $id)", () => {
  const hit = {
    $id: "mempire/labs/search-hit",
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  };
  const doc = { $id: "mempire/labs/tools", type: "array", items: { $ref: "search-hit" } };
  assert.match(lowerErr(doc), /unresolved \$ref "search-hit"/);
  // resolved against the document $id → matches the supplied schema's $id
  verdicts(doc, [[{ url: "u" }]], [[{}]], { refs: { "any-key": hit } });
  // key equal to the resolved URI
  verdicts(doc, [[{ url: "u" }]], [[{}]], { refs: { "mempire/labs/search-hit": hit } });
  // raw $ref text as key (fragment allowed)
  const plain = {
    type: "object",
    properties: { url: { type: "string" } },
    $defs: { s: { type: "string" } },
  };
  verdicts(doc, [[{ url: "u" }]], [[{ url: 1 }]], { refs: { "search-hit": plain } });
  verdicts({ $id: "a/b", $ref: "x#/$defs/s" }, ["s"], [1], { refs: { x: plain } });
  // keys that are not URI-resolvable still work as raw keys
  verdicts({ $ref: "http://[odd" }, ["s"], [1], { refs: { "http://[odd": { type: "string" } } });
});

test("$ref — sibling assertions combine (allOf), annotations are ignored", () => {
  const s = lower({
    $defs: { a: { type: "string" } },
    $ref: "#/$defs/a",
    title: "t",
    description: "d",
  });
  assert.equal(s.kind, "string");
  const both = lower({ $defs: { a: { type: "string" } }, $ref: "#/$defs/a", maxLength: 2 });
  assert.equal(both.kind, "allOf");
  verdicts(
    { $defs: { a: { type: "string" } }, $ref: "#/$defs/a", maxLength: 2 },
    ["ab"],
    ["abc", 1],
  );
});

// ---------------------------------------------------------------------------
// Combinators, booleans, types
// ---------------------------------------------------------------------------

test("oneOf — exactly one; nullable shortcut only when T rejects null", () => {
  verdicts({ oneOf: [{ type: "integer" }, { minimum: 2 }] }, [1, 2.5, "x"], [3]);
  assert.equal(lower({ oneOf: [{ type: "string" }, { type: "null" }] }).kind, "nullable");
  assert.equal(
    lower({ oneOf: [{ type: "null", description: "none" }, { type: "string" }] }).kind,
    "nullable",
  );
  // T accepts null → must stay exclusive (null would match both)
  const t = lower({ oneOf: [{ type: ["string", "null"] }, { type: "null" }] });
  assert.equal(t.kind, "union");
  verdicts({ oneOf: [{ type: ["string", "null"] }, { type: "null" }] }, ["x"], [null]);
  verdicts({ oneOf: [{ type: "null" }, {}] }, [1], [null]);
  verdicts({ oneOf: [{ type: "null" }, { type: "null" }] }, [], [null, 1]);
  // an empty-fragment $id ("x#") names the same resource as "x"
  verdicts(
    { $defs: { a: { $id: "http://e.com/a.json#", type: "string" } }, $ref: "http://e.com/a.json" },
    ["s"],
    [1],
  );
  // rejectsNull through wrappers
  for (const [inner, kind] of [
    [{ const: "a" }, "nullable"],
    [{ const: null }, "union"],
    [{ anyOf: [{ type: "string" }, { type: "number" }] }, "nullable"],
    [{ allOf: [{ type: "string" }, {}] }, "nullable"],
    [{ not: { type: "string" } }, "union"],
    [{ if: { type: "string" }, then: { type: "string" }, else: { type: "number" } }, "nullable"],
    [{ if: { type: "string" }, then: { type: "string" } }, "union"],
  ] as const) {
    assert.equal(lower({ oneOf: [inner, { type: "null" }] }).kind, kind, JSON.stringify(inner));
  }
  assert.equal(S.findDiscriminant([]), null);
});

test("anyOf — nullable shortcut needs a pure {type:null} branch", () => {
  assert.equal(lower({ anyOf: [{ type: "string" }, { type: "null" }] }).kind, "nullable");
  const notPure = lower({ anyOf: [{ type: "string" }, { type: "null", not: {} }] });
  assert.equal(notPure.kind, "union");
  verdicts({ anyOf: [{ type: "string" }, { type: "null", not: {} }] }, ["x"], [null]);
  assert.match(lowerErr({ anyOf: [] }), /anyOf must be a non-empty array/);
  assert.match(lowerErr({ oneOf: {} }), /oneOf must be a non-empty array/);
});

test("allOf / not / if-then-else / boolean schemas", () => {
  assert.equal(lower({ allOf: [{ type: "string" }] }).kind, "string");
  verdicts({ allOf: [{ type: "number" }, { minimum: 2 }] }, [2], [1, "x"]);
  verdicts({ not: { type: "string" } }, [1, null], ["x"]);
  verdicts(
    { if: { type: "number" }, then: { minimum: 2 }, else: { type: "string" } },
    [2, "x"],
    [1, true],
  );
  verdicts({ if: { type: "number" }, else: { type: "string" } }, [1, "x"], [true]);
  // if alone, then/else alone: no constraint
  assert.equal(lower({ if: { type: "number" } }).kind, "unknown");
  assert.equal(lower({ then: { type: "number" }, else: false }).kind, "unknown");
  verdicts(true, [1, null, {}], []);
  verdicts(false, [], [1, null, {}]);
  assert.equal(lower({}).kind, "unknown");
  assert.equal(lower({ title: "x", $comment: "c", examples: [1] }).kind, "unknown");
});

test("type arrays → nullable / union", () => {
  assert.equal(lower({ type: ["string", "null"] }).kind, "nullable");
  assert.equal(lower({ type: ["null", "string"] }).kind, "nullable");
  assert.equal(lower({ type: ["string", "number", "null"] }).kind, "union");
  assert.equal(lower({ type: ["string"] }).kind, "string");
  verdicts({ type: ["string", "integer"], minLength: 2, minimum: 5 }, ["ab", 5], ["a", 4, null]);
  assert.match(lowerErr({ type: [] }), /type must not be an empty array/);
  assert.match(lowerErr({ type: "weird" }), /unsupported type "weird"/);
  assert.match(lowerErr({ type: [1] }), /unsupported type 1/);
  // 2020-12: type array entries MUST be unique
  assert.match(lowerErr({ type: ["null", "null"] }), /type must not repeat "null"/);
  assert.match(lowerErr({ type: ["string", "number", "string"] }), /type must not repeat "string"/);
  // JS-built values that JSON.stringify cannot serialize are described by kind
  assert.match(lowerErr({ type: [1n] }), /unsupported type bigint/);
  const cyc: unknown[] = [];
  cyc.push(cyc);
  assert.match(lowerErr({ type: cyc }), /unsupported type array/);
  assert.match(lowerErr({ type: [{}] }), /unsupported type object/);
  assert.match(lowerErr({ type: [null] }), /unsupported type null/);
});

test("untyped keyword groups only constrain their own type", () => {
  verdicts({ minimum: 2 }, [2, "x", null, [], {}], [1]);
  verdicts({ minLength: 2 }, ["ab", 1], ["a"]);
  verdicts({ maxItems: 1 }, [[1], "x"], [[1, 2]]);
  verdicts({ required: ["a"] }, [{ a: 1 }, 1, []], [{}]);
  verdicts({ properties: { a: { type: "string" } } }, [{}, { a: "x", b: 1 }, 1], [{ a: 1 }]);
  verdicts(
    { minimum: 2, minLength: 2, items: { type: "string" } },
    [2, "ab", ["x"], null],
    [1, "a", [1]],
  );
  verdicts({ format: "unknown-format" }, ["x", 1], []);
});

test("const / enum — bare type folded away only when every value matches", () => {
  assert.equal(lower({ type: "string", enum: ["a", "b"] }).kind, "enum");
  assert.equal(lower({ type: "string", const: "a" }).kind, "literal");
  assert.equal(lower({ type: ["integer", "null"], enum: [1, null] }).kind, "union");
  verdicts({ type: "string", enum: ["a", 1] }, ["a"], [1]);
  verdicts({ type: "integer", const: 1.5 }, [], [1.5]);
  verdicts({ const: "a", enum: ["a", "b"] }, ["a"], ["b"]);
  verdicts({ const: "abc", minLength: 5 }, [], ["abc"]);
  verdicts({ enum: [true, null, "x"] }, [true, null, "x"], [false, 0]);
  verdicts({ enum: [] }, [], [1, "a"]);
  assert.match(lowerErr({ const: [1] }), /unsupported const type: array/);
  assert.match(lowerErr({ const: { a: 1 } }), /unsupported const type: object/);
  assert.match(lowerErr({ enum: "a" }), /enum must be an array/);
  assert.match(lowerErr({ enum: [[1]] }), /enum values must be primitives, got array/);
});

// ---------------------------------------------------------------------------
// Objects and arrays
// ---------------------------------------------------------------------------

test("objects — required keys outside properties are enforced", () => {
  verdicts({ type: "object", required: ["a"] }, [{ a: null }, { a: 1, b: 2 }], [{}]);
  verdicts(
    { type: "object", properties: { b: {} }, required: ["a", "b"] },
    [{ a: 1, b: 2 }],
    [{ b: 1 }, { a: 1 }],
  );
  // required + additionalProperties:false + undeclared key: unsatisfiable for objects
  verdicts({ type: "object", required: ["a"], additionalProperties: false }, [], [{ a: 1 }, {}]);
  verdicts(
    { type: ["object", "null"], required: ["a"], additionalProperties: false },
    [null],
    [{ a: 1 }],
  );
  verdicts({ type: "object", properties: { a: false } }, [{}], [{ a: 1 }]);
  const proto = lower(JSON.parse('{"type":"object","required":["__proto__"]}')) as S.ObjectSchema<
    Record<string, S.Schema>
  >;
  assert.deepEqual(Object.keys(proto.meta.properties), ["__proto__"]);
});

test("objects — record forms", () => {
  assert.equal(lower({ type: "object", additionalProperties: { type: "number" } }).kind, "record");
  assert.equal(
    lower({ type: "object", properties: {}, additionalProperties: { type: "number" } }).kind,
    "record",
  );
  verdicts(
    { type: "object", additionalProperties: { type: "number" }, required: ["a"] },
    [{ a: 1, b: 2 }],
    [{ b: 2 }, { a: "x" }],
  );
  verdicts({ type: "object", additionalProperties: true }, [{ a: 1 }], [1]);
  assert.match(
    lowerErr({ type: "object", properties: { a: {} }, additionalProperties: { type: "string" } }),
    /additionalProperties as a schema alongside properties is not supported/,
  );
});

test("objects — malformed keyword values are Err", () => {
  assert.match(lowerErr({ type: "object", required: "a" }), /required must be an array of strings/);
  assert.match(lowerErr({ type: "object", required: [1] }), /required must be an array of strings/);
  assert.match(lowerErr({ properties: 1 }), /properties must be an object/);
});

test("arrays — items forms", () => {
  verdicts({ type: "array" }, [[], [1, "x"]], [{}]);
  verdicts({ type: "array", items: true }, [[1]], []);
  verdicts({ type: "array", items: false }, [[]], [[1]]);
  verdicts(
    { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
    [["a"]],
    [[], ["a", "b", "c"], [1]],
  );
  assert.match(lowerErr({ type: "array", items: [{}] }), /array-form items is not supported/);
});

test("arrays — prefixItems lowers to tuples over the allowed lengths", () => {
  const p = [{ type: "string" }, { type: "number" }];
  assert.equal(lower({ type: "array", prefixItems: p, items: false, minItems: 2 }).kind, "tuple");
  assert.equal(
    lower({ type: "array", prefixItems: p, items: false, maxItems: 1, minItems: 1 }).kind,
    "tuple",
  );
  assert.equal(lower({ type: "array", prefixItems: p, items: false }).kind, "union");
  verdicts(
    { type: "array", prefixItems: p, items: false },
    [[], ["a"], ["a", 1]],
    [["a", 1, 2], [1]],
  );
  verdicts({ type: "array", prefixItems: p, items: false, minItems: 3 }, [], [["a", 1], []]);
  verdicts({ prefixItems: p, items: false, maxItems: 1 }, [[], ["a"], "x"], [["a", 1]]);
  assert.match(
    lowerErr({ type: "array", prefixItems: p }),
    /prefixItems is only supported with items: false/,
  );
  assert.match(
    lowerErr({ type: "array", prefixItems: p, items: {} }),
    /prefixItems is only supported/,
  );
  assert.match(
    lowerErr({ type: "array", prefixItems: {}, items: false }),
    /prefixItems must be an array/,
  );
});

// ---------------------------------------------------------------------------
// Keyword errors
// ---------------------------------------------------------------------------

test("unsupported assertion keywords are Err, never dropped", () => {
  for (const kw of [
    "patternProperties",
    "propertyNames",
    "dependentRequired",
    "dependentSchemas",
    "dependencies",
    "minProperties",
    "maxProperties",
    "contains",
    "additionalItems",
    "unevaluatedItems",
    "unevaluatedProperties",
    "$dynamicRef",
    "$recursiveRef",
  ]) {
    assert.ok(lowerErr({ [kw]: {} }).includes(kw + " is not supported"));
  }
  assert.match(lowerErr({ type: "array", uniqueItems: true }), /uniqueItems is not supported/);
  assert.equal(lower({ type: "array", uniqueItems: false }).kind, "array");
  // nested: the location is reported
  assert.match(
    lowerErr({ properties: { a: { contains: {} } } }),
    /contains is not supported \(at #\/properties\/a\)/,
  );
});

test("malformed scalar keyword values are Err", () => {
  assert.match(lowerErr({ type: "string", minLength: "3" }), /minLength must be a number/);
  assert.match(lowerErr({ type: "string", maxLength: null }), /maxLength must be a number/);
  assert.match(lowerErr({ type: "string", pattern: 1 }), /pattern must be a string/);
  assert.match(lowerErr({ type: "string", pattern: "(" }), /invalid pattern/);
  assert.match(lowerErr({ type: "string", pattern: "\\_" }), /invalid pattern/); // not unicode-mode valid
  assert.match(lowerErr({ type: "string", pattern: "\\p{L}" }), /pattern needs unicode mode/);
  assert.match(lowerErr({ type: "string", pattern: "\\u{1F600}" }), /pattern needs unicode mode/);
  assert.match(lowerErr({ type: "string", pattern: "😀" }), /pattern needs unicode mode/);
  // Escaped surrogates: one code point in unicode mode, two units without it
  for (const pattern of [
    "^[\\uD83D\\uDE00]$",
    "^\\uD83D\\uDE00+$",
    "\\uD83D", // lone: in unicode mode it never matches half a pair
    "[\\uD800-\\uDFFF]",
    "\\udbff",
    "\\\\\\p{L}", // escaped backslash, then a real \p{L}
    "\\\ud83d", // `\` + raw surrogate
    "a\ude00",
  ]) {
    assert.match(lowerErr({ type: "string", pattern }), /pattern needs unicode mode/, pattern);
  }
  // An escaped backslash never starts an escape: `\\p{2}` is `\` then `p{2}`
  verdicts({ type: "string", pattern: "^\\\\p{2}$" }, ["\\pp"], ["\\p", "pp"]);
  verdicts({ type: "string", pattern: "^\\\\u{2}$" }, ["\\uu"], ["u"]);
  verdicts({ type: "string", pattern: "^\\\\uD83D$" }, ["\\uD83D"], []);
  // Non-surrogate \u escapes are fine; a brace-less \p or a trailing \ is invalid
  verdicts({ type: "string", pattern: "^\\u00e9\\uE000\\u0D80$" }, ["\u00e9\uE000\u0D80"], ["e"]);
  verdicts({ type: "string", pattern: "^\\uD7FF$" }, ["\uD7FF"], ["x"]);
  assert.match(lowerErr({ type: "string", pattern: "\\p" }), /invalid pattern/);
  assert.match(lowerErr({ type: "string", pattern: "a\\" }), /invalid pattern/);
  // Lengths and item counts are non-negative integers
  for (const [kw, type] of [
    ["minLength", "string"],
    ["maxLength", "string"],
    ["minItems", "array"],
    ["maxItems", "array"],
  ] as const) {
    for (const v of [-1, 1.5, -0.5, Infinity]) {
      assert.match(lowerErr({ type, [kw]: v }), new RegExp(kw + " must be a non-negative integer"));
    }
    assert.equal(lower({ type, [kw]: 0 }).kind, type);
    assert.equal(lower({ [kw]: 2 }).kind, "conditional"); // untyped group, same check
  }
  assert.match(lowerErr({ minLength: -1 }), /minLength must be a non-negative integer/);
  assert.match(lowerErr({ type: "string", format: 1 }), /format must be a string/);
  assert.match(lowerErr({ type: "number", minimum: "1" }), /minimum must be a number/);
  assert.match(lowerErr({ minimum: "1" }), /minimum must be a number/);
  assert.match(lowerErr({ type: "array", minItems: "1" }), /minItems must be a number/);
  assert.match(lowerErr({ multipleOf: 0 }), /multipleOf must be a finite number > 0/);
  assert.match(lowerErr({ type: "number", multipleOf: Infinity }), /multipleOf/);
  verdicts({ type: "string", pattern: "^a\\d$" }, ["a1"], ["b1"]);
  // Documented divergence (no `u` flag): `.` matches one UTF-16 unit
  verdicts({ type: "string", pattern: "^.$" }, ["a"], ["\u{1F600}"]);
  verdicts({ type: "string", pattern: "^\\W\\W$" }, ["\u{1F600}"], []);
});

test("nesting deeper than the cap is Err, not a stack overflow", () => {
  let js: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < 600; i++) js = { not: js };
  assert.match(lowerErr(js), /nested deeper than 512/);
});

test("$ref fan-out beyond the expansion budget is Err", () => {
  // d_i has two properties that both $ref d_{i-1}: 1.9 KB of JSON whose tree
  // expansion (what every code generator inlines) is ~3·2^20 nodes
  const chain = (n: number): Record<string, unknown> => {
    const defs: Record<string, unknown> = { d0: { type: "string" } };
    for (let i = 1; i <= n; i++) {
      const ref = { $ref: "#/$defs/d" + (i - 1) };
      defs["d" + i] = { type: "object", properties: { a: ref, b: ref } };
    }
    return { $defs: defs, $ref: "#/$defs/d" + n };
  };
  assert.match(lowerErr(chain(20)), /expands to more than 50000 nodes/);
  const s = lower(chain(10)); // ~3k nodes: fine
  assert.equal(validate(s)({ a: { a: "x" } })[0], false);
  // prefixItems without minItems lowers to one tuple per length (n²/2 nodes)
  const prefixItems = Array.from({ length: 2000 }, () => ({ type: "string" }));
  assert.match(lowerErr({ prefixItems, items: false }), /expands to more than/);
  lower({ prefixItems: prefixItems.slice(0, 50), items: false });
});

test("prefixItems without a fixed length is refused before its tuples are built", () => {
  const items = (n: number): unknown[] => Array.from({ length: n }, () => ({}));
  const tooBig = /prefixItems without a fixed length expands to more than 50000 nodes/;
  // Exactly at the cap: 1 union + 315 tuples + Σ k items (k = 0..314) = 49771
  const atCap = lower({ type: "array", prefixItems: items(314), items: false });
  assert.equal(atCap.kind, "union");
  assert.match(lowerErr({ type: "array", prefixItems: items(315), items: false }), tooBig);
  // minItems / maxItems narrow the length range, and so the count
  lower({ type: "array", prefixItems: items(2000), items: false, minItems: 1990 });
  lower({ type: "array", prefixItems: items(2000), items: false, maxItems: 300 });
  // a pinned length is one tuple, any size
  lower({ type: "array", prefixItems: items(20_000), items: false, minItems: 20_000 });
  // the budget is shared by every site: many sub-cap sites cannot each build ~50k
  const two = { type: "array", prefixItems: items(250), items: false }; // 31,627 each
  lower({ type: "object", properties: { a: two } });
  assert.match(lowerErr({ type: "object", properties: { a: two, b: two } }), tooBig);
  // a $ref target is lowered (and counted) once, however often it is used
  // (two uses then exceed the expansion cap, reported as $ref fan-out)
  const ref = { $ref: "#/$defs/t" };
  lower({ $defs: { t: two }, type: "array", items: ref });
  const twice = { $defs: { t: two }, type: "object", properties: { a: ref, b: ref } };
  assert.match(lowerErr(twice), /\$ref fan-out/);
  // sites whose result is thrown away do not count (but are still checked)
  const keptOne = { type: "array", prefixItems: [two, two], items: false, maxItems: 1 };
  assert.equal(lower({ ...keptOne, minItems: 1 }).kind, "tuple");
  assert.equal(lower(keptOne).kind, "union");
  const none = { type: "array", prefixItems: [two, two], items: false, maxItems: 0 };
  assert.equal(lower({ type: "object", properties: { a: two, b: none } }).kind, "object");
  const empty = { ...none, minItems: 1 }; // lo > hi: nothing is kept
  assert.equal(lower({ type: "object", properties: { a: two, b: empty } }).kind, "object");
  const unmet = { type: "object", properties: { x: two, y: two }, required: ["z"] };
  assert.equal(lower({ ...unmet, additionalProperties: false }).kind, "not");
  assert.match(lowerErr({ ...unmet, additionalProperties: true }), tooBig);
  assert.match(
    lowerErr({ ...none, prefixItems: [{ type: "string", minLength: -1 }] }),
    /minLength must be a non-negative integer \(at #\/prefixItems\/0\)/,
  );
  // a $ref target first met in a discarded item is not memoized as a placeholder
  const shared = {
    $defs: { t: { type: "array", prefixItems: [{}, {}], items: false } },
    type: "object",
    properties: {
      a: { type: "array", prefixItems: [{ $ref: "#/$defs/t" }], items: false, maxItems: 0 },
      b: { $ref: "#/$defs/t" },
    },
    required: ["b"],
  };
  verdicts(
    shared,
    [{ b: [] }, { b: [1] }, { b: [1, 2] }, { a: [], b: [] }],
    [{ b: [1, 2, 3] }, {}],
  );
  // 60 KB of JSON fails fast (it used to build ~2·10^8 nodes first)
  const t = performance.now();
  assert.match(lowerErr({ type: "array", prefixItems: items(20_000), items: false }), tooBig);
  assert.ok(performance.now() - t < 2000);
});

test("lowered schema depth is capped where every code generator still works", () => {
  // Per level, the deepest lowering: untyped keyword groups (allOf of guarded
  // conditionals) around an array, an optional property or a nullable type
  const shapes: ((js: unknown) => unknown)[] = [
    (js) => ({ items: js, minLength: 1, minimum: 0 }),
    (js) => ({ properties: { a: js }, maxLength: 3 }),
    (js) => ({ type: ["array", "null"], items: js }),
    (js) => ({ oneOf: [js, { type: "integer" }], not: { type: "null" } }),
    (js) => ({ if: { type: "array" }, then: { items: js }, else: { $ref: "#/$defs/x" } }),
  ];
  for (const wrap of shapes) {
    let js: unknown = { type: "string", minLength: 1 };
    let last: S.Schema | null = null;
    for (let i = 0; i < 520; i++) {
      js = wrap(js);
      const r = S.fromJsonSchema({ $defs: { x: { type: "integer" } }, ...(js as object) });
      if (!r[0]) {
        assert.match(r[1], /nested deeper than (256|512)/);
        break;
      }
      last = r[1];
    }
    assert.ok(last !== null);
    // None of these may hit an engine stack / parser limit
    validate(last);
    validateTyped(last as S.StringSchema, { allErrors: true });
    SJ.parse(last as S.StringSchema);
    SJ.stringify(last as S.StringSchema);
    S.toJsonSchema(last);
  }
});

test("invalid scalar schema nodes are Err", () => {
  assert.match(lowerErr({ properties: { a: 1 } }), /got number \(at #\/properties\/a\)/);
  assert.match(lowerErr({ not: null }), /got null/);
  assert.match(lowerErr({ not: [] }), /got array/);
});

test("an exotic non-URI-resolvable options.refs key does not break the document", () => {
  verdicts({ type: "string" }, ["x"], [1], { refs: { "http://[x": { type: "number" } } });
});

// ---------------------------------------------------------------------------
// format: standard names enforced, strict mode
// ---------------------------------------------------------------------------

test("format — standard 2020-12 names lower to enforced string formats", () => {
  verdicts({ type: "string", format: "date" }, ["2024-02-29"], ["tomorrow", "2023-02-29"]);
  verdicts({ type: "string", format: "date-time" }, ["2024-02-29T12:00:00Z"], ["2024-02-29"]);
  verdicts({ format: "time" }, ["12:00:00Z", 5, null], ["noon"]);
  verdicts(
    { type: "object", properties: { at: { type: "string", format: "date" } }, required: ["at"] },
    [{ at: "2024-01-01" }],
    [{ at: "tomorrow" }, {}],
  );
});

test("format — unknown names: annotation-only by default, Err in strict mode", () => {
  verdicts({ type: "string", format: "hostname" }, ["not a host!"], [1]);
  verdicts({ type: "string", format: "hostname" }, ["x"], [], { formats: "annotate" });
  assert.match(
    lowerErr({ type: "string", format: "hostname" }, { formats: "strict" }),
    /^unknown format "hostname" \(formats: "strict"\)$/,
  );
  // Nested, untyped, on a non-string type, and prototype names
  assert.match(
    lowerErr({ properties: { a: { format: "x-custom" } } }, { formats: "strict" }),
    /unknown format "x-custom".*\(at #\/properties\/a\)/,
  );
  assert.match(lowerErr({ type: "integer", format: "int32" }, { formats: "strict" }), /int32/);
  assert.match(lowerErr({ format: "constructor" }, { formats: "strict" }), /constructor/);
  // Known names (legacy iso-datetime included) pass strict mode
  for (const format of [
    "date",
    "date-time",
    "time",
    "email",
    "uri",
    "uuid",
    "ipv4",
    "ipv6",
    "iso-datetime",
  ]) {
    lower({ type: "string", format }, { formats: "strict" });
  }
  // A non-string format value is still the type error, not the strict one
  assert.match(
    lowerErr({ type: "string", format: 1 }, { formats: "strict" }),
    /format must be a string/,
  );
});
