/**
 * JSON — code-generated JSON serializers and parsers from Schema definitions.
 *
 * When to use: a schema is known at init time and you want typed parse +
 * validation in one step (`parse` → `Result<T, SchemaError>`, never throws) or
 * a serializer that emits exactly the schema's keys. For ad-hoc JSON use
 * `@dolphin278/vjuga/JSON`. Not a speed win for stringify (see below).
 *
 * Performance (Node 26, M1 Pro, output consumed with `Buffer.byteLength`):
 *   stringify is ~1.2–2.5x slower than native (2 fields 97 vs 79 ns; 5 fields
 *   265 vs 140 ns; 100 objects 8.3 vs 3.3 µs): generated code builds a rope
 *   that must be flattened; native writes a flat string in C++.
 *   parse is ~5–20% slower than bare `JSON.parse` (validation included).
 *
 * Design tradeoffs:
 *   stringify: pre-computed key fragments; all-required objects inline into a
 *   single expression. Unions dispatch by typeof when variant types are
 *   disjoint, else by each variant's validator; no match throws `TypeError`.
 *   Non-finite numbers emit `null` like native; `unknown` / `allOf` / `not` /
 *   `conditional` values use native `JSON.stringify`. parse: native
 *   `JSON.parse` + generated validation; own `__proto__` keys (also
 *   `\u`-escaped spellings) are stripped. `constructor` is kept.
 *
 * @example Compile once at init, call on hot path
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * import * as SJ from "@dolphin278/vjuga/schema/JSON";
 * const User = S.object({ id: S.integer(), bio: S.optional(S.string()) });
 * const toJson = SJ.stringify(User);
 * const fromJson = SJ.parse(User);
 * toJson({ id: 1 }); // '{"id":1}' — absent/undefined optional keys are omitted
 * fromJson('{"id":1}'); // [true, { id: 1 }]
 * ```
 *
 * Pitfalls:
 *   - `stringify` assumes valid input; `validate()` untrusted data first.
 *   - `optional(T)` outside an object (tuple slot, array item, root) emits
 *     `null`, which `parse` rejects. Use `nullable(T)` there instead.
 *   - Compile at module scope — each factory call runs `new Function`.
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import { parse as jsonParse, escapeJsonString } from "../JSON.js";
import type { Schema, Infer } from "./Schema.js";
import type { SchemaError } from "./Validate.js";
import { emitStandardRefs, emitValidation, validate } from "./Validate.js";
import { findDiscriminant } from "./Schema.js";
import { unreachable } from "../FunctionUtils.js";
import {
  type CodeBuffer,
  createBuffer,
  emit,
  emitRef,
  freshVar,
  compileFunction,
  compileHelper,
  typeCheckExpr,
} from "./Codegen.js";

/**
 * JSON number serialization. Non-finite values have no JSON representation —
 * emit `null` like native `JSON.stringify` instead of the invalid token
 * `Infinity`. `x - x === 0` is true exactly for finite numbers.
 */
function numberToJson(x: number): string {
  return x - x === 0 ? "" + x : "null";
}

/**
 * Removes own `__proto__` keys from a parsed JSON tree, in place. Only
 * `__proto__` is dangerous: `JSON.parse` creates it as an own data property,
 * which a naive merge then turns into a prototype write. `constructor` is an
 * ordinary key and is preserved.
 */
function stripProto(root: unknown): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v !== "object" || v === null) continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push(v[i]);
      continue;
    }
    const o = v as Record<string, unknown>;
    if (Object.hasOwn(o, "__proto__")) delete o["__proto__"];
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) stack.push(o[keys[i]]);
  }
}

// ---------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------

/**
 * Compiles a schema into a JSON stringify function.
 *
 * The compiled function assumes input matches the schema (validate at
 * boundaries, not inside serializers). Use `validate()` separately if the
 * input is untrusted.
 */
export function stringify<S extends Schema>(schema: S): (value: Infer<S>) => string {
  const buf = createBuffer();
  emitRef(buf, "_esc", escapeJsonString);
  emitRef(buf, "_num", numberToJson);
  emitRef(buf, "_js", JSON.stringify);

  emit(buf, "return function stringify(v) {");
  buf.indent++;
  emit(buf, "return " + walkStringify(buf, schema, "v") + ";");
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(value: Infer<S>) => string>(buf);
}

/**
 * Walk the schema and return a JS expression string that serializes `accessor`
 * to a JSON string fragment.
 */
function walkStringify(buf: CodeBuffer, schema: Schema, accessor: string): string {
  switch (schema.kind) {
    case "string":
      return `_esc(${accessor})`;
    case "number":
    case "integer":
      return `_num(${accessor})`;
    case "boolean":
      return `(${accessor} ? "true" : "false")`;
    case "null":
      return `"null"`;
    case "literal":
      return JSON.stringify(JSON.stringify(schema.meta.value));
    case "enum":
      return `(typeof ${accessor} === "string" ? _esc(${accessor}) : _num(${accessor}))`;
    case "object":
      return walkStringifyObject(buf, schema.meta.properties, accessor);
    case "array":
      return walkStringifyArray(buf, schema, accessor);
    case "tuple":
      return walkStringifyTuple(buf, schema, accessor);
    case "record":
      return walkStringifyRecord(buf, schema, accessor);
    case "union":
      return walkStringifyUnion(buf, schema, accessor);
    case "optional":
      return `(${accessor} === undefined ? "null" : ${walkStringify(buf, schema.meta.inner, accessor)})`;
    case "nullable":
      return `(${accessor} === null ? "null" : ${walkStringify(buf, schema.meta.inner, accessor)})`;
    case "unknown":
    case "allOf":
    case "not":
    case "conditional":
      // No single shape to specialize on — the value is serialized as-is
      return `_js(${accessor})`;
    default:
      unreachable(schema);
  }
}

function walkStringifyObject(
  buf: CodeBuffer,
  props: Record<string, Schema>,
  accessor: string,
): string {
  const keys = Object.keys(props);
  if (keys.length === 0) return `"{}"`;

  const hasOptional = keys.some((k) => props[k].kind === "optional");

  // All-required path: return a pure expression — no helper function needed.
  // This is critical for inlining into array loops: the expression is spliced
  // directly into the loop body, eliminating per-element function dispatch.
  if (!hasOptional) {
    let expr = '"{" + ';
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const childAccessor = `${accessor}[${JSON.stringify(key)}]`;
      const valExpr = walkStringify(buf, props[key], childAccessor);
      const keyFrag = JSON.stringify(JSON.stringify(key) + ":");
      if (i === 0) {
        expr += `${keyFrag} + ${valExpr}`;
      } else {
        expr += ` + "," + ${keyFrag} + ${valExpr}`;
      }
    }
    expr += ' + "}"';
    return `(${expr})`;
  }

  // Optional fields require conditional inclusion — use a helper function
  // because the logic can't be expressed as a single expression.
  const childExprs: { key: string; expr: string; optional: boolean }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = props[key];
    const childAccessor = `o[${JSON.stringify(key)}]`;
    if (child.kind === "optional") {
      childExprs.push({
        key,
        expr: walkStringify(buf, child.meta.inner, childAccessor),
        optional: true,
      });
    } else {
      childExprs.push({ key, expr: walkStringify(buf, child, childAccessor), optional: false });
    }
  }

  const helperName = freshVar(buf);
  let body = `function ${helperName}(o) {\n`;
  body += '  var s = "{";\n';
  body += "  var first = true;\n";
  for (let i = 0; i < childExprs.length; i++) {
    const { key, expr, optional } = childExprs[i];
    const keyFragment = JSON.stringify(key) + ":";
    if (optional) {
      // Names like `toString` would read an inherited member when absent.
      const own = key in Object.prototype ? `Object.hasOwn(o, ${JSON.stringify(key)}) && ` : "";
      body += `  if (${own}o[${JSON.stringify(key)}] !== undefined) {\n`;
      body += `    s += (first ? "" : ",") + ${JSON.stringify(keyFragment)} + ${expr};\n`;
      body += "    first = false;\n";
      body += "  }\n";
    } else {
      body += `  s += (first ? "" : ",") + ${JSON.stringify(keyFragment)} + ${expr};\n`;
      body += "  first = false;\n";
    }
  }
  body += '  return s + "}";\n';
  body += "}";

  const fn = compileHelper(buf, body);
  emitRef(buf, helperName, fn);
  return `${helperName}(${accessor})`;
}

function walkStringifyArray(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
): string {
  const helperName = freshVar(buf);
  const elemExpr = walkStringify(buf, schema.meta.items, "a[i]");

  // V8's cons-string += is the fastest JS string building approach for this
  // workload. All alternatives benchmarked slower for 100-element arrays:
  //
  //   concat (current):               4.7 µs — baseline
  //   chunk array + join (new alloc):  8.9 µs — 1.9x slower
  //   reusable array + push + join:    9.8 µs — 2.1x slower
  //   reusable array + index + join:   9.0 µs — 1.9x slower
  //   Buffer.allocUnsafe + write:     17.0 µs — 3.6x slower
  //
  // Native JSON.stringify: 4.1 µs — wins via C++ SeqOneByteString that
  // bypasses JS string allocation entirely. Not matchable from JS.
  const fn = compileHelper<Function>(
    buf,
    `function ${helperName}(a) {
  var n = a.length;
  if (n === 0) return "[]";
  var i = 0;
  var s = "[" + ${elemExpr};
  for (i = 1; i < n; i++) s += "," + ${elemExpr};
  return s + "]";
}`,
  );
  emitRef(buf, helperName, fn);
  return `${helperName}(${accessor})`;
}

function walkStringifyTuple(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "tuple" },
  accessor: string,
): string {
  const items = schema.meta.items;
  if (items.length === 0) return `"[]"`;

  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const prefix = i === 0 ? '"[" + ' : ' + "," + ';
    parts.push(prefix + walkStringify(buf, items[i], `${accessor}[${i}]`));
  }
  return "(" + parts.join("") + ' + "]")';
}

function walkStringifyRecord(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  accessor: string,
): string {
  const helperName = freshVar(buf);
  const valExpr = walkStringify(buf, schema.meta.values, "o[k]");

  // for...in avoids Object.keys() array allocation on the hot path.
  // Object.hasOwn guard prevents inherited/polluted prototype keys from leaking.
  const fn = compileHelper<Function>(
    buf,
    `function ${helperName}(o) {
  var s = "{", first = 1;
  for (var k in o) { if (!Object.hasOwn(o, k)) continue; if (first) first = 0; else s += ","; s += _esc(k) + ":" + ${valExpr}; }
  return s === "{" ? "{}" : s + "}";
}`,
  );
  emitRef(buf, helperName, fn);
  return `${helperName}(${accessor})`;
}

function walkStringifyUnion(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "union" },
  accessor: string,
): string {
  const variants = schema.meta.variants;
  const discriminant = findDiscriminant(variants);
  const helperName = freshVar(buf);
  // Input that matches no variant is a caller bug (stringify assumes valid
  // input) — fail loudly instead of emitting garbage.
  const noMatch = '  throw new TypeError("value does not match any union variant");\n}';

  if (discriminant !== null) {
    let body = `function ${helperName}(v) {\n  switch (v[${JSON.stringify(discriminant)}]) {\n`;
    for (let i = 0; i < variants.length; i++) {
      // Every variant is an object — guaranteed by findDiscriminant.
      const obj = variants[i] as Schema & { readonly kind: "object" };
      // Literal values are passed by reference, never interpolated as source.
      const lit = emitRef(buf, freshVar(buf), obj.meta.properties[discriminant].meta.value);
      body += `    case ${lit}: return ${walkStringify(buf, obj, "v")};\n`;
    }
    body += "  }\n" + noMatch;
    const fn = compileHelper<Function>(buf, body);
    emitRef(buf, helperName, fn);
    return `${helperName}(${accessor})`;
  }

  // General dispatch. A variant whose runtime types (typeof tags) are disjoint
  // from every other variant's is selected by a cheap type check. Overlapping
  // variants (two objects, tuple vs array, literal vs string, ...) are selected
  // by their full validator in declaration order — the same "first variant
  // that validates" rule `validate` uses.
  const tags = variants.map(typeTags);
  let body = `function ${helperName}(v) {\n`;
  for (let i = 0; i < variants.length; i++) {
    let overlaps = false;
    for (let j = 0; j < variants.length; j++) {
      if (j !== i && tags[j].some((t: Tag) => tags[i].includes(t))) overlaps = true;
    }
    const check = overlaps
      ? `${emitRef(buf, freshVar(buf), validate(variants[i]))}(v)[0]`
      : (typeCheckExpr(variants[i], "v") ?? tags[i].map((t: Tag) => TAG_CHECKS[t]).join(" || "));
    body += `  if (${check}) return ${walkStringify(buf, variants[i], "v")};\n`;
  }
  body += noMatch;
  const fn = compileHelper<Function>(buf, body);
  emitRef(buf, helperName, fn);
  return `${helperName}(${accessor})`;
}

type Tag = "string" | "number" | "boolean" | "null" | "undefined" | "array" | "object";

const TAG_CHECKS: Record<Tag, string> = {
  string: '(typeof v === "string")',
  number: '(typeof v === "number")',
  boolean: '(typeof v === "boolean")',
  null: "(v === null)",
  undefined: "(v === undefined)",
  array: "Array.isArray(v)",
  object: '(typeof v === "object" && v !== null && !Array.isArray(v))',
};

function valueTag(x: string | number | boolean | null): Tag {
  return x === null ? "null" : (typeof x as Tag);
}

/** Runtime type tags that a value valid for `schema` can carry. */
function typeTags(schema: Schema): Tag[] {
  switch (schema.kind) {
    case "string":
    case "boolean":
    case "null":
      return [schema.kind];
    case "number":
    case "integer":
      return ["number"];
    case "literal":
      return [valueTag(schema.meta.value)];
    case "enum":
      return (schema.meta.values as (string | number)[]).map(valueTag);
    case "object":
    case "record":
      return ["object"];
    case "array":
    case "tuple":
      return ["array"];
    case "union":
      return (schema.meta.variants as Schema[]).flatMap(typeTags);
    case "optional":
      return [...typeTags(schema.meta.inner), "undefined"];
    case "nullable":
      return [...typeTags(schema.meta.inner), "null"];
    case "unknown":
    case "allOf":
    case "not":
    case "conditional":
      // Conservative: may hold any JSON type, so dispatch by full validator
      return ["string", "number", "boolean", "null", "array", "object"];
    default:
      unreachable(schema);
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * Compiles a schema into a JSON parse function.
 *
 * Uses the safe `parse` from JSON module (returns undefined on invalid JSON,
 * never throws). Validates the result inline. Returns `Result<T, SchemaError>`.
 */
export function parse<S extends Schema>(
  schema: S,
): (json: string) => Result<Infer<S>, SchemaError> {
  const buf = createBuffer();
  emitStandardRefs(buf, ok, err);
  emitRef(buf, "_jp", jsonParse);
  emitRef(buf, "_strip", stripProto);

  emit(buf, "return function parse(json) {");
  buf.indent++;
  // jsonParse returns undefined on invalid JSON — no try/catch needed
  emit(buf, "var v = _jp(json);");
  emit(buf, 'if (v === undefined) return _err(_me("", "valid JSON", json));');
  // Cheap pre-check on the raw text. A backslash-u escape can spell the key
  // without the literal token (e.g. "__proto__"), so any `\u` also
  // triggers the walk.
  emit(buf, 'if (json.indexOf("__proto__") !== -1 || json.indexOf("\\\\u") !== -1) _strip(v);');
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(json: string) => Result<Infer<S>, SchemaError>>(buf);
}
