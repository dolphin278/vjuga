/**
 * TOON — code-generated Token-Oriented Object Notation serializers and parsers.
 *
 * TOON is a compact, human-readable format designed for LLM token efficiency.
 * It uses indentation-based syntax, eliminates unnecessary quotes, and supports
 * tabular arrays for uniform object data.
 *
 * `stringify(schema)` compiles a schema-specific TOON serializer via
 * `new Function`. Format selection (inline arrays, tabular arrays, expanded
 * objects) is decided at compile time based on schema shape.
 *
 * `parse(schema)` compiles a schema-specific TOON parser via `new Function`.
 * Default mode expects fields in schema-declared order (fast). With
 * `flexibleOrder: true`, fields may appear in any order.
 *
 * Spec conformance: TOON 3.0 (2025-11-24). Subset: no key folding, no path
 * expansion, default delimiter (comma).
 *
 * @example
 * ```ts
 * import * as S from "vjuga/schema/Schema";
 * import * as ST from "vjuga/schema/TOON";
 * const User = S.object({ id: S.integer(), name: S.string() });
 * const toToon = ST.stringify(User);
 * const fromToon = ST.parse(User);
 * toToon({ id: 1, name: "Alice" }); // "id: 1\nname: Alice"
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import type { Schema, Infer } from "./Schema.js";
import { type SchemaError, makeError, emitStandardRefs } from "./Validate.js";
import { isPrimitive } from "./Schema.js";
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
// TOON value quoting helpers (captured by generated code)
// ---------------------------------------------------------------------------

// Must quote if: empty, leading/trailing whitespace, equals true/false/null,
// numeric-like, contains : " \ [ ] { } or control chars, or starts with -
const NEEDS_QUOTE_RE =
  /^$|^\s|\s$|^(true|false|null)$|^-?\d+(\.\d+)?(e[+-]?\d+)?$|^0\d|[:"\\[\]{}]|[\x00-\x1f]|^-$/;

function toonQuote(s: string, delim: string): string {
  if (NEEDS_QUOTE_RE.test(s) || s.indexOf(delim) !== -1) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
  }
  return s;
}

function toonUnquote(s: string): string {
  if (s.length >= 2 && s.charCodeAt(0) === 0x22 && s.charCodeAt(s.length - 1) === 0x22) {
    let out = "";
    for (let i = 1; i < s.length - 1; i++) {
      if (s.charCodeAt(i) === 0x5c && i + 1 < s.length - 1) {
        const next = s.charCodeAt(i + 1);
        if (next === 0x5c) { out += "\\"; i++; }
        else if (next === 0x22) { out += '"'; i++; }
        else if (next === 0x6e) { out += "\n"; i++; }
        else if (next === 0x72) { out += "\r"; i++; }
        else if (next === 0x74) { out += "\t"; i++; }
        else { out += s[i]; }
      } else {
        out += s[i];
      }
    }
    return out;
  }
  return s;
}

/** Canonicalize number per TOON spec. NaN/Infinity → null. */
function canonicalNumber(n: number): string {
  if (n !== n || !isFinite(n)) return "null";
  const s = "" + n;
  if (s.indexOf("e") === -1 && s.indexOf("E") === -1) return s;
  return n.toFixed(20).replace(/\.?0+$/, "");
}

/** Split a TOON inline value list by delimiter, respecting quotes. */
function splitByDelimiter(s: string, delim: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      current += c;
      if (c === "\\" && i + 1 < s.length) { current += s[++i]; }
      else if (c === '"') inQuote = false;
    } else if (c === '"') {
      inQuote = true;
      current += c;
    } else if (c === delim) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/** Parse a TOON primitive value string into a JS value. */
function parsePrimValue(raw: string, kind: string): unknown {
  const s = toonUnquote(raw);
  switch (kind) {
    case "string": return s;
    case "number": { const n = +raw; return (raw === "" || n !== n) ? undefined : n; }
    case "integer": { const n = +raw; return Number.isSafeInteger(n) ? n : undefined; }
    case "boolean": return raw === "true" ? true : raw === "false" ? false : undefined;
    case "null": return raw === "null" ? null : undefined;
    default: return s;
  }
}

/** Detect if array(object({...all primitives})) → tabular format. */
function isTabular(schema: Schema): boolean {
  if (schema.kind !== "array") return false;
  const items = schema.meta.items as Schema;
  if (items.kind !== "object") return false;
  const props = items.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    if (!isPrimitive(props[keys[i]])) return false;
  }
  return keys.length > 0;
}

// ---------------------------------------------------------------------------
// stringify (codegen)
// ---------------------------------------------------------------------------

export interface ToonStringifyOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
  readonly trusted?: boolean;
}

/**
 * Compiles a schema into a TOON stringify function via `new Function`.
 */
export function stringify<S extends Schema>(
  schema: S,
  options?: ToonStringifyOptions,
): (value: Infer<S>) => string {
  const indent = options?.indent ?? 2;
  const delim = options?.delimiter ?? ",";

  const buf = createBuffer();
  emitRef(buf, "_q", toonQuote);
  emitRef(buf, "_cn", canonicalNumber);
  emitRef(buf, "_delim", delim);

  emit(buf, "return function toonStringify(v) {");
  buf.indent++;
  emitToonStringify(buf, schema, "v", "", 0, indent, delim, true);
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(value: Infer<S>) => string>(buf) as unknown as (value: Infer<S>) => string;
}

function emitToonStringify(
  buf: CodeBuffer,
  schema: Schema,
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
  isRoot: boolean,
): void {
  switch (schema.kind) {
    case "string":
      emitPrimStringify(buf, `_q(${accessor}, _delim)`, key, depth, indent, isRoot);
      break;
    case "number": case "integer":
      emitPrimStringify(buf, `_cn(${accessor})`, key, depth, indent, isRoot);
      break;
    case "boolean":
      emitPrimStringify(buf, `(${accessor} ? "true" : "false")`, key, depth, indent, isRoot);
      break;
    case "null":
      emitPrimStringify(buf, `"null"`, key, depth, indent, isRoot);
      break;
    case "literal":
    case "enum":
      emitPrimStringify(buf, `(typeof ${accessor} === "string" ? _q(${accessor}, _delim) : typeof ${accessor} === "number" ? _cn(${accessor}) : ${accessor} === null ? "null" : ${accessor} ? "true" : "false")`, key, depth, indent, isRoot);
      break;
    case "object":
      emitObjectStringify(buf, schema, accessor, key, depth, indent, delim, isRoot);
      break;
    case "array":
      emitArrayStringify(buf, schema, accessor, key, depth, indent, delim);
      break;
    case "tuple":
      emitTupleStringify(buf, schema, accessor, key, depth, indent, delim);
      break;
    case "record":
      emitRecordStringify(buf, schema, accessor, key, depth, indent, delim, isRoot);
      break;
    case "union":
      emitUnionStringify(buf, schema, accessor, key, depth, indent, delim, isRoot);
      break;
    case "optional":
      if (key !== "") {
        // In object context: skip if undefined
        emit(buf, `if (${accessor} !== undefined) {`);
        buf.indent++;
        emitToonStringify(buf, schema.meta.inner, accessor, key, depth, indent, delim, false);
        buf.indent--;
        emit(buf, "}");
      } else {
        emitToonStringify(buf, schema.meta.inner, accessor, key, depth, indent, delim, isRoot);
      }
      break;
    case "nullable":
      emit(buf, `if (${accessor} === null) {`);
      buf.indent++;
      emitPrimStringify(buf, `"null"`, key, depth, indent, isRoot);
      buf.indent--;
      emit(buf, "} else {");
      buf.indent++;
      emitToonStringify(buf, schema.meta.inner, accessor, key, depth, indent, delim, isRoot);
      buf.indent--;
      emit(buf, "}");
      break;
    default: {
      const _exhaustive: never = schema;
      throw new Error("Unknown schema kind: " + (_exhaustive as Schema).kind);
    }
  }
}

function emitPrimStringify(
  buf: CodeBuffer,
  valueExpr: string,
  key: string,
  depth: number,
  indent: number,
  isRoot: boolean,
): void {
  if (isRoot && key === "") {
    emit(buf, `return ${valueExpr};`);
  } else {
    const pad = JSON.stringify(" ".repeat(depth * indent));
    emit(buf, `s += ${pad} + ${JSON.stringify(key + ": ")} + ${valueExpr} + "\\n";`);
  }
}

function emitObjectStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
  isRoot: boolean,
): void {
  const keys = Object.keys(schema.meta.properties);

  if (!isRoot || key !== "") {
    // Nested object: "key:\n" then children at depth+1
    const pad = JSON.stringify(" ".repeat(depth * indent));
    emit(buf, `s += ${pad} + ${JSON.stringify(key + ":\n")};`);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const child = schema.meta.properties[k] as Schema;
      emitToonStringify(buf, child, `${accessor}[${JSON.stringify(k)}]`, k, depth + 1, indent, delim, false);
    }
  } else {
    // Root object: key: value lines at depth 0
    emit(buf, 'var s = "";');
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const child = schema.meta.properties[k] as Schema;
      emitToonStringify(buf, child, `${accessor}[${JSON.stringify(k)}]`, k, depth, indent, delim, false);
    }
    // Remove trailing newline
    emit(buf, "return s.slice(0, -1);");
  }
}

function emitArrayStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
): void {
  const items = schema.meta.items as Schema;
  const pad = JSON.stringify(" ".repeat(depth * indent));
  const childPad = JSON.stringify(" ".repeat((depth + 1) * indent));
  const header = key !== "" ? key : "";

  if (isTabular(schema)) {
    emitTabularStringify(buf, schema, accessor, key, depth, indent, delim);
    return;
  }

  if (isPrimitive(items)) {
    // Inline format: key[N]: v1,v2,v3
    const helperName = freshVar(buf);
    const elemExpr = emitInlineValueExpr(items);
    const fn = compileHelper<Function>(buf, `function ${helperName}(a) {
  var parts = [];
  for (var i = 0; i < a.length; i++) parts.push(${elemExpr});
  return parts.join(_delim);
}`);
    emitRef(buf, helperName, fn);
    emit(buf, `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]: " + ${helperName}(${accessor}) + "\\n";`);
    return;
  }

  // Expanded format
  emit(buf, `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]:\\n";`);
  const idx = freshVar(buf);
  emit(buf, `for (var ${idx} = 0; ${idx} < ${accessor}.length; ${idx}++) {`);
  buf.indent++;
  emitExpandedItem(buf, items, `${accessor}[${idx}]`, depth + 1, indent, delim);
  buf.indent--;
  emit(buf, "}");
}

function emitTabularStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
): void {
  const objSchema = schema.meta.items as Schema & { kind: "object" };
  const fields = Object.keys(objSchema.meta.properties);
  const pad = JSON.stringify(" ".repeat(depth * indent));
  const childPad = JSON.stringify(" ".repeat((depth + 1) * indent));
  const header = key !== "" ? key : "";
  const fieldHeader = "{" + fields.join(delim) + "}";

  emit(buf, `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]${fieldHeader}:\\n";`);

  // Build a row-serializer helper
  const helperName = freshVar(buf);
  const cellExprs = fields.map((f) => {
    const child = objSchema.meta.properties[f] as Schema;
    const innerChild = child.kind === "optional" ? child.meta.inner : child;
    return emitInlineValueExpr(innerChild, `o[${JSON.stringify(f)}]`);
  });
  const fn = compileHelper<Function>(buf, `function ${helperName}(o) {
  return ${cellExprs.join(' + _delim + ')};
}`);
  emitRef(buf, helperName, fn);

  const idx = freshVar(buf);
  emit(buf, `for (var ${idx} = 0; ${idx} < ${accessor}.length; ${idx}++) {`);
  buf.indent++;
  emit(buf, `s += ${childPad} + ${helperName}(${accessor}[${idx}]) + "\\n";`);
  buf.indent--;
  emit(buf, "}");
}

function emitInlineValueExpr(schema: Schema, accessor = "a[i]"): string {
  if (schema.kind === "optional") {
    return `(${accessor} === undefined ? "" : ${emitInlineValueExpr(schema.meta.inner, accessor)})`;
  }
  if (schema.kind === "nullable") {
    return `(${accessor} === null ? "null" : ${emitInlineValueExpr(schema.meta.inner, accessor)})`;
  }
  switch (schema.kind) {
    case "string": return `_q(${accessor}, _delim)`;
    case "number": case "integer": return `_cn(${accessor})`;
    case "boolean": return `(${accessor} ? "true" : "false")`;
    case "null": return `"null"`;
    default: return `(typeof ${accessor} === "string" ? _q(${accessor}, _delim) : "" + ${accessor})`;
  }
}

function emitTupleStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "tuple" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
): void {
  const items = schema.meta.items;
  const pad = JSON.stringify(" ".repeat(depth * indent));
  const header = key !== "" ? key : "";

  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    parts.push(emitInlineValueExpr(items[i] as Schema, `${accessor}[${i}]`));
  }
  const joined = parts.length > 0 ? parts.join(` + _delim + `) : '""';
  emit(buf, `s += ${pad} + ${JSON.stringify(header)} + "[${items.length}]: " + ${joined} + "\\n";`);
}

function emitRecordStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
  isRoot: boolean,
): void {
  const pad = JSON.stringify(" ".repeat(depth * indent));

  if (!isRoot || key !== "") {
    emit(buf, `s += ${pad} + ${JSON.stringify(key + ":\n")};`);
  } else {
    emit(buf, 'var s = "";');
  }

  const innerPad = JSON.stringify(" ".repeat(((isRoot && key === "") ? depth : depth + 1) * indent));
  const kv = freshVar(buf);
  const keys = freshVar(buf);
  emit(buf, `var ${keys} = Object.keys(${accessor});`);
  emit(buf, `for (var ${kv} = 0; ${kv} < ${keys}.length; ${kv}++) {`);
  buf.indent++;
  const valExpr = emitInlineValueExpr(schema.meta.values, `${accessor}[${keys}[${kv}]]`);
  emit(buf, `s += ${innerPad} + ${keys}[${kv}] + ": " + ${valExpr} + "\\n";`);
  buf.indent--;
  emit(buf, "}");

  if (isRoot && key === "") {
    emit(buf, "return s.slice(0, -1);");
  }
}

function emitUnionStringify(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "union" },
  accessor: string,
  key: string,
  depth: number,
  indent: number,
  delim: string,
  isRoot: boolean,
): void {
  const variants = schema.meta.variants as readonly Schema[];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const check = getSimpleTypeCheck(v, accessor);
    if (check !== null && i < variants.length - 1) {
      emit(buf, `if (${check}) {`);
      buf.indent++;
      emitToonStringify(buf, v, accessor, key, depth, indent, delim, isRoot);
      buf.indent--;
      emit(buf, "} else {");
      buf.indent++;
    } else {
      emitToonStringify(buf, v, accessor, key, depth, indent, delim, isRoot);
    }
  }
  // Close the if/else chain
  for (let i = 0; i < variants.length - 1; i++) {
    const check = getSimpleTypeCheck(variants[i], accessor);
    if (check !== null) {
      buf.indent--;
      emit(buf, "}");
    }
  }
}

function emitExpandedItem(
  buf: CodeBuffer,
  schema: Schema,
  accessor: string,
  depth: number,
  indent: number,
  delim: string,
): void {
  const pad = JSON.stringify(" ".repeat(depth * indent));
  if (isPrimitive(schema)) {
    emit(buf, `s += ${pad} + "- " + ${emitInlineValueExpr(schema, accessor)} + "\\n";`);
  } else {
    // Complex item (object, etc.) — first field on hyphen line
    emit(buf, `s += ${pad} + "- " + "TODO\\n";`);
  }
}

function getSimpleTypeCheck(schema: Schema, accessor: string): string | null {
  switch (schema.kind) {
    case "string": return `typeof ${accessor} === "string"`;
    case "number": case "integer": return `typeof ${accessor} === "number"`;
    case "boolean": return `typeof ${accessor} === "boolean"`;
    case "null": return `${accessor} === null`;
    case "object": return `typeof ${accessor} === "object" && ${accessor} !== null`;
    case "array": return `Array.isArray(${accessor})`;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// parse (codegen)
// ---------------------------------------------------------------------------

export interface ToonParseOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
  readonly strict?: boolean;
  readonly flexibleOrder?: boolean;
}

/**
 * Compiles a schema into a TOON parse function via `new Function`.
 */
export function parse<S extends Schema>(
  schema: S,
  options?: ToonParseOptions,
): (toon: string) => Result<Infer<S>, SchemaError> {
  const indent = options?.indent ?? 2;
  const delim = options?.delimiter ?? ",";
  const flexible = options?.flexibleOrder ?? false;

  const buf = createBuffer();
  emitStandardRefs(buf, ok, err);
  emitRef(buf, "_uq", toonUnquote);
  emitRef(buf, "_split", splitByDelimiter);
  emitRef(buf, "_prim", parsePrimValue);
  emitRef(buf, "_delim", delim);

  emit(buf, "return function toonParse(input) {");
  buf.indent++;
  emit(buf, 'var lines = input.split("\\n");');
  emit(buf, "while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();");
  emit(buf, "var li = 0;");

  emitToonParse(buf, schema, 0, '""', indent, delim, flexible);

  buf.indent--;
  emit(buf, "}");

  return compileFunction<(toon: string) => Result<Infer<S>, SchemaError>>(buf) as unknown as (toon: string) => Result<Infer<S>, SchemaError>;
}

function emitToonParse(
  buf: CodeBuffer,
  schema: Schema,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  flexible: boolean,
): void {
  switch (schema.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
    case "literal":
    case "enum":
      // Root primitive: entire line is the value
      if (depth === 0) {
        emitRootPrimitiveParse(buf, schema, pathExpr);
      }
      break;
    case "object":
      emitObjectParse(buf, schema, depth, pathExpr, indent, delim, flexible);
      break;
    case "array":
      // Root-level arrays are parsed via header matching
      // This case handles root array schemas; object-nested arrays
      // are handled by emitCompoundFieldParse → emitArrayHeaderParse
      emitRootArrayParse(buf, schema, depth, pathExpr, indent, delim);
      break;
    case "tuple":
      emitRootArrayParse(buf, schema, depth, pathExpr, indent, delim);
      break;
    case "record":
      emitRecordParse(buf, schema, depth, pathExpr, indent, delim);
      break;
    case "union":
      // For unions, parse as the first matching variant
      emitUnionParse(buf, schema, depth, pathExpr, indent, delim, flexible);
      break;
    case "optional":
      emitToonParse(buf, schema.meta.inner, depth, pathExpr, indent, delim, flexible);
      break;
    case "nullable":
      emitToonParse(buf, schema.meta.inner, depth, pathExpr, indent, delim, flexible);
      break;
    default: {
      const _exhaustive: never = schema;
      throw new Error("Unknown schema kind: " + (_exhaustive as Schema).kind);
    }
  }
}

function emitRootPrimitiveParse(
  buf: CodeBuffer,
  schema: Schema,
  pathExpr: string,
): void {
  emit(buf, "if (li >= lines.length) return _err(_me(" + pathExpr + ', "' + schema.kind + '", "end of input"));');
  emit(buf, "var raw = lines[li++].trim();");
  emitPrimitiveValueParse(buf, schema, "raw", pathExpr, "result");
  emit(buf, "return _ok(result);");
}

function emitPrimitiveValueParse(
  buf: CodeBuffer,
  schema: Schema,
  rawVar: string,
  pathExpr: string,
  resultVar: string,
): void {
  switch (schema.kind) {
    case "string":
      emit(buf, `var ${resultVar} = _uq(${rawVar});`);
      break;
    case "number":
      emit(buf, `var ${resultVar} = +${rawVar};`);
      emit(buf, `if (${rawVar} === "" || ${resultVar} !== ${resultVar}) return _err(_me(${pathExpr}, "number", ${rawVar}));`);
      break;
    case "integer":
      emit(buf, `var ${resultVar} = +${rawVar};`);
      emit(buf, `if (!_isSafe(${resultVar})) return _err(_me(${pathExpr}, "integer", ${rawVar}));`);
      break;
    case "boolean":
      emit(buf, `if (${rawVar} !== "true" && ${rawVar} !== "false") return _err(_me(${pathExpr}, "boolean", ${rawVar}));`);
      emit(buf, `var ${resultVar} = ${rawVar} === "true";`);
      break;
    case "null":
      emit(buf, `if (${rawVar} !== "null") return _err(_me(${pathExpr}, "null", ${rawVar}));`);
      emit(buf, `var ${resultVar} = null;`);
      break;
    case "literal": {
      const ref = freshVar(buf);
      emitRef(buf, ref, schema.meta.value);
      if (typeof schema.meta.value === "string") {
        emit(buf, `var ${resultVar} = _uq(${rawVar});`);
        emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, ${JSON.stringify("literal(" + JSON.stringify(schema.meta.value) + ")")}, ${rawVar}));`);
      } else if (typeof schema.meta.value === "number") {
        emit(buf, `var ${resultVar} = +${rawVar};`);
        emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, "literal(${schema.meta.value})", ${rawVar}));`);
      } else if (typeof schema.meta.value === "boolean") {
        emit(buf, `var ${resultVar} = ${rawVar} === "true";`);
        emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, "literal(${schema.meta.value})", ${rawVar}));`);
      } else {
        // null
        emit(buf, `if (${rawVar} !== "null") return _err(_me(${pathExpr}, "literal(null)", ${rawVar}));`);
        emit(buf, `var ${resultVar} = null;`);
      }
      break;
    }
    case "enum": {
      const primRef = freshVar(buf);
      emitRef(buf, primRef, parsePrimValue);
      const valuesRef = freshVar(buf);
      emitRef(buf, valuesRef, schema.meta.values);
      emit(buf, `var ${resultVar} = _prim(${rawVar}, "string");`);
      // Try number
      emit(buf, `var ${resultVar}_n = +${rawVar};`);
      emit(buf, `if (!isNaN(${resultVar}_n) && ${valuesRef}.indexOf(${resultVar}_n) !== -1) ${resultVar} = ${resultVar}_n;`);
      emit(buf, `else if (${valuesRef}.indexOf(${resultVar}) === -1) return _err(_me(${pathExpr}, "enum", ${rawVar}));`);
      break;
    }
    case "optional":
      if (schema.meta.inner.kind === "string") {
        emit(buf, `var ${resultVar} = _uq(${rawVar});`);
      } else {
        emitPrimitiveValueParse(buf, schema.meta.inner, rawVar, pathExpr, resultVar);
      }
      break;
    case "nullable":
      emit(buf, `var ${resultVar};`);
      emit(buf, `if (${rawVar} === "null") { ${resultVar} = null; } else {`);
      buf.indent++;
      const innerVar = freshVar(buf);
      emitPrimitiveValueParse(buf, schema.meta.inner, rawVar, pathExpr, innerVar);
      emit(buf, `${resultVar} = ${innerVar};`);
      buf.indent--;
      emit(buf, "}");
      break;
    default:
      emit(buf, `var ${resultVar} = _uq(${rawVar});`);
      break;
  }
}

function emitObjectParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  flexible: boolean,
): void {
  const keys = Object.keys(schema.meta.properties);
  const padStr = " ".repeat(depth * indent);
  const resultVar = freshVar(buf);

  emit(buf, `var ${resultVar} = {};`);

  if (flexible) {
    emitObjectParseFlexible(buf, schema, depth, pathExpr, indent, delim, resultVar);
  } else {
    // Schema-order parse
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const child = schema.meta.properties[key] as Schema;
      const innerChild = child.kind === "optional" ? child.meta.inner : child;
      const isOpt = child.kind === "optional";
      const keyPrefix = (depth === 0 ? "" : padStr) + key;

      if (isCompound(innerChild)) {
        // Nested or array: expect "key:" or "key[N]..."
        emitCompoundFieldParse(buf, innerChild, key, keyPrefix, depth, pathExpr, indent, delim, resultVar, isOpt, flexible);
      } else {
        // Primitive: expect "key: value"
        emitPrimitiveFieldParse(buf, innerChild, key, keyPrefix, depth, pathExpr, indent, resultVar, isOpt);
      }
    }
  }

  if (depth === 0) {
    emit(buf, `return _ok(${resultVar});`);
  }
}

function emitPrimitiveFieldParse(
  buf: CodeBuffer,
  schema: Schema,
  key: string,
  keyPrefix: string,
  depth: number,
  pathExpr: string,
  indent: number,
  resultVar: string,
  isOptional: boolean,
): void {
  const childPathExpr = pathExpr === '""' ? JSON.stringify(key) : JSON.stringify(JSON.parse(pathExpr) + "." + key);
  const expectedPrefix = keyPrefix + ": ";

  if (isOptional) {
    emit(buf, `if (li < lines.length && lines[li].startsWith(${JSON.stringify(expectedPrefix)})) {`);
    buf.indent++;
  } else {
    emit(buf, `if (li >= lines.length) return _err(_me(${childPathExpr}, "key '${key}'", "end of input"));`);
  }

  const rawVar = freshVar(buf);
  emit(buf, `var ${rawVar} = lines[li].slice(${expectedPrefix.length});`);

  if (!isOptional) {
    emit(buf, `if (!lines[li].startsWith(${JSON.stringify(expectedPrefix)})) return _err(_me(${childPathExpr}, "key '${key}'", lines[li]));`);
  }

  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimitiveValueParse(buf, schema, rawVar, childPathExpr, valVar);
  emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${valVar};`);

  if (isOptional) {
    buf.indent--;
    emit(buf, "}");
  }
}

function emitCompoundFieldParse(
  buf: CodeBuffer,
  schema: Schema,
  key: string,
  keyPrefix: string,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  resultVar: string,
  isOptional: boolean,
  flexible: boolean,
): void {
  const childPathExpr = pathExpr === '""' ? JSON.stringify(key) : JSON.stringify(JSON.parse(pathExpr) + "." + key);

  if (schema.kind === "array" || schema.kind === "tuple") {
    // Array/tuple: header on the line like "key[N]:" or "key[N]{fields}:"
    const headerPrefix = keyPrefix + "[";
    if (isOptional) {
      emit(buf, `if (li < lines.length && lines[li].startsWith(${JSON.stringify(headerPrefix)})) {`);
      buf.indent++;
    }
    emitArrayHeaderParse(buf, schema, key, keyPrefix, depth, childPathExpr, indent, delim, resultVar);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (schema.kind === "object") {
    // Nested object: "key:" on its own line
    const nestedLine = keyPrefix + ":";
    if (isOptional) {
      emit(buf, `if (li < lines.length && lines[li] === ${JSON.stringify(nestedLine)}) {`);
      buf.indent++;
    } else {
      emit(buf, `if (li >= lines.length || lines[li] !== ${JSON.stringify(nestedLine)}) return _err(_me(${childPathExpr}, "key '${key}'", li < lines.length ? lines[li] : "end of input"));`);
    }
    emit(buf, "li++;");
    // Parse nested object at depth+1
    const innerBuf = freshVar(buf);
    emit(buf, `var ${innerBuf} = {};`);
    const innerKeys = Object.keys(schema.meta.properties);
    for (let i = 0; i < innerKeys.length; i++) {
      const ik = innerKeys[i];
      const ic = schema.meta.properties[ik] as Schema;
      const iInner = ic.kind === "optional" ? ic.meta.inner : ic;
      const iOpt = ic.kind === "optional";
      const innerPad = " ".repeat((depth + 1) * indent);
      const iKeyPrefix = innerPad + ik;

      if (isCompound(iInner)) {
        emitCompoundFieldParse(buf, iInner, ik, iKeyPrefix, depth + 1, childPathExpr, indent, delim, innerBuf, iOpt, flexible);
      } else {
        emitPrimitiveFieldParse(buf, iInner, ik, iKeyPrefix, depth + 1, childPathExpr, indent, innerBuf, iOpt);
      }
    }
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${innerBuf};`);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (schema.kind === "record") {
    // Record: like a nested object but keys are dynamic
    const nestedLine = keyPrefix + ":";
    emit(buf, `if (li < lines.length && lines[li] === ${JSON.stringify(nestedLine)}) { li++; }`);
    emitRecordParse(buf, schema, depth + 1, childPathExpr, indent, delim);
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${freshVar(buf)}_rec;`);
  }
}

function emitArrayHeaderParse(
  buf: CodeBuffer,
  schema: Schema,
  key: string,
  keyPrefix: string,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  resultVar: string,
): void {
  const headerRegex = freshVar(buf);
  emitRef(buf, headerRegex, /^[^[]*\[(\d+)\](\{[^}]*\})?:\s*(.*)?$/);

  emit(buf, `var ${headerRegex}_m = lines[li].match(${headerRegex});`);
  emit(buf, `if (!${headerRegex}_m) return _err(_me(${pathExpr}, "array header", lines[li]));`);
  emit(buf, "li++;");
  emit(buf, `var ${headerRegex}_n = +${headerRegex}_m[1];`);
  emit(buf, `var ${headerRegex}_f = ${headerRegex}_m[2] || "";`);
  emit(buf, `var ${headerRegex}_d = (${headerRegex}_m[3] || "").trim();`);

  const arrVar = freshVar(buf);
  emit(buf, `var ${arrVar} = [];`);

  if (schema.kind === "array" && isTabular(schema)) {
    // Tabular parse
    const objSchema = schema.meta.items as Schema & { kind: "object" };
    const fields = Object.keys(objSchema.meta.properties);
    const childPad = " ".repeat((depth + 1) * indent);

    const idx = freshVar(buf);
    emit(buf, `for (var ${idx} = 0; ${idx} < ${headerRegex}_n; ${idx}++) {`);
    buf.indent++;
    emit(buf, `var row = lines[li++];`);
    emit(buf, `var cells = _split(row.startsWith(${JSON.stringify(childPad)}) ? row.slice(${childPad.length}) : row.trim(), _delim);`);
    emit(buf, `var obj = {};`);
    for (let j = 0; j < fields.length; j++) {
      const f = fields[j];
      const fc = objSchema.meta.properties[f] as Schema;
      const innerFc = fc.kind === "optional" ? fc.meta.inner : fc;
      const cellVar = freshVar(buf);
      emit(buf, `if (${j} < cells.length) {`);
      buf.indent++;
      emitPrimitiveValueParse(buf, innerFc, `cells[${j}]`, `${pathExpr} + ".${f}"`, cellVar);
      emit(buf, `obj[${JSON.stringify(f)}] = ${cellVar};`);
      buf.indent--;
      emit(buf, "}");
    }
    emit(buf, `${arrVar}.push(obj);`);
    buf.indent--;
    emit(buf, "}");
  } else if (schema.kind === "array" && isPrimitive(schema.meta.items as Schema)) {
    // Inline parse
    emit(buf, `if (${headerRegex}_d !== "") {`);
    buf.indent++;
    emit(buf, `var items = _split(${headerRegex}_d, _delim);`);
    const idx = freshVar(buf);
    emit(buf, `for (var ${idx} = 0; ${idx} < items.length; ${idx}++) {`);
    buf.indent++;
    const itemVar = freshVar(buf);
    emitPrimitiveValueParse(buf, schema.meta.items as Schema, `items[${idx}]`, pathExpr, itemVar);
    emit(buf, `${arrVar}.push(${itemVar});`);
    buf.indent--;
    emit(buf, "}");
    buf.indent--;
    emit(buf, "}");
  } else if (schema.kind === "tuple") {
    // Tuple inline parse
    emit(buf, `var items = _split(${headerRegex}_d, _delim);`);
    const items = schema.meta.items;
    for (let i = 0; i < items.length; i++) {
      const itemVar = freshVar(buf);
      emitPrimitiveValueParse(buf, items[i] as Schema, `items[${i}]`, pathExpr, itemVar);
      emit(buf, `${arrVar}.push(${itemVar});`);
    }
  }

  emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${arrVar};`);
}

function emitRecordParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
): void {
  const padStr = " ".repeat(depth * indent);
  const recVar = freshVar(buf) + "_rec";
  emit(buf, `var ${recVar} = {};`);

  emit(buf, `while (li < lines.length) {`);
  buf.indent++;
  const content = freshVar(buf);
  if (depth === 0) {
    emit(buf, `var ${content} = lines[li];`);
  } else {
    emit(buf, `if (!lines[li].startsWith(${JSON.stringify(padStr)})) break;`);
    emit(buf, `var ${content} = lines[li].slice(${padStr.length});`);
  }
  emit(buf, `if (${content}.startsWith(" ")) break;`);
  emit(buf, `var ci = ${content}.indexOf(": ");`);
  emit(buf, "if (ci === -1) break;");
  emit(buf, `var rk = ${content}.slice(0, ci);`);
  emit(buf, `var rv = ${content}.slice(ci + 2);`);
  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimitiveValueParse(buf, schema.meta.values, "rv", pathExpr, valVar);
  emit(buf, `${recVar}[rk] = ${valVar};`);
  buf.indent--;
  emit(buf, "}");

  // Return record — caller reads the variable
  if (depth === 0) {
    emit(buf, `return _ok(${recVar});`);
  }
}

function emitRootArrayParse(
  buf: CodeBuffer,
  schema: Schema,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
): void {
  // Root-level array: first line is the header "[N]:" or "[N]{fields}:"
  const resultVar = freshVar(buf);
  emit(buf, `var ${resultVar} = {};`);
  emitArrayHeaderParse(buf, schema, "", "", depth, pathExpr, indent, delim, resultVar);
  emit(buf, `return _ok(${resultVar}[""]);`);
}

function emitUnionParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "union" },
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  flexible: boolean,
): void {
  // Simple approach: try to parse as the first variant that makes sense
  // For now, just parse as the first variant
  const variants = schema.meta.variants as readonly Schema[];
  if (variants.length > 0) {
    emitToonParse(buf, variants[0], depth, pathExpr, indent, delim, flexible);
  }
}

function emitObjectParseFlexible(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  resultVar: string,
): void {
  const padStr = " ".repeat(depth * indent);
  const mapVar = freshVar(buf);

  // Collect all key-value pairs at this depth into a map
  emit(buf, `var ${mapVar} = {};`);
  emit(buf, "while (li < lines.length) {");
  buf.indent++;
  const content = freshVar(buf);
  if (depth === 0) {
    emit(buf, `var ${content} = lines[li];`);
  } else {
    emit(buf, `if (!lines[li].startsWith(${JSON.stringify(padStr)})) break;`);
    emit(buf, `var ${content} = lines[li].slice(${padStr.length});`);
  }
  emit(buf, `if (${content}.startsWith(" ")) break;`);
  emit(buf, `var ci = ${content}.indexOf(": ");`);
  emit(buf, "if (ci === -1) break;");
  emit(buf, `${mapVar}[${content}.slice(0, ci)] = ${content}.slice(ci + 2);`);
  emit(buf, "li++;");
  buf.indent--;
  emit(buf, "}");

  // Extract expected keys from map
  const keys = Object.keys(schema.meta.properties);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = schema.meta.properties[key] as Schema;
    const innerChild = child.kind === "optional" ? child.meta.inner : child;
    const isOpt = child.kind === "optional";
    const childPathExpr = pathExpr === '""' ? JSON.stringify(key) : JSON.stringify(JSON.parse(pathExpr) + "." + key);

    if (isOpt) {
      emit(buf, `if (${JSON.stringify(key)} in ${mapVar}) {`);
      buf.indent++;
    } else {
      emit(buf, `if (!(${JSON.stringify(key)} in ${mapVar})) return _err(_me(${childPathExpr}, "key '${key}'", "not found"));`);
    }

    const valVar = freshVar(buf);
    emitPrimitiveValueParse(buf, innerChild, `${mapVar}[${JSON.stringify(key)}]`, childPathExpr, valVar);
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${valVar};`);

    if (isOpt) {
      buf.indent--;
      emit(buf, "}");
    }
  }
}

function isCompound(schema: Schema): boolean {
  const inner = schema.kind === "optional" ? schema.meta.inner : schema;
  return inner.kind === "object" || inner.kind === "array" || inner.kind === "record" || inner.kind === "tuple";
}
