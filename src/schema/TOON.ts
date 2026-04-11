/**
 * TOON — code-generated Token-Oriented Object Notation serializers and parsers.
 *
 * `stringify(schema)` compiles a schema-specific TOON serializer. Format
 * selection (inline arrays, tabular arrays, expanded objects) is decided at
 * compile time based on schema shape — no runtime format detection.
 *
 * `parse(schema)` compiles a schema-specific TOON parser. Default mode
 * expects fields in schema-declared order (fast path). With
 * `flexibleOrder: true`, fields may appear in any order (key lookup).
 *
 * Spec conformance: TOON 3.0 (2025-11-24). Subset: no key folding, no path
 * expansion. Delimiter configurable (comma default).
 *
 * @example
 * ```ts
 * import * as S from "vjuga/schema/Schema";
 * import * as ST from "vjuga/schema/TOON";
 * const User = S.object({ id: S.integer(), name: S.string() });
 * const toToon = ST.stringify(User);
 * toToon({ id: 1, name: "Alice" }); // "id: 1\nname: Alice"
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import type { Schema, Infer } from "./Schema.js";
import { type SchemaError, emitStandardRefs } from "./Validate.js";
import { isPrimitive } from "./Schema.js";
import { unreachable } from "../FunctionUtils.js";
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
// TOON helpers — captured by generated code
// ---------------------------------------------------------------------------

// oxlint-disable-next-line no-control-regex -- TOON spec requires quoting strings with control chars
const NEEDS_QUOTE_RE =
  /^$|^\s|\s$|^(true|false|null)$|^-?\d+(\.\d+)?(e[+-]?\d+)?$|^0\d|[:"\\[\]{}]|[\u0000-\u001f]|^-$/;

/**
 * Quote a TOON string value. Single-pass charCode scan avoids the 5x
 * .replace() chain that would scan the full string per escape character.
 */
function toonQuote(s: string, delim: string): string {
  if (!NEEDS_QUOTE_RE.test(s) && s.indexOf(delim) === -1) return s;
  let out = '"';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // charCode switch — V8 compiles to a jump table for dense integer ranges
    if (c === 0x5c) {
      out += s.slice(last, i) + "\\\\";
      last = i + 1;
    } else if (c === 0x22) {
      out += s.slice(last, i) + '\\"';
      last = i + 1;
    } else if (c === 0x0a) {
      out += s.slice(last, i) + "\\n";
      last = i + 1;
    } else if (c === 0x0d) {
      out += s.slice(last, i) + "\\r";
      last = i + 1;
    } else if (c === 0x09) {
      out += s.slice(last, i) + "\\t";
      last = i + 1;
    }
  }
  return out + s.slice(last) + '"';
}

function toonUnquote(s: string): string {
  if (s.length < 2 || s.charCodeAt(0) !== 0x22 || s.charCodeAt(s.length - 1) !== 0x22) return s;
  // Fast path: no escape sequences → slice without scanning char-by-char
  if (s.indexOf("\\") === -1) return s.slice(1, -1);
  let out = "";
  let last = 1;
  for (let i = 1; i < s.length - 1; i++) {
    if (s.charCodeAt(i) === 0x5c && i + 1 < s.length - 1) {
      out += s.slice(last, i);
      const next = s.charCodeAt(i + 1);
      if (next === 0x5c) out += "\\";
      else if (next === 0x22) out += '"';
      else if (next === 0x6e) out += "\n";
      else if (next === 0x72) out += "\r";
      else if (next === 0x74) out += "\t";
      else {
        out += s[i];
        last = i + 1;
        continue;
      }
      i++;
      last = i + 1;
    }
  }
  return out + s.slice(last, s.length - 1);
}

/** Canonicalize number per TOON spec. NaN/Infinity → null. */
function canonicalNumber(n: number): string {
  if (n !== n || !isFinite(n)) return "null";
  const s = "" + n;
  if (s.indexOf("e") === -1 && s.indexOf("E") === -1) return s;
  return n.toFixed(20).replace(/\.?0+$/, "");
}

/**
 * Split inline values by delimiter, respecting quoted strings.
 * Uses slice-based accumulation to avoid per-character string allocation.
 */
function splitByDelimiter(s: string, delim: string): string[] {
  const result: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (inQuote) {
      if (s.charCodeAt(i) === 0x5c)
        i++; // skip escaped char
      else if (s.charCodeAt(i) === 0x22) inQuote = false;
    } else if (s.charCodeAt(i) === 0x22) {
      inQuote = true;
    } else if (s[i] === delim) {
      result.push(s.slice(start, i));
      start = i + 1;
    }
  }
  result.push(s.slice(start));
  return result;
}

/** True if array(object({all primitives})) — qualifies for tabular format. */
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
// Stringify context — bundles config to avoid parameter sprawl
// ---------------------------------------------------------------------------

interface EmitCtx {
  readonly buf: CodeBuffer;
  readonly indent: number;
  readonly delim: string;
}

/** JS expression for TOON inline value serialization. */
function inlineExpr(schema: Schema, accessor: string): string {
  if (schema.kind === "optional")
    return `(${accessor} === undefined ? "" : ${inlineExpr(schema.meta.inner, accessor)})`;
  if (schema.kind === "nullable")
    return `(${accessor} === null ? "null" : ${inlineExpr(schema.meta.inner, accessor)})`;
  switch (schema.kind) {
    case "string":
      return `_q(${accessor}, _delim)`;
    case "number":
    case "integer":
      return `_cn(${accessor})`;
    case "boolean":
      return `(${accessor} ? "true" : "false")`;
    case "null":
      return `"null"`;
    default:
      return `(typeof ${accessor} === "string" ? _q(${accessor}, _delim) : "" + ${accessor})`;
  }
}

// ---------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------

export interface ToonStringifyOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
}

/** Compiles a schema into a TOON stringify function via `new Function`. */
export function stringify<S extends Schema>(
  schema: S,
  options?: ToonStringifyOptions,
): (value: Infer<S>) => string {
  const ctx: EmitCtx = {
    buf: createBuffer(),
    indent: options?.indent ?? 2,
    delim: options?.delimiter ?? ",",
  };
  emitRef(ctx.buf, "_q", toonQuote);
  emitRef(ctx.buf, "_cn", canonicalNumber);
  emitRef(ctx.buf, "_delim", ctx.delim);

  emit(ctx.buf, "return function toonStringify(v) {");
  ctx.buf.indent++;
  emitStringifyBody(ctx, schema, "v", "", 0, true);
  ctx.buf.indent--;
  emit(ctx.buf, "}");

  return compileFunction<(value: Infer<S>) => string>(ctx.buf);
}

function emitStringifyBody(
  ctx: EmitCtx,
  schema: Schema,
  accessor: string,
  key: string,
  depth: number,
  isRoot: boolean,
): void {
  switch (schema.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
    case "literal":
    case "enum":
      emitPrimLine(ctx, primitiveExpr(schema, accessor), key, depth, isRoot);
      break;
    case "object":
      emitObjectStringify(ctx, schema, accessor, key, depth, isRoot);
      break;
    case "array":
      emitArrayStringify(ctx, schema, accessor, key, depth);
      break;
    case "tuple":
      emitTupleStringify(ctx, schema, accessor, key, depth);
      break;
    case "record":
      emitRecordStringify(ctx, schema, accessor, key, depth, isRoot);
      break;
    case "union":
      emitUnionStringify(ctx, schema, accessor, key, depth, isRoot);
      break;
    case "optional":
      if (key !== "") {
        emit(ctx.buf, `if (${accessor} !== undefined) {`);
        ctx.buf.indent++;
        emitStringifyBody(ctx, schema.meta.inner, accessor, key, depth, false);
        ctx.buf.indent--;
        emit(ctx.buf, "}");
      } else {
        emitStringifyBody(ctx, schema.meta.inner, accessor, key, depth, isRoot);
      }
      break;
    case "nullable":
      emit(ctx.buf, `if (${accessor} === null) {`);
      ctx.buf.indent++;
      emitPrimLine(ctx, `"null"`, key, depth, isRoot);
      ctx.buf.indent--;
      emit(ctx.buf, "} else {");
      ctx.buf.indent++;
      emitStringifyBody(ctx, schema.meta.inner, accessor, key, depth, isRoot);
      ctx.buf.indent--;
      emit(ctx.buf, "}");
      break;
    default: {
      // exhaustive — unreachable when all schema kinds are handled
      /* node:coverage ignore next */
      unreachable(schema);
    }
  }
}

/** JS expression that converts a primitive schema value to TOON string. */
function primitiveExpr(schema: Schema, accessor: string): string {
  switch (schema.kind) {
    case "string":
      return `_q(${accessor}, _delim)`;
    case "number":
    case "integer":
      return `_cn(${accessor})`;
    case "boolean":
      return `(${accessor} ? "true" : "false")`;
    case "null":
      return `"null"`;
    default:
      // literal, enum — runtime type dispatch
      return `(typeof ${accessor} === "string" ? _q(${accessor}, _delim) : typeof ${accessor} === "number" ? _cn(${accessor}) : ${accessor} === null ? "null" : ${accessor} ? "true" : "false")`;
  }
}

/** Emit a `s += pad + "key: " + valueExpr + "\n"` line, or `return valueExpr` at root. */
function emitPrimLine(
  ctx: EmitCtx,
  valueExpr: string,
  key: string,
  depth: number,
  isRoot: boolean,
): void {
  if (isRoot && key === "") {
    emit(ctx.buf, `return ${valueExpr};`);
  } else {
    const pad = JSON.stringify(" ".repeat(depth * ctx.indent));
    emit(ctx.buf, `s += ${pad} + ${JSON.stringify(key + ": ")} + ${valueExpr} + "\\n";`);
  }
}

function emitObjectStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "object" },
  accessor: string,
  key: string,
  depth: number,
  isRoot: boolean,
): void {
  const props = schema.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);

  if (!isRoot || key !== "") {
    const pad = JSON.stringify(" ".repeat(depth * ctx.indent));
    emit(ctx.buf, `s += ${pad} + ${JSON.stringify(key + ":\n")};`);
    for (let i = 0; i < keys.length; i++) {
      emitStringifyBody(
        ctx,
        props[keys[i]],
        `${accessor}[${JSON.stringify(keys[i])}]`,
        keys[i],
        depth + 1,
        false,
      );
    }
  } else {
    emit(ctx.buf, 'var s = "";');
    for (let i = 0; i < keys.length; i++) {
      emitStringifyBody(
        ctx,
        props[keys[i]],
        `${accessor}[${JSON.stringify(keys[i])}]`,
        keys[i],
        depth,
        false,
      );
    }
    emit(ctx.buf, "return s.slice(0, -1);");
  }
}

function emitArrayStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  key: string,
  depth: number,
): void {
  const pad = JSON.stringify(" ".repeat(depth * ctx.indent));
  const header = key;

  if (isTabular(schema)) {
    emitTabularStringify(ctx, schema, accessor, header, depth);
    return;
  }

  if (isPrimitive(schema.meta.items as Schema)) {
    const helperName = freshVar(ctx.buf);
    const elemExpr = inlineExpr(schema.meta.items as Schema, "a[i]");
    const fn = compileHelper<Function>(
      ctx.buf,
      `function ${helperName}(a) {
  var parts = [];
  for (var i = 0; i < a.length; i++) parts.push(${elemExpr});
  return parts.join(_delim);
}`,
    );
    emitRef(ctx.buf, helperName, fn);
    emit(
      ctx.buf,
      `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]: " + ${helperName}(${accessor}) + "\\n";`,
    );
    return;
  }

  // Expanded format
  emit(ctx.buf, `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]:\\n";`);
  const idx = freshVar(ctx.buf);
  emit(ctx.buf, `for (var ${idx} = 0; ${idx} < ${accessor}.length; ${idx}++) {`);
  ctx.buf.indent++;
  const itemPad = JSON.stringify(" ".repeat((depth + 1) * ctx.indent));
  emit(
    ctx.buf,
    `s += ${itemPad} + "- " + ${inlineExpr(schema.meta.items as Schema, `${accessor}[${idx}]`)} + "\\n";`,
  );
  ctx.buf.indent--;
  emit(ctx.buf, "}");
}

function emitTabularStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  header: string,
  depth: number,
): void {
  const objSchema = schema.meta.items as Schema & { kind: "object" };
  const fields = Object.keys(objSchema.meta.properties);
  const pad = JSON.stringify(" ".repeat(depth * ctx.indent));
  const childPad = JSON.stringify(" ".repeat((depth + 1) * ctx.indent));
  const fieldHeader = "{" + fields.join(ctx.delim) + "}";

  emit(
    ctx.buf,
    `s += ${pad} + ${JSON.stringify(header)} + "[" + ${accessor}.length + "]${fieldHeader}:\\n";`,
  );

  // Row serializer helper
  const helperName = freshVar(ctx.buf);
  const cellExprs = fields.map((f) => {
    const child = objSchema.meta.properties[f] as Schema;
    const inner = child.kind === "optional" ? child.meta.inner : child;
    return inlineExpr(inner, `o[${JSON.stringify(f)}]`);
  });
  const fn = compileHelper<Function>(
    ctx.buf,
    `function ${helperName}(o) { return ${cellExprs.join(" + _delim + ")}; }`,
  );
  emitRef(ctx.buf, helperName, fn);

  const idx = freshVar(ctx.buf);
  emit(ctx.buf, `for (var ${idx} = 0; ${idx} < ${accessor}.length; ${idx}++) {`);
  ctx.buf.indent++;
  emit(ctx.buf, `s += ${childPad} + ${helperName}(${accessor}[${idx}]) + "\\n";`);
  ctx.buf.indent--;
  emit(ctx.buf, "}");
}

function emitTupleStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "tuple" },
  accessor: string,
  key: string,
  depth: number,
): void {
  const items = schema.meta.items;
  const pad = JSON.stringify(" ".repeat(depth * ctx.indent));
  const header = key;
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    parts.push(inlineExpr(items[i] as Schema, `${accessor}[${i}]`));
  }
  const joined = parts.length > 0 ? parts.join(" + _delim + ") : '""';
  emit(
    ctx.buf,
    `s += ${pad} + ${JSON.stringify(header)} + "[${items.length}]: " + ${joined} + "\\n";`,
  );
}

function emitRecordStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "record" },
  accessor: string,
  key: string,
  depth: number,
  isRoot: boolean,
): void {
  const pad = JSON.stringify(" ".repeat(depth * ctx.indent));

  if (!isRoot || key !== "") {
    emit(ctx.buf, `s += ${pad} + ${JSON.stringify(key + ":\n")};`);
  } else {
    emit(ctx.buf, 'var s = "";');
  }

  const innerPad = JSON.stringify(
    " ".repeat((isRoot && key === "" ? depth : depth + 1) * ctx.indent),
  );
  const ks = freshVar(ctx.buf);
  const ki = freshVar(ctx.buf);
  emit(ctx.buf, `var ${ks} = Object.keys(${accessor});`);
  emit(ctx.buf, `for (var ${ki} = 0; ${ki} < ${ks}.length; ${ki}++) {`);
  ctx.buf.indent++;
  const valExpr = inlineExpr(schema.meta.values, `${accessor}[${ks}[${ki}]]`);
  emit(ctx.buf, `s += ${innerPad} + ${ks}[${ki}] + ": " + ${valExpr} + "\\n";`);
  ctx.buf.indent--;
  emit(ctx.buf, "}");

  if (isRoot && key === "") {
    emit(ctx.buf, "return s.slice(0, -1);");
  }
}

function emitUnionStringify(
  ctx: EmitCtx,
  schema: Schema & { readonly kind: "union" },
  accessor: string,
  key: string,
  depth: number,
  isRoot: boolean,
): void {
  const variants = schema.meta.variants as readonly Schema[];
  for (let i = 0; i < variants.length; i++) {
    const check = simpleTypeCheck(variants[i], accessor);
    if (check !== null && i < variants.length - 1) {
      emit(ctx.buf, `if (${check}) {`);
      ctx.buf.indent++;
      emitStringifyBody(ctx, variants[i], accessor, key, depth, isRoot);
      ctx.buf.indent--;
      emit(ctx.buf, "} else {");
      ctx.buf.indent++;
    } else {
      emitStringifyBody(ctx, variants[i], accessor, key, depth, isRoot);
    }
  }
  for (let i = 0; i < variants.length - 1; i++) {
    if (simpleTypeCheck(variants[i], accessor) !== null) {
      ctx.buf.indent--;
      emit(ctx.buf, "}");
    }
  }
}

function simpleTypeCheck(schema: Schema, accessor: string): string | null {
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
    case "object":
      return `typeof ${accessor} === "object" && ${accessor} !== null`;
    case "array":
      return `Array.isArray(${accessor})`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export interface ToonParseOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
  readonly strict?: boolean;
  readonly flexibleOrder?: boolean;
}

/** Compiles a schema into a TOON parse function via `new Function`. */
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
  emitRef(buf, "_delim", delim);
  // Single shared regex for all array header parsing — avoids duplicate instances
  emitRef(buf, "_hdrRe", /^[^[]*\[(\d+)\](\{[^}]*\})?:\s*(.*)?$/);

  emit(buf, "return function toonParse(input) {");
  buf.indent++;
  emit(buf, 'var lines = input.split("\\n");');
  emit(buf, "while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();");
  emit(buf, "var li = 0;");
  emitParseBody(buf, schema, 0, '""', indent, delim, flexible);
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(toon: string) => Result<Infer<S>, SchemaError>>(buf);
}

function emitParseBody(
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
      if (depth === 0) emitRootPrimParse(buf, schema, pathExpr);
      break;
    case "object":
      emitObjectParse(buf, schema, depth, pathExpr, indent, delim, flexible);
      break;
    case "array":
    case "tuple":
      emitRootArrayParse(buf, schema, depth, pathExpr, indent, delim);
      break;
    case "record":
      emitRecordParse(buf, schema, depth, pathExpr, indent);
      break;
    case "union": {
      // Limitation: TOON parse currently only attempts the first variant.
      // Full union dispatch would require save/restore of line index (li)
      // with backtracking on parse failure — deferred to a future iteration.
      const variants = schema.meta.variants as readonly Schema[];
      if (variants.length > 0)
        emitParseBody(buf, variants[0], depth, pathExpr, indent, delim, flexible);
      break;
    }
    case "optional":
    case "nullable":
      emitParseBody(buf, schema.meta.inner, depth, pathExpr, indent, delim, flexible);
      break;
    default: {
      // exhaustive — unreachable when all schema kinds are handled
      /* node:coverage ignore next */
      unreachable(schema);
    }
  }
}

// ---------------------------------------------------------------------------
// Parse: primitive value emission
// ---------------------------------------------------------------------------

function emitRootPrimParse(buf: CodeBuffer, schema: Schema, pathExpr: string): void {
  emit(
    buf,
    `if (li >= lines.length) return _err(_me(${pathExpr}, "${schema.kind}", "end of input"));`,
  );
  emit(buf, "var raw = lines[li++].trim();");
  emitPrimValueParse(buf, schema, "raw", pathExpr, "result");
  emit(buf, "return _ok(result);");
}

/** Emit code that parses a raw TOON string into a typed value, assigning to `resultVar`. */
function emitPrimValueParse(
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
      emit(
        buf,
        `if (${rawVar} === "" || ${resultVar} !== ${resultVar}) return _err(_me(${pathExpr}, "number", ${rawVar}));`,
      );
      break;
    case "integer":
      emit(buf, `var ${resultVar} = +${rawVar};`);
      emit(buf, `if (!_isSafe(${resultVar})) return _err(_me(${pathExpr}, "integer", ${rawVar}));`);
      break;
    case "boolean":
      emit(
        buf,
        `if (${rawVar} !== "true" && ${rawVar} !== "false") return _err(_me(${pathExpr}, "boolean", ${rawVar}));`,
      );
      emit(buf, `var ${resultVar} = ${rawVar} === "true";`);
      break;
    case "null":
      emit(buf, `if (${rawVar} !== "null") return _err(_me(${pathExpr}, "null", ${rawVar}));`);
      emit(buf, `var ${resultVar} = null;`);
      break;
    case "literal":
      emitLiteralParse(buf, schema, rawVar, pathExpr, resultVar);
      break;
    case "enum":
      emitEnumParse(buf, schema, rawVar, pathExpr, resultVar);
      break;
    case "optional":
      emitPrimValueParse(buf, schema.meta.inner, rawVar, pathExpr, resultVar);
      break;
    case "nullable":
      emit(buf, `var ${resultVar};`);
      emit(buf, `if (${rawVar} === "null") { ${resultVar} = null; } else {`);
      buf.indent++;
      const innerVar = freshVar(buf);
      emitPrimValueParse(buf, schema.meta.inner, rawVar, pathExpr, innerVar);
      emit(buf, `${resultVar} = ${innerVar};`);
      buf.indent--;
      emit(buf, "}");
      break;
    default:
      emit(buf, `var ${resultVar} = _uq(${rawVar});`);
      break;
  }
}

function emitLiteralParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "literal" },
  rawVar: string,
  pathExpr: string,
  resultVar: string,
): void {
  const ref = freshVar(buf);
  emitRef(buf, ref, schema.meta.value);
  const label = JSON.stringify("literal(" + JSON.stringify(schema.meta.value) + ")");
  if (typeof schema.meta.value === "string") {
    emit(buf, `var ${resultVar} = _uq(${rawVar});`);
    emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, ${label}, ${rawVar}));`);
  } else if (typeof schema.meta.value === "number") {
    emit(buf, `var ${resultVar} = +${rawVar};`);
    emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, ${label}, ${rawVar}));`);
  } else if (typeof schema.meta.value === "boolean") {
    emit(buf, `var ${resultVar} = ${rawVar} === "true";`);
    emit(buf, `if (${resultVar} !== ${ref}) return _err(_me(${pathExpr}, ${label}, ${rawVar}));`);
  } else {
    emit(buf, `if (${rawVar} !== "null") return _err(_me(${pathExpr}, ${label}, ${rawVar}));`);
    emit(buf, `var ${resultVar} = null;`);
  }
}

function emitEnumParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "enum" },
  rawVar: string,
  pathExpr: string,
  resultVar: string,
): void {
  // Use Set for O(1) lookup instead of indexOf O(n) on the hot path
  const setRef = freshVar(buf);
  emitRef(buf, setRef, new Set(schema.meta.values as readonly (string | number)[]));
  emit(buf, `var ${resultVar} = _uq(${rawVar});`);
  emit(buf, `var ${resultVar}_n = +${rawVar};`);
  emit(
    buf,
    `if (!isNaN(${resultVar}_n) && ${setRef}.has(${resultVar}_n)) ${resultVar} = ${resultVar}_n;`,
  );
  emit(
    buf,
    `else if (!${setRef}.has(${resultVar})) return _err(_me(${pathExpr}, "enum", ${rawVar}));`,
  );
}

// ---------------------------------------------------------------------------
// Parse: object
// ---------------------------------------------------------------------------

function emitObjectParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  flexible: boolean,
): void {
  const props = schema.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);
  const resultVar = freshVar(buf);
  emit(buf, `var ${resultVar} = {};`);

  if (flexible) {
    emitFlexibleObjectParse(buf, schema, depth, pathExpr, indent, resultVar);
  } else {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const child = props[key];
      const inner = child.kind === "optional" ? child.meta.inner : child;
      const isOpt = child.kind === "optional";
      const padStr = depth === 0 ? "" : " ".repeat(depth * indent);
      const keyPrefix = padStr + key;
      const childPath =
        pathExpr === '""' ? JSON.stringify(key) : JSON.stringify(JSON.parse(pathExpr) + "." + key);

      if (isCompound(inner)) {
        emitCompoundFieldParse(
          buf,
          inner,
          key,
          keyPrefix,
          depth,
          childPath,
          indent,
          delim,
          resultVar,
          isOpt,
        );
      } else {
        emitPrimFieldParse(buf, inner, key, keyPrefix, childPath, resultVar, isOpt);
      }
    }
  }

  if (depth === 0) emit(buf, `return _ok(${resultVar});`);
}

function emitPrimFieldParse(
  buf: CodeBuffer,
  schema: Schema,
  key: string,
  keyPrefix: string,
  pathExpr: string,
  resultVar: string,
  isOptional: boolean,
): void {
  const expectedPrefix = keyPrefix + ": ";

  if (isOptional) {
    emit(
      buf,
      `if (li < lines.length && lines[li].startsWith(${JSON.stringify(expectedPrefix)})) {`,
    );
    buf.indent++;
  } else {
    emit(
      buf,
      `if (li >= lines.length) return _err(_me(${pathExpr}, "key '${key}'", "end of input"));`,
    );
    emit(
      buf,
      `if (!lines[li].startsWith(${JSON.stringify(expectedPrefix)})) return _err(_me(${pathExpr}, "key '${key}'", lines[li]));`,
    );
  }

  const rawVar = freshVar(buf);
  emit(buf, `var ${rawVar} = lines[li].slice(${expectedPrefix.length});`);
  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimValueParse(buf, schema, rawVar, pathExpr, valVar);
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
): void {
  if (schema.kind === "array" || schema.kind === "tuple") {
    const headerPrefix = keyPrefix + "[";
    if (isOptional) {
      emit(
        buf,
        `if (li < lines.length && lines[li].startsWith(${JSON.stringify(headerPrefix)})) {`,
      );
      buf.indent++;
    }
    emitArrayHeaderParse(buf, schema, key, depth, pathExpr, indent, delim, resultVar);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (schema.kind === "object") {
    const nestedLine = keyPrefix + ":";
    if (isOptional) {
      emit(buf, `if (li < lines.length && lines[li] === ${JSON.stringify(nestedLine)}) {`);
      buf.indent++;
    } else {
      emit(
        buf,
        `if (li >= lines.length || lines[li] !== ${JSON.stringify(nestedLine)}) return _err(_me(${pathExpr}, "key '${key}'", li < lines.length ? lines[li] : "end of input"));`,
      );
    }
    emit(buf, "li++;");
    const innerVar = freshVar(buf);
    emit(buf, `var ${innerVar} = {};`);
    const innerProps = schema.meta.properties as Record<string, Schema>;
    const innerKeys = Object.keys(innerProps);
    for (let i = 0; i < innerKeys.length; i++) {
      const ik = innerKeys[i];
      const ic = innerProps[ik];
      const iInner = ic.kind === "optional" ? ic.meta.inner : ic;
      const iOpt = ic.kind === "optional";
      const innerPad = " ".repeat((depth + 1) * indent);
      const iKeyPrefix = innerPad + ik;
      const iPath =
        pathExpr === '""' ? JSON.stringify(ik) : JSON.stringify(JSON.parse(pathExpr) + "." + ik);
      if (isCompound(iInner)) {
        emitCompoundFieldParse(
          buf,
          iInner,
          ik,
          iKeyPrefix,
          depth + 1,
          iPath,
          indent,
          delim,
          innerVar,
          iOpt,
        );
      } else {
        emitPrimFieldParse(buf, iInner, ik, iKeyPrefix, iPath, innerVar, iOpt);
      }
    }
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${innerVar};`);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (schema.kind === "record") {
    const nestedLine = keyPrefix + ":";
    emit(buf, `if (li < lines.length && lines[li] === ${JSON.stringify(nestedLine)}) { li++; }`);
    const recVar = emitRecordParse(buf, schema, depth + 1, pathExpr, indent);
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${recVar};`);
  }
}

// ---------------------------------------------------------------------------
// Parse: array / tuple / record
// ---------------------------------------------------------------------------

function emitArrayHeaderParse(
  buf: CodeBuffer,
  schema: Schema,
  key: string,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
  resultVar: string,
): void {
  const mv = freshVar(buf);
  emit(buf, `var ${mv} = lines[li].match(_hdrRe);`);
  emit(buf, `if (!${mv}) return _err(_me(${pathExpr}, "array header", lines[li]));`);
  emit(buf, "li++;");
  emit(buf, `var ${mv}_n = +${mv}[1];`);
  emit(buf, `var ${mv}_d = (${mv}[3] || "").trim();`);

  const arrVar = freshVar(buf);
  emit(buf, `var ${arrVar} = [];`);

  if (schema.kind === "array" && isTabular(schema)) {
    emitTabularParse(buf, schema, arrVar, mv, depth, pathExpr, indent, delim);
  } else if (schema.kind === "array" && isPrimitive(schema.meta.items as Schema)) {
    emitInlineArrayParse(buf, schema, arrVar, mv, pathExpr);
  } else if (schema.kind === "tuple") {
    emitInlineTupleParse(buf, schema, arrVar, mv, pathExpr);
  }

  emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${arrVar};`);
}

function emitTabularParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  arrVar: string,
  matchVar: string,
  depth: number,
  pathExpr: string,
  indent: number,
  _delim: string,
): void {
  const objSchema = schema.meta.items as Schema & { kind: "object" };
  const fields = Object.keys(objSchema.meta.properties);
  const childPad = " ".repeat((depth + 1) * indent);
  const idx = freshVar(buf);

  emit(buf, `for (var ${idx} = 0; ${idx} < ${matchVar}_n; ${idx}++) {`);
  buf.indent++;
  emit(buf, `var row = lines[li++];`);
  emit(
    buf,
    `var cells = _split(row.startsWith(${JSON.stringify(childPad)}) ? row.slice(${childPad.length}) : row.trim(), _delim);`,
  );
  emit(buf, `var obj = {};`);
  for (let j = 0; j < fields.length; j++) {
    const f = fields[j];
    const fc = objSchema.meta.properties[f] as Schema;
    const inner = fc.kind === "optional" ? fc.meta.inner : fc;
    const cellVar = freshVar(buf);
    emit(buf, `if (${j} < cells.length) {`);
    buf.indent++;
    emitPrimValueParse(buf, inner, `cells[${j}]`, `${pathExpr} + ".${f}"`, cellVar);
    emit(buf, `obj[${JSON.stringify(f)}] = ${cellVar};`);
    buf.indent--;
    emit(buf, "}");
  }
  emit(buf, `${arrVar}.push(obj);`);
  buf.indent--;
  emit(buf, "}");
}

function emitInlineArrayParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  arrVar: string,
  matchVar: string,
  pathExpr: string,
): void {
  emit(buf, `if (${matchVar}_d !== "") {`);
  buf.indent++;
  emit(buf, `var items = _split(${matchVar}_d, _delim);`);
  const idx = freshVar(buf);
  emit(buf, `for (var ${idx} = 0; ${idx} < items.length; ${idx}++) {`);
  buf.indent++;
  const itemVar = freshVar(buf);
  emitPrimValueParse(buf, schema.meta.items as Schema, `items[${idx}]`, pathExpr, itemVar);
  emit(buf, `${arrVar}.push(${itemVar});`);
  buf.indent--;
  emit(buf, "}");
  buf.indent--;
  emit(buf, "}");
}

function emitInlineTupleParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "tuple" },
  arrVar: string,
  matchVar: string,
  pathExpr: string,
): void {
  emit(buf, `var items = _split(${matchVar}_d, _delim);`);
  for (let i = 0; i < schema.meta.items.length; i++) {
    const itemVar = freshVar(buf);
    emitPrimValueParse(buf, schema.meta.items[i] as Schema, `items[${i}]`, pathExpr, itemVar);
    emit(buf, `${arrVar}.push(${itemVar});`);
  }
}

/** Emits a record parse block. Returns the generated variable name. */
function emitRecordParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  depth: number,
  pathExpr: string,
  indent: number,
): string {
  const padStr = " ".repeat(depth * indent);
  const recVar = freshVar(buf) + "_rec";
  emit(buf, `var ${recVar} = {};`);

  emit(buf, "while (li < lines.length) {");
  buf.indent++;
  const cv = freshVar(buf);
  if (depth === 0) {
    emit(buf, `var ${cv} = lines[li];`);
  } else {
    emit(buf, `if (!lines[li].startsWith(${JSON.stringify(padStr)})) break;`);
    emit(buf, `var ${cv} = lines[li].slice(${padStr.length});`);
  }
  emit(buf, `if (${cv}.startsWith(" ")) break;`);
  emit(buf, `var ci = ${cv}.indexOf(": ");`);
  emit(buf, "if (ci === -1) break;");
  emit(buf, `var rk = ${cv}.slice(0, ci);`);
  emit(buf, `var rv = ${cv}.slice(ci + 2);`);
  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimValueParse(buf, schema.meta.values, "rv", pathExpr, valVar);
  emit(buf, `${recVar}[rk] = ${valVar};`);
  buf.indent--;
  emit(buf, "}");

  if (depth === 0) emit(buf, `return _ok(${recVar});`);
  return recVar;
}

function emitRootArrayParse(
  buf: CodeBuffer,
  schema: Schema,
  depth: number,
  pathExpr: string,
  indent: number,
  delim: string,
): void {
  const tmpVar = freshVar(buf);
  emit(buf, `var ${tmpVar} = {};`);
  emitArrayHeaderParse(buf, schema, "", depth, pathExpr, indent, delim, tmpVar);
  emit(buf, `return _ok(${tmpVar}[""]);`);
}

// ---------------------------------------------------------------------------
// Parse: flexible order
// ---------------------------------------------------------------------------

function emitFlexibleObjectParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  depth: number,
  pathExpr: string,
  indent: number,
  resultVar: string,
): void {
  const padStr = " ".repeat(depth * indent);
  const mapVar = freshVar(buf);

  emit(buf, `var ${mapVar} = {};`);
  emit(buf, "while (li < lines.length) {");
  buf.indent++;
  const cv = freshVar(buf);
  if (depth === 0) {
    emit(buf, `var ${cv} = lines[li];`);
  } else {
    emit(buf, `if (!lines[li].startsWith(${JSON.stringify(padStr)})) break;`);
    emit(buf, `var ${cv} = lines[li].slice(${padStr.length});`);
  }
  emit(buf, `if (${cv}.startsWith(" ")) break;`);
  emit(buf, `var ci = ${cv}.indexOf(": ");`);
  emit(buf, "if (ci === -1) break;");
  emit(buf, `${mapVar}[${cv}.slice(0, ci)] = ${cv}.slice(ci + 2);`);
  emit(buf, "li++;");
  buf.indent--;
  emit(buf, "}");

  const props = schema.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = props[key];
    const inner = child.kind === "optional" ? child.meta.inner : child;
    const isOpt = child.kind === "optional";
    const childPath =
      pathExpr === '""' ? JSON.stringify(key) : JSON.stringify(JSON.parse(pathExpr) + "." + key);

    if (isOpt) {
      emit(buf, `if (${JSON.stringify(key)} in ${mapVar}) {`);
      buf.indent++;
    } else {
      emit(
        buf,
        `if (!(${JSON.stringify(key)} in ${mapVar})) return _err(_me(${childPath}, "key '${key}'", "not found"));`,
      );
    }

    const valVar = freshVar(buf);
    emitPrimValueParse(buf, inner, `${mapVar}[${JSON.stringify(key)}]`, childPath, valVar);
    emit(buf, `${resultVar}[${JSON.stringify(key)}] = ${valVar};`);

    if (isOpt) {
      buf.indent--;
      emit(buf, "}");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCompound(schema: Schema): boolean {
  const inner = schema.kind === "optional" ? schema.meta.inner : schema;
  return (
    inner.kind === "object" ||
    inner.kind === "array" ||
    inner.kind === "record" ||
    inner.kind === "tuple"
  );
}
