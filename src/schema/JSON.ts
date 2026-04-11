/**
 * JSON — code-generated JSON serializers and parsers from Schema definitions.
 *
 * `stringify(schema)` compiles a schema into a function that serializes typed
 * values to JSON strings without `JSON.stringify` — it knows the exact shape
 * at compile time, so it pre-computes key fragments and avoids key enumeration.
 *
 * `parse(schema)` compiles a schema into a function that parses a JSON string
 * and validates the result in one pass, returning `Result<T, SchemaError>`.
 *
 * When to use: hot-path serialization/deserialization where the schema is known
 * at init time. For cold-path or ad-hoc JSON, use the standard `JSON` module.
 *
 * Design tradeoffs:
 *   stringify: generated string concatenation with pre-computed key fragments
 *   beats JSON.stringify for known shapes because it avoids key enumeration,
 *   toJSON protocol, and replacer overhead. The `escStr` helper handles string
 *   escaping — short strings use a charCode loop, long strings delegate to
 *   `JSON.stringify` (which is SIMD-accelerated in V8 for raw string escaping).
 *
 *   parse: uses native `JSON.parse` (C++ in V8, unbeatable for raw parsing)
 *   then validates inline — combining parse + validate avoids double traversal.
 *
 * @example
 * ```ts
 * import * as S from "vjuga/schema/Schema";
 * import * as SJ from "vjuga/schema/JSON";
 * const User = S.object({ id: S.integer(), name: S.string() });
 * const toJson = SJ.stringify(User);
 * const fromJson = SJ.parse(User);
 * toJson({ id: 1, name: "Alice" }); // '{"id":1,"name":"Alice"}'
 * fromJson('{"id":1,"name":"Alice"}'); // [true, { id: 1, name: "Alice" }]
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import { stripDangerousKeys } from "../JSON.js";
import type { Schema, Infer } from "./Schema.js";
import type { SchemaError } from "./Validate.js";
import { emitStandardRefs, emitValidation } from "./Validate.js";
import { findDiscriminant } from "./Schema.js";
import {
  type CodeBuffer,
  createBuffer,
  emit,
  emitRef,
  freshVar,
  compileFunction,
  compileHelper,
} from "./Codegen.js";

// ---------------------------------------------------------------------------
// String escaping
// ---------------------------------------------------------------------------

// Pre-computed escape table for control characters (0x00-0x1f)
const ESCAPE_TABLE: string[] = [];
for (let i = 0; i < 32; i++) {
  ESCAPE_TABLE[i] = "\\u" + i.toString(16).padStart(4, "0");
}
ESCAPE_TABLE[0x08] = "\\b";
ESCAPE_TABLE[0x09] = "\\t";
ESCAPE_TABLE[0x0a] = "\\n";
ESCAPE_TABLE[0x0c] = "\\f";
ESCAPE_TABLE[0x0d] = "\\r";

/**
 * Escape a string for JSON output. Adds surrounding quotes.
 * Short strings (<128 chars): manual charCode scan (avoids JSON.stringify overhead).
 * Long strings: delegate to JSON.stringify (V8 SIMD-accelerated).
 */
function escStr(s: string): string {
  const len = s.length;
  if (len < 128) {
    let out = '"';
    let last = 0;
    for (let i = 0; i < len; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        // "
        out += s.slice(last, i) + '\\"';
        last = i + 1;
      } else if (c === 0x5c) {
        // backslash
        out += s.slice(last, i) + "\\\\";
        last = i + 1;
      } else if (c < 0x20) {
        // control chars
        out += s.slice(last, i) + ESCAPE_TABLE[c];
        last = i + 1;
      }
    }
    if (last === 0) return '"' + s + '"';
    return out + s.slice(last) + '"';
  }
  return JSON.stringify(s);
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
  emitRef(buf, "_esc", escStr);

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
      return `("" + ${accessor})`;
    case "boolean":
      return `(${accessor} ? "true" : "false")`;
    case "null":
      return `"null"`;
    case "literal":
      return JSON.stringify(JSON.stringify(schema.meta.value));
    case "enum":
      return `(typeof ${accessor} === "string" ? _esc(${accessor}) : "" + ${accessor})`;
    case "object":
      return walkStringifyObject(buf, schema, accessor);
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
    /* c8 ignore next 3 — exhaustive check; unreachable when all schema kinds are handled */
    default: {
      const _exhaustive: never = schema;
      throw new Error("Unknown schema kind: " + (_exhaustive as Schema).kind);
    }
  }
}

function walkStringifyObject(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  accessor: string,
): string {
  const props = schema.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);
  if (keys.length === 0) return `"{}"`;

  const hasOptional = keys.some((k) => props[k].kind === "optional");

  // Walk children first to collect any refs they add
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

  if (hasOptional) {
    body += '  var s = "{";\n';
    body += "  var first = true;\n";
    for (let i = 0; i < childExprs.length; i++) {
      const { key, expr, optional } = childExprs[i];
      const keyFragment = JSON.stringify(key) + ":";
      if (optional) {
        body += `  if (o[${JSON.stringify(key)}] !== undefined) {\n`;
        body += `    s += (first ? "" : ",") + ${JSON.stringify(keyFragment)} + ${expr};\n`;
        body += "    first = false;\n";
        body += "  }\n";
      } else {
        body += `  s += (first ? "" : ",") + ${JSON.stringify(keyFragment)} + ${expr};\n`;
        body += "  first = false;\n";
      }
    }
    body += '  return s + "}";\n';
  } else {
    body += "  return ";
    for (let i = 0; i < childExprs.length; i++) {
      const { key, expr } = childExprs[i];
      if (i === 0) {
        body += `"{" + ${JSON.stringify(JSON.stringify(key) + ":")} + ${expr}`;
      } else {
        body += ` + "," + ${JSON.stringify(JSON.stringify(key) + ":")} + ${expr}`;
      }
    }
    body += ' + "}";\n';
  }
  body += "}";

  const fn = compileHelper<Function>(buf, body);
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

  const fn = compileHelper<Function>(
    buf,
    `function ${helperName}(a) {
  var n = a.length;
  if (n === 0) return "[]";
  var s = "[";
  for (var i = 0; i < n; i++) { if (i > 0) s += ","; s += ${elemExpr}; }
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
    parts.push(prefix + walkStringify(buf, items[i] as Schema, `${accessor}[${i}]`));
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

  const fn = compileHelper<Function>(
    buf,
    `function ${helperName}(o) {
  var keys = Object.keys(o);
  var n = keys.length;
  if (n === 0) return "{}";
  var s = "{";
  for (var i = 0; i < n; i++) { var k = keys[i]; if (i > 0) s += ","; s += _esc(k) + ":" + ${valExpr}; }
  return s + "}";
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
  const variants = schema.meta.variants as readonly Schema[];
  const discriminant = findDiscriminant(variants);

  if (discriminant !== null) {
    const helperName = freshVar(buf);
    let body = `function ${helperName}(v) {\n  switch (v[${JSON.stringify(discriminant)}]) {\n`;
    for (let i = 0; i < variants.length; i++) {
      const obj = variants[i] as Schema & { kind: "object" };
      const litSchema = obj.meta.properties[discriminant] as Schema & { kind: "literal" };
      body += `    case ${JSON.stringify(litSchema.meta.value)}: return ${walkStringify(buf, obj, "v")};\n`;
    }
    body += '    default: return "{}";\n  }\n}';
    const fn = compileHelper<Function>(buf, body);
    emitRef(buf, helperName, fn);
    return `${helperName}(${accessor})`;
  }

  // General: typeof dispatch
  const helperName = freshVar(buf);
  let body = `function ${helperName}(v) {\n`;
  for (let i = 0; i < variants.length; i++) {
    const check = getTypeCheck(variants[i], "v");
    if (check !== null) {
      body += `  if (${check}) return ${walkStringify(buf, variants[i], "v")};\n`;
    }
  }
  body += "  return JSON.stringify(v);\n}";
  const fn = compileHelper<Function>(buf, body);
  emitRef(buf, helperName, fn);
  return `${helperName}(${accessor})`;
}

function getTypeCheck(schema: Schema, accessor: string): string | null {
  switch (schema.kind) {
    case "string":
      return `typeof ${accessor} === "string"`;
    case "number":
    case "integer":
      return `typeof ${accessor} === "number"`;
    case "boolean":
      return `typeof ${accessor} === "boolean"`;
    case "null":
      return `${accessor} === null`;
    case "array":
    case "tuple":
      return `Array.isArray(${accessor})`;
    case "object":
    case "record":
      return `typeof ${accessor} === "object" && ${accessor} !== null && !Array.isArray(${accessor})`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * Compiles a schema into a JSON parse function.
 *
 * Uses native `JSON.parse` (C++ in V8) for raw parsing, then validates the
 * result inline. Returns `Result<T, SchemaError>` — never throws.
 */
export function parse<S extends Schema>(
  schema: S,
): (json: string) => Result<Infer<S>, SchemaError> {
  const buf = createBuffer();
  emitStandardRefs(buf, ok, err);
  emitRef(buf, "_strip", stripDangerousKeys);

  emit(buf, "return function parse(json) {");
  buf.indent++;
  emit(buf, "var v;");
  emit(
    buf,
    'try { v = JSON.parse(json); } catch (_) { return _err(_me("", "valid JSON", json)); }',
  );
  emit(
    buf,
    'if (json.indexOf("__proto__") !== -1 || json.indexOf("constructor") !== -1) _strip(v);',
  );
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(json: string) => Result<Infer<S>, SchemaError>>(buf);
}
