/**
 * TOON — code-generated Token-Oriented Object Notation serializers and parsers.
 *
 * TOON is a human-readable, indentation-based format optimized for token
 * efficiency (LLM context windows, config files, structured logs). Typical
 * output is 40-50% smaller than JSON for tabular data.
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
 * @example Basic object — key: value format, one field per line
 * ```ts
 * import * as S from "vjuga/schema/Schema";
 * import * as ST from "vjuga/schema/TOON";
 * const User = S.object({ id: S.integer(), name: S.string() });
 * const toToon = ST.stringify(User);
 * const fromToon = ST.parse(User);
 * toToon({ id: 1, name: "Alice" });
 * // "id: 1\nname: Alice"
 * fromToon("id: 1\nname: Alice"); // [true, { id: 1, name: "Alice" }]
 * ```
 *
 * @example Tabular arrays — uniform object arrays use compact table format
 * ```ts
 * // Arrays of objects with only primitive fields → tabular format:
 * //   users[3]{id,name,role}:
 * //     1,Alice,admin
 * //     2,Bob,user
 * //     3,Charlie,user
 * const Schema = S.object({
 *   users: S.array(S.object({ id: S.integer(), name: S.string(), role: S.string() })),
 * });
 * // Output is ~50% smaller than JSON for this shape.
 * ```
 *
 * @example Inline primitive arrays — compact single-line format
 * ```ts
 * // Arrays of primitives → inline: "tags[3]: admin,user,moderator"
 * const Schema = S.object({ tags: S.array(S.string()) });
 * ```
 *
 * @example Flexible order parse — for external TOON where field order varies
 * ```ts
 * const fromToon = ST.parse(User, { flexibleOrder: true });
 * // Parses "name: Alice\nid: 1" (reversed order) correctly.
 * // ~2x slower than schema-order parse — use only when order is unknown.
 * ```
 *
 * @example Options — delimiter and indent
 * ```ts
 * ST.stringify(schema, { delimiter: "\t", indent: 4 });
 * ST.parse(schema, { delimiter: "\t", indent: 4 });
 * ```
 *
 * Best practices:
 *   - Default (schema-order) parse is fastest — use it when you control the
 *     producer. Use `flexibleOrder` only for external/user-generated TOON.
 *   - Compile `stringify`/`parse` at module scope, not per-request.
 *   - TOON is most beneficial for tabular data (arrays of uniform objects)
 *     where the column header eliminates repeated key names.
 *   - Use comma delimiter (default) for most cases. Tab (`\t`) is useful
 *     when values contain commas. Pipe (`|`) for values containing tabs.
 *
 * Pitfalls:
 *   - `flexibleOrder` only supports flat objects with primitive fields.
 *     Nested objects/arrays inside flexible-order schemas use schema-order.
 *   - Union parse only attempts the first variant — no backtracking.
 *     Prefer discriminated unions or put the most common variant first.
 *   - Strings containing the delimiter, quotes, or colons are automatically
 *     quoted. Strings starting/ending with whitespace are also quoted.
 *     Parsing unquotes transparently.
 *   - TOON `null` is the literal string "null". The parser distinguishes
 *     `nullable(T)` fields: "null" → null, other → parse as T.
 *   - Root-level arrays/tuples are supported for parse but not for
 *     stringify (wrap in an object for round-trip).
 *
 * V8 optimization: both compiled stringify and parse functions reach
 * Turbofan (top tier) after warm-up. The `readField` helper keeps per-field
 * bytecode minimal, preserving Turbofan eligibility for large schemas.
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import { escapeJsonString } from "../JSON.js";
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
  typeCheckExpr,
} from "./Codegen.js";

// ---------------------------------------------------------------------------
// TOON helpers — captured by generated code
// ---------------------------------------------------------------------------

/**
 * Check if a TOON string value needs quoting. Single-pass charCode scan
 * replaces the previous regex (NEEDS_QUOTE_RE) which accounted for ~8% of
 * TOON stringify CPU time. The delimiter check is folded into the same scan,
 * eliminating a separate indexOf call.
 *
 * Rules: quote if empty, starts/ends with whitespace, is a reserved word
 * (true/false/null), looks numeric, contains special chars (: " \ [ ] { }),
 * contains control chars, or contains the delimiter.
 */
function needsQuote(s: string, delimCode: number): boolean {
  const len = s.length;
  if (len === 0) return true;

  const first = s.charCodeAt(0);
  const last = s.charCodeAt(len - 1);

  // Leading/trailing whitespace
  if (first <= 0x20 || last <= 0x20) return true;

  // Reserved words: true (4), false (5), null (4)
  if (len === 4 && (s === "true" || s === "null")) return true;
  if (len === 5 && s === "false") return true;

  // Lone dash
  if (len === 1 && first === 0x2d) return true;

  // Numeric-looking: starts with digit or dash-then-digit, or leading-zero pattern
  if (first >= 0x30 && first <= 0x39) return true; // starts with 0-9
  if (first === 0x2d && len > 1 && s.charCodeAt(1) >= 0x30 && s.charCodeAt(1) <= 0x39) return true;

  // Scan for special chars, control chars, and delimiter
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (
      c === 0x3a || // :
      c === 0x22 || // "
      c === 0x5c || // \
      c === 0x5b || // [
      c === 0x5d || // ]
      c === 0x7b || // {
      c === 0x7d || // }
      c < 0x20 || // control chars
      c === delimCode // delimiter
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Quote a TOON string value. Uses needsQuote() for the fast-path check
 * (charCode scan, no regex), then escapes in a single pass.
 */
function toonQuote(s: string, delim: string): string {
  if (!needsQuote(s, delim.charCodeAt(0))) return s;
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
    } else if (c < 0x20) {
      // Remaining control chars (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f) — escape
      // as \uXXXX so the TOON output contains no raw control characters.
      out += s.slice(last, i) + "\\u" + c.toString(16).padStart(4, "0");
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
      else if (next === 0x75 && i + 5 < s.length - 1) {
        // \uXXXX escape — decode 4 hex digits to a char code
        const hex = s.slice(i + 2, i + 6);
        const code = parseInt(hex, 16);
        if (code === code) {
          out += String.fromCharCode(code);
          i += 5;
          last = i + 1;
          continue;
        }
        out += s[i];
        last = i + 1;
        continue;
      } else {
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
 * When `expected` is provided, pre-allocates the result array to avoid
 * dynamic growth (saves ~1.4% of TOON parse CPU on tabular data).
 */
function splitByDelimiter(s: string, delim: string, expected?: number): string[] {
  if (expected !== undefined) {
    // Pre-allocated path: indexed assignment instead of push
    const result = new Array<string>(expected);
    let idx = 0;
    let start = 0;
    let inQuote = false;
    for (let i = 0; i < s.length; i++) {
      if (inQuote) {
        if (s.charCodeAt(i) === 0x5c && i + 1 < s.length) i++;
        else if (s.charCodeAt(i) === 0x22) inQuote = false;
      } else if (s.charCodeAt(i) === 0x22) {
        inQuote = true;
      } else if (s[i] === delim) {
        result[idx++] = s.slice(start, i);
        start = i + 1;
      }
    }
    result[idx++] = s.slice(start);
    // Fill remaining slots with empty string to avoid undefined holes when
    // actual field count < expected (e.g., truncated tabular input).
    // Skip fill on the common path where all fields are present.
    if (idx < expected) for (; idx < expected; idx++) result[idx] = "";
    return result;
  }
  const result: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (inQuote) {
      if (s.charCodeAt(i) === 0x5c && i + 1 < s.length)
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
  const items = schema.meta.items;
  if (items.kind !== "object") return false;
  const keys = Object.keys(items.meta.properties);
  for (let i = 0; i < keys.length; i++) {
    if (!isPrimitive(items.meta.properties[keys[i]])) return false;
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
  return primitiveExpr(schema, accessor);
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
    default:
      unreachable(schema);
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
    const pad = escapeJsonString(" ".repeat(depth * ctx.indent));
    emit(ctx.buf, `s += ${pad} + ${escapeJsonString(key + ": ")} + ${valueExpr} + "\\n";`);
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
  const props = schema.meta.properties;
  const keys = Object.keys(props);

  if (!isRoot || key !== "") {
    const pad = escapeJsonString(" ".repeat(depth * ctx.indent));
    emit(ctx.buf, `s += ${pad} + ${escapeJsonString(key + ":\n")};`);
    for (let i = 0; i < keys.length; i++) {
      emitStringifyBody(
        ctx,
        props[keys[i]],
        `${accessor}[${escapeJsonString(keys[i])}]`,
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
        `${accessor}[${escapeJsonString(keys[i])}]`,
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
  const pad = escapeJsonString(" ".repeat(depth * ctx.indent));
  const header = key;

  if (isTabular(schema)) {
    emitTabularStringify(ctx, schema, accessor, header, depth);
    return;
  }

  if (isPrimitive(schema.meta.items)) {
    const helperName = freshVar(ctx.buf);
    const elemExpr = inlineExpr(schema.meta.items, "a[i]");
    // Use += cons-string concat (matches JSON array stringify pattern) —
    // avoids per-call array allocation and join overhead.
    const fn = compileHelper<Function>(
      ctx.buf,
      `function ${helperName}(a) {
  var n = a.length;
  if (n === 0) return "";
  var i = 0;
  var s = ${elemExpr};
  for (i = 1; i < n; i++) s += _delim + ${elemExpr};
  return s;
}`,
    );
    emitRef(ctx.buf, helperName, fn);
    emit(
      ctx.buf,
      `s += ${pad} + ${escapeJsonString(header)} + "[" + ${accessor}.length + "]: " + ${helperName}(${accessor}) + "\\n";`,
    );
    return;
  }

  // Expanded format
  emit(ctx.buf, `s += ${pad} + ${escapeJsonString(header)} + "[" + ${accessor}.length + "]:\\n";`);
  const idx = freshVar(ctx.buf);
  emit(ctx.buf, `for (var ${idx} = 0; ${idx} < ${accessor}.length; ${idx}++) {`);
  ctx.buf.indent++;
  const itemPad = escapeJsonString(" ".repeat((depth + 1) * ctx.indent));
  emit(
    ctx.buf,
    `s += ${itemPad} + "- " + ${inlineExpr(schema.meta.items, `${accessor}[${idx}]`)} + "\\n";`,
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
  const objSchema = schema.meta.items;
  const fields = Object.keys(objSchema.meta.properties);
  const pad = escapeJsonString(" ".repeat(depth * ctx.indent));
  const childPad = escapeJsonString(" ".repeat((depth + 1) * ctx.indent));
  const fieldHeader = "{" + fields.join(ctx.delim) + "}";

  emit(
    ctx.buf,
    `s += ${pad} + ${escapeJsonString(header)} + "[" + ${accessor}.length + "]${fieldHeader}:\\n";`,
  );

  // Row serializer helper
  const helperName = freshVar(ctx.buf);
  const cellExprs = fields.map((f) => {
    const child = objSchema.meta.properties[f];
    // Use the full child (including optional wrapper) so inlineExpr emits
    // the undefined guard: `(accessor === undefined ? "" : inner_expr)`
    return inlineExpr(child, `o[${escapeJsonString(f)}]`);
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
  const pad = escapeJsonString(" ".repeat(depth * ctx.indent));
  const header = key;
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    parts.push(inlineExpr(items[i], `${accessor}[${i}]`));
  }
  const joined = parts.length > 0 ? parts.join(" + _delim + ") : '""';
  emit(
    ctx.buf,
    `s += ${pad} + ${escapeJsonString(header)} + "[${items.length}]: " + ${joined} + "\\n";`,
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
  const pad = escapeJsonString(" ".repeat(depth * ctx.indent));

  if (!isRoot || key !== "") {
    emit(ctx.buf, `s += ${pad} + ${escapeJsonString(key + ":\n")};`);
  } else {
    emit(ctx.buf, 'var s = "";');
  }

  const innerPad = escapeJsonString(
    " ".repeat((isRoot && key === "" ? depth : depth + 1) * ctx.indent),
  );
  const ks = freshVar(ctx.buf);
  const ki = freshVar(ctx.buf);
  emit(ctx.buf, `var ${ks} = Object.keys(${accessor});`);
  emit(ctx.buf, `for (var ${ki} = 0; ${ki} < ${ks}.length; ${ki}++) {`);
  ctx.buf.indent++;
  const valExpr = inlineExpr(schema.meta.values, `${accessor}[${ks}[${ki}]]`);
  // Quote record keys — keys containing ": ", delimiters, or control chars
  // would break the parse round-trip (parser splits on indexOf(": ")).
  emit(ctx.buf, `s += ${innerPad} + _q(${ks}[${ki}], _delim) + ": " + ${valExpr} + "\\n";`);
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
  const variants = schema.meta.variants;
  for (let i = 0; i < variants.length; i++) {
    const check = typeCheckExpr(variants[i], accessor);
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
    if (typeCheckExpr(variants[i], accessor) !== null) {
      ctx.buf.indent--;
      emit(ctx.buf, "}");
    }
  }
}


// ---------------------------------------------------------------------------
// Parse helpers — captured by generated code via emitRef.
// Each is small (~5 lines) and monomorphic — individually Turbofan-eligible.
// Extracting these from inline codegen reduces generated parse bytecode by
// ~35-40%, enabling the compiled parser to reach Turbofan tier.
// ---------------------------------------------------------------------------

/**
 * Read a field line: check that lines[li] starts with `prefix`, return the
 * value portion (after slicing the prefix). Returns null on mismatch.
 * Monomorphic: always receives (string[], number, string, number).
 */
function readField(
  lines: readonly string[],
  li: number,
  prefix: string,
  prefixLen: number,
): string | null {
  if (li >= lines.length || !lines[li].startsWith(prefix)) return null;
  return lines[li].slice(prefixLen);
}

/**
 * Split a record line into [key, value] at the ": " separator.
 * Handles quoted keys: if line starts with `"`, find the closing `"`
 * and expect `: ` immediately after. Returns null if no valid split found.
 */
function splitRecordLine(line: string): [string, string] | null {
  if (line.charCodeAt(0) === 0x22) {
    // Quoted key — find closing quote (skip escaped quotes)
    for (let i = 1; i < line.length; i++) {
      if (line.charCodeAt(i) === 0x5c) {
        i++; // skip escaped char
      } else if (line.charCodeAt(i) === 0x22) {
        // Expect ": " immediately after closing quote
        if (i + 2 < line.length && line.charCodeAt(i + 1) === 0x3a && line.charCodeAt(i + 2) === 0x20) {
          return [line.slice(0, i + 1), line.slice(i + 3)];
        }
        return null; // malformed
      }
    }
    return null; // unclosed quote
  }
  // Unquoted key — simple indexOf
  const ci = line.indexOf(": ");
  if (ci === -1) return null;
  return [line.slice(0, ci), line.slice(ci + 2)];
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
  emitRef(buf, "_rf", readField);
  emitRef(buf, "_split", splitByDelimiter);
  emitRef(buf, "_srl", splitRecordLine);
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
      const variants = schema.meta.variants;
      if (variants.length > 0)
        emitParseBody(buf, variants[0], depth, pathExpr, indent, delim, flexible);
      break;
    }
    case "optional":
    case "nullable":
      emitParseBody(buf, schema.meta.inner, depth, pathExpr, indent, delim, flexible);
      break;
    default:
      unreachable(schema);
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
  const label = escapeJsonString("literal(" + JSON.stringify(schema.meta.value) + ")");
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
  emitRef(buf, setRef, new Set(schema.meta.values));
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
  const props = schema.meta.properties;
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
        pathExpr === '""'
          ? escapeJsonString(key)
          : escapeJsonString(JSON.parse(pathExpr) + "." + key);

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
  const rawVar = freshVar(buf);

  // _rf does startsWith + slice in a single monomorphic helper call,
  // reducing generated bytecode and enabling Turbofan on the compiled parser.
  emit(
    buf,
    `var ${rawVar} = _rf(lines, li, ${escapeJsonString(expectedPrefix)}, ${expectedPrefix.length});`,
  );

  if (isOptional) {
    emit(buf, `if (${rawVar} !== null) {`);
    buf.indent++;
  } else {
    emit(
      buf,
      `if (${rawVar} === null) return _err(_me(${pathExpr}, ${escapeJsonString("key '" + key + "'")}, li < lines.length ? lines[li] : "end of input"));`,
    );
  }

  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimValueParse(buf, schema, rawVar, pathExpr, valVar);
  emit(buf, `${resultVar}[${escapeJsonString(key)}] = ${valVar};`);

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
  // Unwrap nullable — the compound inner type determines parse logic.
  // For nullable compound fields, the "null" literal is handled at the value
  // level, not the structure level (TOON represents null objects as absent lines).
  const unwrapped = schema.kind === "nullable" ? schema.meta.inner : schema;
  if (unwrapped.kind === "array" || unwrapped.kind === "tuple") {
    const headerPrefix = keyPrefix + "[";
    if (isOptional) {
      emit(
        buf,
        `if (li < lines.length && lines[li].startsWith(${escapeJsonString(headerPrefix)})) {`,
      );
      buf.indent++;
    }
    emitArrayHeaderParse(buf, unwrapped, key, depth, pathExpr, indent, delim, resultVar);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (unwrapped.kind === "object") {
    const nestedLine = keyPrefix + ":";
    if (isOptional) {
      emit(buf, `if (li < lines.length && lines[li] === ${escapeJsonString(nestedLine)}) {`);
      buf.indent++;
    } else {
      emit(
        buf,
        `if (li >= lines.length || lines[li] !== ${escapeJsonString(nestedLine)}) return _err(_me(${pathExpr}, ${escapeJsonString("key '" + key + "'")}, li < lines.length ? lines[li] : "end of input"));`,
      );
    }
    emit(buf, "li++;");
    const innerVar = freshVar(buf);
    emit(buf, `var ${innerVar} = {};`);
    const innerProps = unwrapped.meta.properties;
    const innerKeys = Object.keys(innerProps);
    for (let i = 0; i < innerKeys.length; i++) {
      const ik = innerKeys[i];
      const ic = innerProps[ik];
      const iInner = ic.kind === "optional" ? ic.meta.inner : ic;
      const iOpt = ic.kind === "optional";
      const innerPad = " ".repeat((depth + 1) * indent);
      const iKeyPrefix = innerPad + ik;
      const iPath =
        pathExpr === '""'
          ? escapeJsonString(ik)
          : escapeJsonString(JSON.parse(pathExpr) + "." + ik);
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
    emit(buf, `${resultVar}[${escapeJsonString(key)}] = ${innerVar};`);
    if (isOptional) {
      buf.indent--;
      emit(buf, "}");
    }
  } else if (unwrapped.kind === "record") {
    const nestedLine = keyPrefix + ":";
    emit(buf, `if (li < lines.length && lines[li] === ${escapeJsonString(nestedLine)}) { li++; }`);
    const recVar = emitRecordParse(buf, unwrapped, depth + 1, pathExpr, indent);
    emit(buf, `${resultVar}[${escapeJsonString(key)}] = ${recVar};`);
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
  } else if (schema.kind === "array" && isPrimitive(schema.meta.items)) {
    emitInlineArrayParse(buf, schema, arrVar, mv, pathExpr);
  } else if (schema.kind === "tuple") {
    emitInlineTupleParse(buf, schema, arrVar, mv, pathExpr);
  } else if (schema.kind === "array") {
    // Expanded format: each item on its own line prefixed with "- "
    emitExpandedArrayParse(buf, schema, arrVar, mv, depth, pathExpr, indent);
  }

  emit(buf, `${resultVar}[${escapeJsonString(key)}] = ${arrVar};`);
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
  const objSchema = schema.meta.items;
  const fields = Object.keys(objSchema.meta.properties);
  const childPad = " ".repeat((depth + 1) * indent);
  const idx = freshVar(buf);

  emit(buf, `for (var ${idx} = 0; ${idx} < ${matchVar}_n; ${idx}++) {`);
  buf.indent++;
  emit(
    buf,
    `if (li >= lines.length) return _err(_me(${pathExpr}, "tabular row", "end of input"));`,
  );
  emit(buf, `var row = lines[li++];`);
  emit(
    buf,
    `var cells = _split(row.startsWith(${escapeJsonString(childPad)}) ? row.slice(${childPad.length}) : row.trim(), _delim, ${fields.length});`,
  );
  emit(buf, `var obj = {};`);
  for (let j = 0; j < fields.length; j++) {
    const f = fields[j];
    const fc = objSchema.meta.properties[f];
    const inner = fc.kind === "optional" ? fc.meta.inner : fc;
    const cellVar = freshVar(buf);
    emit(buf, `if (${j} < cells.length) {`);
    buf.indent++;
    emitPrimValueParse(buf, inner, `cells[${j}]`, `${pathExpr} + ".${f}"`, cellVar);
    emit(buf, `obj[${escapeJsonString(f)}] = ${cellVar};`);
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
  emitPrimValueParse(buf, schema.meta.items, `items[${idx}]`, pathExpr, itemVar);
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
    emitPrimValueParse(buf, schema.meta.items[i], `items[${i}]`, pathExpr, itemVar);
    emit(buf, `${arrVar}.push(${itemVar});`);
  }
}

function emitExpandedArrayParse(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  arrVar: string,
  matchVar: string,
  depth: number,
  pathExpr: string,
  indent: number,
): void {
  // Expanded format: items on separate lines prefixed with "  - value"
  const itemPad = " ".repeat((depth + 1) * indent) + "- ";
  const idx = freshVar(buf);
  emit(buf, `for (var ${idx} = 0; ${idx} < ${matchVar}_n; ${idx}++) {`);
  buf.indent++;
  emit(buf, `if (li >= lines.length) return _err(_me(${pathExpr}, "array item", "end of input"));`);
  const rawVar = freshVar(buf);
  emit(
    buf,
    `var ${rawVar} = lines[li].startsWith(${escapeJsonString(itemPad)}) ? lines[li].slice(${itemPad.length}) : lines[li].trim().slice(2);`,
  );
  emit(buf, "li++;");
  const valVar = freshVar(buf);
  emitPrimValueParse(buf, schema.meta.items, rawVar, pathExpr, valVar);
  emit(buf, `${arrVar}.push(${valVar});`);
  buf.indent--;
  emit(buf, "}");
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
    emit(buf, `if (!lines[li].startsWith(${escapeJsonString(padStr)})) break;`);
    emit(buf, `var ${cv} = lines[li].slice(${padStr.length});`);
  }
  emit(buf, `if (${cv}.startsWith(" ")) break;`);
  // splitRecordLine handles quoted keys (containing ": " or special chars)
  const kvVar = freshVar(buf);
  emit(buf, `var ${kvVar} = _srl(${cv});`);
  emit(buf, `if (${kvVar} === null) break;`);
  emit(buf, `var rk = _uq(${kvVar}[0]);`);
  // Prototype pollution guard — skip dangerous keys from untrusted input
  emit(buf, 'if (rk === "__proto__" || rk === "constructor") { li++; continue; }');
  emit(buf, `var rv = ${kvVar}[1];`);
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
  const mapVar = freshVar(buf);

  // Null-prototype object prevents __proto__ pollution from untrusted input
  emit(buf, `var ${mapVar} = Object.create(null);`);
  emit(buf, "while (li < lines.length) {");
  buf.indent++;
  const cv = freshVar(buf);
  // Flexible order only operates at root level (depth 0) — nested objects
  // are parsed via emitCompoundFieldParse with schema-order.
  emit(buf, `var ${cv} = lines[li];`);
  emit(buf, `if (${cv}.startsWith(" ")) break;`);
  emit(buf, `var ci = ${cv}.indexOf(": ");`);
  emit(buf, "if (ci === -1) break;");
  emit(buf, `${mapVar}[${cv}.slice(0, ci)] = ${cv}.slice(ci + 2);`);
  emit(buf, "li++;");
  buf.indent--;
  emit(buf, "}");

  const props = schema.meta.properties;
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = props[key];
    const inner = child.kind === "optional" ? child.meta.inner : child;
    const isOpt = child.kind === "optional";
    const childPath =
      pathExpr === '""'
        ? escapeJsonString(key)
        : escapeJsonString(JSON.parse(pathExpr) + "." + key);

    if (isOpt) {
      emit(buf, `if (${escapeJsonString(key)} in ${mapVar}) {`);
      buf.indent++;
    } else {
      emit(
        buf,
        `if (!(${escapeJsonString(key)} in ${mapVar})) return _err(_me(${childPath}, ${escapeJsonString("key '" + key + "'")}, "not found"));`,
      );
    }

    const valVar = freshVar(buf);
    emitPrimValueParse(buf, inner, `${mapVar}[${escapeJsonString(key)}]`, childPath, valVar);
    emit(buf, `${resultVar}[${escapeJsonString(key)}] = ${valVar};`);

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
  let inner: Schema = schema;
  // Unwrap optional and nullable wrappers to check if the core type is compound
  while (inner.kind === "optional" || inner.kind === "nullable") inner = inner.meta.inner;
  return (
    inner.kind === "object" ||
    inner.kind === "array" ||
    inner.kind === "record" ||
    inner.kind === "tuple"
  );
}
