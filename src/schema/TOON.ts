/**
 * TOON — code-generated Token-Oriented Object Notation serializers and parsers.
 *
 * When to use: compact, human-readable output for LLM prompts, logs or config,
 * mostly for arrays of uniform objects. Tabular data is ~40–50% smaller than
 * JSON; flat objects only ~20% smaller; nested objects/lists can be as large
 * as JSON. For machine-to-machine interchange prefer `schema/JSON`.
 *
 * `stringify(schema)` / `parse(schema)` compile schema-specific functions.
 * Layout is chosen at compile time: primitive arrays inline (`k[2]: a,b`),
 * arrays of primitive-field objects tabular (`k[2]{a,b}:` + rows), anything
 * else as `- ` list items (objects put their first field on the hyphen line).
 * `parse` expects schema field order unless `flexibleOrder: true`.
 *
 * Design tradeoffs:
 *   Spec: TOON 3.0 subset — no key folding, no `[N|]` delimiter markers on
 *   output (accepted on input). Keys are quoted only when needed to parse.
 *   Every shape `stringify` accepts round-trips through `parse`. Shapes TOON
 *   cannot encode unambiguously throw `TypeError("TOON: unsupported ...")` at
 *   compile time: `optional(compound)` outside an object field, unions
 *   mixing compound variants unless they are discriminated object unions,
 *   and `unknown` / `allOf` / `not` / `conditional`. Unions of primitives
 *   decode the token's type (quoted → string), then pick the first variant
 *   that validates (`oneOf`: exactly one must). Parsing is strict (`strict` is a no-op):
 *   exact item/row counts, JSON-grammar numbers, an empty cell means "absent".
 *   `__proto__` keys are dropped on parse; non-finite numbers emit `null`.
 *
 * @example Objects, tabular arrays, round-trip
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * import * as ST from "@dolphin278/vjuga/schema/TOON";
 * const Team = S.object({
 *   name: S.string(),
 *   users: S.array(S.object({ id: S.integer(), role: S.string() })),
 * });
 * const out = ST.stringify(Team)({ name: "core", users: [{ id: 1, role: "admin" }] });
 * // "name: core\nusers[1]{id,role}:\n  1,admin"
 * ST.parse(Team)(out); // [true, { name: "core", users: [{ id: 1, role: "admin" }] }]
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import { escapeJsonString } from "../JSON.js";
import type { Schema, Infer } from "./Schema.js";
import { type SchemaError, emitStandardRefs, validate } from "./Validate.js";
import { findDiscriminant, isPrimitive as isLeaf } from "./Schema.js";
import { unreachable } from "../FunctionUtils.js";
import {
  type CodeBuffer,
  createBuffer,
  emit,
  emitRef,
  freshVar,
  compileFunction,
  childPath,
  dynamicChildPath,
} from "./Codegen.js";

// ---------------------------------------------------------------------------
// Runtime helpers — captured by generated code via emitRef
// ---------------------------------------------------------------------------

// Pre-computed escapes for control characters (0x00-0x1f) — avoids a
// toString(16)+padStart allocation per control char on the hot path.
const TOON_ESCAPE_TABLE: string[] = [];
for (let i = 0; i < 32; i++) {
  TOON_ESCAPE_TABLE[i] = "\\u" + i.toString(16).padStart(4, "0");
}
TOON_ESCAPE_TABLE[0x09] = "\\t";
TOON_ESCAPE_TABLE[0x0a] = "\\n";
TOON_ESCAPE_TABLE[0x0d] = "\\r";

/** True if `s` has whitespace at either end, including Unicode whitespace that `trim()` removes. */
function hasEdgeSpace(s: string, first: number, last: number): boolean {
  if (first <= 0x20 || last <= 0x20) return true;
  // NBSP, BOM, U+2028 etc. — only pay for trim() when an end is non-ASCII.
  return (first > 0x7e || last > 0x7e) && s.trim().length !== s.length;
}

/** True if `c` is one of `: " \ [ ] { }` or a control character. */
function isStructural(c: number): boolean {
  return (
    c < 0x20 ||
    c === 0x3a ||
    c === 0x22 ||
    c === 0x5c ||
    c === 0x5b ||
    c === 0x5d ||
    c === 0x7b ||
    c === 0x7d
  );
}

/**
 * Check if a TOON string value needs quoting. Single-pass charCode scan.
 * Quote if empty, edge whitespace, reserved word (true/false/null), lone `-`,
 * numeric-looking (starts with a digit or `-digit`), structural/control
 * chars, or the active delimiter.
 */
function needsQuote(s: string, delimCode: number): boolean {
  const len = s.length;
  if (len === 0) return true;
  const first = s.charCodeAt(0);
  if (hasEdgeSpace(s, first, s.charCodeAt(len - 1))) return true;
  if (s === "true" || s === "false" || s === "null" || s === "-") return true;
  if (first >= 0x30 && first <= 0x39) return true;
  if (first === 0x2d) {
    const second = s.charCodeAt(1);
    if (second >= 0x30 && second <= 0x39) return true;
  }
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (isStructural(c) || c === delimCode) return true;
  }
  return false;
}

/** Keys are quoted only when they would not parse back unquoted. */
function needsKeyQuote(k: string, delimCode: number): boolean {
  const len = k.length;
  if (len === 0 || hasEdgeSpace(k, k.charCodeAt(0), k.charCodeAt(len - 1))) return true;
  for (let i = 0; i < len; i++) {
    const c = k.charCodeAt(i);
    if (isStructural(c) || c === delimCode) return true;
  }
  return false;
}

/** Always-quoted, escaped form of `s`. */
function quote(s: string): string {
  let out = '"';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c || c === 0x22 || c < 0x20) {
      out += s.slice(last, i) + (c === 0x5c ? "\\\\" : c === 0x22 ? '\\"' : TOON_ESCAPE_TABLE[c]);
      last = i + 1;
    }
  }
  return out + s.slice(last) + '"';
}

/** Quote a TOON string value only when needed. */
function toonQuote(s: string, delim: string): string {
  return needsQuote(s, delim.charCodeAt(0)) ? quote(s) : s;
}

/** Key encoding. `delimCode` is -1 outside tabular headers. */
function encodeKey(k: string, delimCode: number): string {
  return needsKeyQuote(k, delimCode) ? quote(k) : k;
}

const HEX4_RE = /^[0-9a-fA-F]{4}$/;

/** Decode a quoted token; unquoted tokens are returned as-is. */
function toonUnquote(s: string): string {
  const end = s.length - 1;
  if (end < 1 || s.charCodeAt(0) !== 0x22 || s.charCodeAt(end) !== 0x22) return s;
  if (s.indexOf("\\") === -1) return s.slice(1, end);
  let out = "";
  let last = 1;
  for (let i = 1; i < end - 1; i++) {
    if (s.charCodeAt(i) !== 0x5c) continue;
    const next = s.charCodeAt(i + 1);
    let rep: string;
    let skip = 1;
    if (next === 0x6e) rep = "\n";
    else if (next === 0x72) rep = "\r";
    else if (next === 0x74) rep = "\t";
    else if (next === 0x5c || next === 0x22) rep = s[i + 1];
    else if (next === 0x75 && HEX4_RE.test(s.slice(i + 2, i + 6)) && i + 5 < end) {
      rep = String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
      skip = 5;
    } else continue; // unknown escape: kept verbatim
    out += s.slice(last, i) + rep;
    i += skip;
    last = i + 1;
  }
  return out + s.slice(last, end);
}

/** Number → TOON token. JS shortest round-trip form; NaN/±Infinity → null. */
function canonicalNumber(n: number): string {
  return n - n === 0 ? "" + n : "null";
}

/**
 * Strict number token → number, or NaN. Rejects what `+s` would accept but
 * the JSON/TOON number grammar does not: hex/octal/binary, `Infinity`,
 * padding, leading `+`/`.`, trailing `.`, empty string. No allocation.
 */
function parseNumber(s: string): number {
  const len = s.length;
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(len - 1);
  if (!(first === 0x2d || (first >= 0x30 && first <= 0x39)) || !(last >= 0x30 && last <= 0x39)) {
    return NaN;
  }
  for (let i = 1; i < len - 1; i++) {
    const c = s.charCodeAt(i);
    // 0-9 . + - e E
    if (
      !((c >= 0x30 && c <= 0x39) || (c >= 0x2b && c <= 0x2e && c !== 0x2c) || (c | 0x20) === 0x65)
    ) {
      return NaN;
    }
  }
  const n = +s;
  return n - n === 0 ? n : NaN;
}

/**
 * Decode an untyped primitive token (primitive unions, literals,
 * discriminants): quoted → string, true/false/null, number grammar → number,
 * empty → undefined (absent), anything else → the unquoted text.
 */
function decodePrimitive(raw: string): unknown {
  if (raw === "") return undefined;
  if (raw.charCodeAt(0) === 0x22) return toonUnquote(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const n = parseNumber(raw);
  return n === n ? n : raw;
}

/** Serialize any primitive value (literal, enum and primitive-union cells). */
function primitiveToToon(v: unknown, delim: string): string {
  if (typeof v === "string") return toonQuote(v, delim);
  if (typeof v === "number") return canonicalNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return v === null ? "null" : "";
}

/**
 * Split delimited cells, respecting quoted strings. Returns null unless
 * exactly `expected` cells are present.
 */
function splitByDelimiter(s: string, delim: string, expected: number): string[] | null {
  const dc = delim.charCodeAt(0);
  const result = Array<string>(expected);
  let idx = 0;
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inQuote) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inQuote = false;
    } else if (c === 0x22) {
      inQuote = true;
    } else if (c === dc) {
      if (idx === expected - 1) return null;
      result[idx++] = s.slice(start, i);
      start = i + 1;
    }
  }
  if (idx !== expected - 1) return null;
  result[idx] = s.slice(start);
  return result;
}

/** Error context: the current line, or "end of input". */
function getErrorCtx(lines: readonly string[], li: number): string {
  return li < lines.length ? lines[li] : "end of input";
}

/** Value part of a primitive field line `prefix + value`, or null. */
function readField(
  lines: readonly string[],
  li: number,
  prefix: string,
  prefixLen: number,
): string | null {
  if (li >= lines.length || !lines[li].startsWith(prefix)) return null;
  return lines[li].slice(prefixLen);
}

/** Tail (`:...` or `[...`) of a compound field line `prefix + tail`, or null. */
function readTail(
  lines: readonly string[],
  li: number,
  prefix: string,
  prefixLen: number,
): string | null {
  if (li >= lines.length || !lines[li].startsWith(prefix)) return null;
  const c = lines[li].charCodeAt(prefixLen);
  return c === 0x3a || c === 0x5b ? lines[li].slice(prefixLen) : null;
}

/**
 * Split a key line (known to start with `padLen` indentation) into
 * [decoded key, tail]; the tail starts with `:` or `[`. Null for deeper,
 * blank or non-key lines.
 */
function splitKeyLine(line: string, padLen: number): [string, string] | null {
  const c = line.charCodeAt(padLen);
  if (c === 0x20) return null;
  let end = padLen;
  if (c === 0x22) {
    end++;
    while (end < line.length && line.charCodeAt(end) !== 0x22) {
      end += line.charCodeAt(end) === 0x5c ? 2 : 1;
    }
    end++;
  } else {
    while (end < line.length && line.charCodeAt(end) !== 0x3a && line.charCodeAt(end) !== 0x5b) {
      end++;
    }
  }
  const t = line.charCodeAt(end);
  if (end === padLen || (t !== 0x3a && t !== 0x5b)) return null;
  return [toonUnquote(line.slice(padLen, end)), line.slice(end)];
}

/** Array header `[N]` (or `[N<delim>]`) at the start of `tail` → N, or -1. */
function headerCount(tail: string, delimCode: number): number {
  if (tail.charCodeAt(0) !== 0x5b) return -1;
  let i = 1;
  let n = 0;
  for (let c = tail.charCodeAt(i); c >= 0x30 && c <= 0x39; c = tail.charCodeAt(++i)) {
    n = n * 10 + (c - 0x30);
  }
  if (i === 1) return -1;
  if (tail.charCodeAt(i) === delimCode) i++;
  return tail.charCodeAt(i) === 0x5d ? n : -1;
}

/** Find the line `prefix + value` within the block at `pad`; returns the raw value or null. */
function findDiscriminantValue(
  lines: readonly string[],
  li: number,
  pad: string,
  prefix: string,
): string | null {
  for (let i = li; i < lines.length && lines[i].startsWith(pad); i++) {
    if (lines[i].startsWith(prefix)) return lines[i].slice(prefix.length);
  }
  return null;
}

/**
 * Flexible-order scan: index the key lines of the block at `pad` (deeper
 * child lines are skipped). Each key line is rewritten with the canonical key
 * spelling so the schema-order field reader matches it (e.g. `"id": 1` →
 * `id: 1`). Returns [key → line index, end of block].
 */
function scanBlock(lines: string[], li: number, pad: string): [Record<string, number>, number] {
  const map: Record<string, number> = Object.create(null);
  const padLen = pad.length;
  let i = li;
  for (; i < lines.length && lines[i].startsWith(pad); i++) {
    const kv = splitKeyLine(lines[i], padLen);
    if (kv === null) {
      if (lines[i].charCodeAt(padLen) === 0x20) continue; // child line
      break;
    }
    map[kv[0]] = i;
    lines[i] = pad + encodeKey(kv[0], -1) + kv[1];
  }
  return [map, i];
}

// ---------------------------------------------------------------------------
// Schema classification (compile time)
// ---------------------------------------------------------------------------

interface Unwrapped {
  readonly core: Schema;
  readonly opt: boolean;
  readonly nul: boolean;
}

/** Strip optional/nullable wrappers and single-variant unions. */
function unwrap(schema: Schema): Unwrapped {
  let s = schema;
  let opt = false;
  let nul = false;
  for (;;) {
    if (s.kind === "optional") {
      opt = true;
      s = s.meta.inner;
    } else if (s.kind === "nullable") {
      nul = true;
      s = s.meta.inner;
    } else if (s.kind === "union" && s.meta.variants.length === 1) {
      s = s.meta.variants[0];
    } else if (
      s.kind === "union" &&
      s.meta.exclusive !== true &&
      nonNullVariants(s.meta.variants).length === 1
    ) {
      // union(T, null) ≡ nullable(T)
      nul = true;
      s = nonNullVariants(s.meta.variants)[0];
    } else {
      return { core: s, opt, nul };
    }
  }
}

function nonNullVariants(variants: readonly Schema[]): Schema[] {
  return variants.filter((v) => v.kind !== "null");
}

/** True if values of `schema` are single tokens (incl. wrapped and unions of primitives). */
function isPrimitive(schema: Schema): boolean {
  if (isLeaf(schema)) return true; // leaf kinds, possibly optional/nullable-wrapped
  const s = unwrap(schema).core;
  return s.kind === "union" ? (s.meta.variants as Schema[]).every(isPrimitive) : isLeaf(s);
}

/** True for array(object) whose object has ≥1 field, all primitive. */
function isTabular(schema: Schema & { readonly kind: "array" }): boolean {
  const items = schema.meta.items as Schema;
  if (items.kind !== "object") return false;
  const props = items.meta.properties as Record<string, Schema>;
  const keys = Object.keys(props);
  return keys.length > 0 && keys.every((k) => isPrimitive(props[k]));
}

function unsupported(msg: string): TypeError {
  return new TypeError("TOON: unsupported schema shape — " + msg);
}

/**
 * Compile-time gate shared by `stringify` and `parse`, so both factories
 * accept exactly the same shapes. `field` = object property position.
 */
function assertSupported(schema: Schema, field: boolean): void {
  if (isPrimitive(schema)) return;
  const { core, opt } = unwrap(schema);
  if (opt && !field) {
    throw unsupported(`optional(${core.kind}) is only supported as an object field`);
  }
  switch (core.kind) {
    case "object": {
      const props = core.meta.properties as Record<string, Schema>;
      for (const k of Object.keys(props)) assertSupported(props[k], true);
      return;
    }
    case "record":
      return assertSupported(core.meta.values, false);
    case "array":
      return assertSupported(core.meta.items, false);
    case "tuple":
      for (const item of core.meta.items as Schema[]) assertSupported(item, false);
      return;
    case "union":
      if (findDiscriminant(core.meta.variants) === null) {
        throw unsupported(
          "unions with compound variants must be discriminated object unions (or use nullable)",
        );
      }
      for (const v of core.meta.variants as Schema[]) assertSupported(v, false);
      return;
    case "unknown":
    case "allOf":
    case "not":
    case "conditional":
      throw unsupported(`${core.kind} schemas have no TOON layout`);
    default:
      // Primitive kinds were accepted by isPrimitive; anything else is invalid.
      return unreachable(core as never);
  }
}

// ---------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------

export interface ToonStringifyOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
}

interface Gen {
  readonly buf: CodeBuffer;
  readonly indent: number;
  readonly delim: string;
  readonly flexible: boolean;
}

/** Line prefix: compile-time constant `c`, or a runtime JS expression `e`. */
type Prefix =
  | { readonly c: string; readonly e?: undefined }
  | { readonly c?: undefined; readonly e: string };

/** JS expression for `prefix + suffix` (suffix is a constant). */
function pre(p: Prefix, suffix: string): string {
  return p.e === undefined
    ? escapeJsonString(p.c + suffix)
    : `${p.e} + ${escapeJsonString(suffix)}`;
}

/**
 * JS expression reading own property `k` of `acc`. Names that exist on
 * Object.prototype (`toString`, `constructor`, ...) would otherwise read the
 * inherited member when the property is absent.
 */
function propAcc(acc: string, k: string): string {
  const lit = escapeJsonString(k);
  return k in Object.prototype
    ? `(Object.hasOwn(${acc}, ${lit}) ? ${acc}[${lit}] : undefined)`
    : `${acc}[${lit}]`;
}

function pad(g: Gen, depth: number): string {
  return " ".repeat(depth * g.indent);
}

/**
 * Compiles a schema into a TOON stringify function via `new Function`.
 * Throws `TypeError("TOON: unsupported ...")` for shapes TOON cannot
 * round-trip. The compiled function assumes valid input; a value matching no
 * discriminated-union variant throws `TypeError`.
 */
export function stringify<S extends Schema>(
  schema: S,
  options?: ToonStringifyOptions,
): (value: Infer<S>) => string {
  assertSupported(schema, false);
  const g: Gen = {
    buf: createBuffer(),
    indent: options?.indent ?? 2,
    delim: options?.delimiter ?? ",",
    flexible: false,
  };
  emitRef(g.buf, "_q", toonQuote);
  emitRef(g.buf, "_cn", canonicalNumber);
  emitRef(g.buf, "_pv", primitiveToToon);
  emitRef(g.buf, "_delim", g.delim);

  emit(g.buf, "return function toonStringify(v) {");
  g.buf.indent++;
  if (isPrimitive(schema)) {
    emit(g.buf, `return ${cellExpr(schema, "v")};`);
  } else {
    const { core, nul } = unwrap(schema);
    if (nul) emit(g.buf, 'if (v === null) return "null";');
    emit(g.buf, 'var s = "";');
    if (core.kind === "array" || core.kind === "tuple") emitArrayStr(g, core, "v", { c: "" }, 0);
    else emitBodyStr(g, core, "v", 0);
    emit(g.buf, "return s.slice(0, -1);");
  }
  g.buf.indent--;
  emit(g.buf, "}");

  return compileFunction<(value: Infer<S>) => string>(g.buf);
}

/** JS expression serializing a primitive-shaped value as one token. */
function cellExpr(schema: Schema, acc: string): string {
  switch (schema.kind) {
    case "optional":
      return `(${acc} === undefined ? "" : ${cellExpr(schema.meta.inner, acc)})`;
    case "nullable":
      return `(${acc} === null ? "null" : ${cellExpr(schema.meta.inner, acc)})`;
    case "string":
      return `_q(${acc}, _delim)`;
    case "number":
    case "integer":
      return `_cn(${acc})`;
    case "boolean":
      return `(${acc} ? "true" : "false")`;
    case "null":
      return `"null"`;
    default:
      // literal, enum, union of primitives — dispatch on the runtime type
      return `_pv(${acc}, _delim)`;
  }
}

/** Emit a field (`key: v`, `key:` + block, or `key[N]...`) for `acc` at `depth`. */
function emitFieldStr(g: Gen, schema: Schema, acc: string, p: Prefix, depth: number): void {
  if (isPrimitive(schema)) {
    emit(g.buf, `s += ${pre(p, ": ")} + ${cellExpr(schema, acc)} + "\\n";`);
    return;
  }
  const { core, nul } = unwrap(schema);
  if (nul) {
    emit(g.buf, `if (${acc} === null) s += ${pre(p, ": null\n")};`);
    emit(g.buf, "else {");
    g.buf.indent++;
  }
  if (core.kind === "array" || core.kind === "tuple") {
    emitArrayStr(g, core, acc, p, depth);
  } else {
    emit(g.buf, `s += ${pre(p, ":\n")};`);
    emitBodyStr(g, core, acc, depth + 1);
  }
  if (nul) {
    g.buf.indent--;
    emit(g.buf, "}");
  }
}

/** Emit the lines of an object / record / discriminated union at `depth` (no header line). */
function emitBodyStr(g: Gen, core: Schema, acc: string, depth: number): void {
  const padStr = pad(g, depth);
  if (core.kind === "object") {
    const props = core.meta.properties as Record<string, Schema>;
    for (const k of Object.keys(props)) {
      const child = props[k];
      const childAcc = propAcc(acc, k);
      const p: Prefix = { c: padStr + encodeKey(k, -1) };
      if (unwrap(child).opt) {
        emit(g.buf, `if (${childAcc} !== undefined) {`);
        g.buf.indent++;
        emitFieldStr(g, child, childAcc, p, depth);
        g.buf.indent--;
        emit(g.buf, "}");
      } else {
        emitFieldStr(g, child, childAcc, p, depth);
      }
    }
  } else if (core.kind === "record") {
    const ks = freshVar(g.buf);
    const ki = freshVar(g.buf);
    emit(g.buf, `var ${ks} = Object.keys(${acc});`);
    emit(g.buf, `for (var ${ki} = 0; ${ki} < ${ks}.length; ${ki}++) {`);
    g.buf.indent++;
    const p: Prefix = { e: `${escapeJsonString(padStr)} + _q(${ks}[${ki}], _delim)` };
    emitFieldStr(g, core.meta.values, `${acc}[${ks}[${ki}]]`, p, depth);
    g.buf.indent--;
    emit(g.buf, "}");
  } else {
    // Discriminated object union (guaranteed by assertSupported)
    const variants = (core as Schema & { readonly kind: "union" }).meta.variants as Schema[];
    const disc = findDiscriminant(variants) as string;
    emit(g.buf, `switch (${acc}[${escapeJsonString(disc)}]) {`);
    for (const variant of variants) {
      const obj = variant as Schema & { readonly kind: "object" };
      // Literal values are passed by reference, never interpolated as source.
      const lit = emitRef(g.buf, freshVar(g.buf), obj.meta.properties[disc].meta.value);
      emit(g.buf, `case ${lit}:`);
      g.buf.indent++;
      emitBodyStr(g, obj, acc, depth);
      emit(g.buf, "break;");
      g.buf.indent--;
    }
    emit(g.buf, 'default: throw new TypeError("value does not match any union variant");');
    emit(g.buf, "}");
  }
}

/** Emit an array/tuple: header `prefix[N]...` at `depth`, children at depth+1. */
function emitArrayStr(
  g: Gen,
  core: Schema & { readonly kind: "array" | "tuple" },
  acc: string,
  p: Prefix,
  depth: number,
): void {
  if (core.kind === "tuple") {
    const items = core.meta.items as Schema[];
    if (items.every(isPrimitive)) {
      const cells = items.map((it, i) => cellExpr(it, `${acc}[${i}]`)).join(" + _delim + ");
      emit(g.buf, `s += ${pre(p, `[${items.length}]: `)} + ${cells || '""'} + "\\n";`);
      return;
    }
    emit(g.buf, `s += ${pre(p, `[${items.length}]:\n`)};`);
    for (let i = 0; i < items.length; i++) emitListItemStr(g, items[i], `${acc}[${i}]`, depth + 1);
    return;
  }

  const items = core.meta.items as Schema;
  const idx = freshVar(g.buf);
  if (isPrimitive(items)) {
    // Inline loop — keeps everything in one function for Turbofan.
    emit(g.buf, `s += ${pre(p, "[")} + ${acc}.length + "]: ";`);
    emit(g.buf, `if (${acc}.length > 0) {`);
    emit(g.buf, `  s += ${cellExpr(items, `${acc}[0]`)};`);
    emit(
      g.buf,
      `  for (var ${idx} = 1; ${idx} < ${acc}.length; ${idx}++) s += _delim + ${cellExpr(items, `${acc}[${idx}]`)};`,
    );
    emit(g.buf, "}");
    emit(g.buf, 's += "\\n";');
    return;
  }
  if (isTabular(core)) {
    const obj = items as Schema & { readonly kind: "object" };
    const fields = Object.keys(obj.meta.properties);
    const dc = g.delim.charCodeAt(0);
    const header = "]{" + fields.map((f) => encodeKey(f, dc)).join(g.delim) + "}:\n";
    emit(g.buf, `s += ${pre(p, "[")} + ${acc}.length + ${escapeJsonString(header)};`);
    emit(g.buf, `for (var ${idx} = 0; ${idx} < ${acc}.length; ${idx}++) {`);
    g.buf.indent++;
    const row = freshVar(g.buf);
    emit(g.buf, `var ${row} = ${acc}[${idx}];`);
    const cells = fields.map((f) => cellExpr(obj.meta.properties[f], propAcc(row, f)));
    const childPad = escapeJsonString(pad(g, depth + 1));
    emit(g.buf, `s += ${childPad} + ${cells.join(" + _delim + ")} + "\\n";`);
    g.buf.indent--;
    emit(g.buf, "}");
    return;
  }
  emit(g.buf, `s += ${pre(p, "[")} + ${acc}.length + "]:\\n";`);
  emit(g.buf, `for (var ${idx} = 0; ${idx} < ${acc}.length; ${idx}++) {`);
  g.buf.indent++;
  emitListItemStr(g, items, `${acc}[${idx}]`, depth + 1);
  g.buf.indent--;
  emit(g.buf, "}");
}

/** Emit one `- ` list item for `acc`; the hyphen sits at `depth`. */
function emitListItemStr(g: Gen, schema: Schema, acc: string, depth: number): void {
  const hyphen = pad(g, depth) + "-";
  if (isPrimitive(schema)) {
    emit(g.buf, `s += ${escapeJsonString(hyphen + " ")} + ${cellExpr(schema, acc)} + "\\n";`);
    return;
  }
  const { core, nul } = unwrap(schema);
  if (nul) {
    emit(g.buf, `if (${acc} === null) s += ${escapeJsonString(hyphen + " null\n")};`);
    emit(g.buf, "else {");
    g.buf.indent++;
  }
  if (core.kind === "array" || core.kind === "tuple") {
    emitArrayStr(g, core, acc, { c: hyphen + " " }, depth);
  } else {
    // Render the body one level deeper into a fresh buffer, then move its
    // first line onto the hyphen line (`- first: v`); empty body → bare `-`.
    const saved = freshVar(g.buf);
    emit(g.buf, `var ${saved} = s;`);
    emit(g.buf, 's = "";');
    emitBodyStr(g, core, acc, depth + 1);
    const bodyPadLen = pad(g, depth + 1).length;
    emit(
      g.buf,
      `s = ${saved} + (s === "" ? ${escapeJsonString(hyphen + "\n")} : ${escapeJsonString(hyphen + " ")} + s.slice(${bodyPadLen}));`,
    );
  }
  if (nul) {
    g.buf.indent--;
    emit(g.buf, "}");
  }
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export interface ToonParseOptions {
  readonly indent?: number;
  readonly delimiter?: "," | "\t" | "|";
  /** @deprecated No effect — parsing is always strict (counts, number grammar, literals). */
  readonly strict?: boolean;
  /**
   * Accept object fields in any order, at every nesting level (~2.5x slower
   * for a 3-field object; see TOON.bench).
   * Tabular headers must still list fields in schema order.
   */
  readonly flexibleOrder?: boolean;
}

/**
 * Compiles a schema into a TOON parse function via `new Function`. Throws
 * `TypeError("TOON: unsupported ...")` for the same shapes as `stringify`.
 * The compiled function never throws; it returns `Err` on malformed input.
 */
export function parse<S extends Schema>(
  schema: S,
  options?: ToonParseOptions,
): (toon: string) => Result<Infer<S>, SchemaError> {
  assertSupported(schema, false);
  const g: Gen = {
    buf: createBuffer(),
    indent: options?.indent ?? 2,
    delim: options?.delimiter ?? ",",
    flexible: options?.flexibleOrder ?? false,
  };
  const buf = g.buf;
  emitStandardRefs(buf, ok, err);
  emitRef(buf, "_uq", toonUnquote);
  emitRef(buf, "_pn", parseNumber);
  emitRef(buf, "_dec", decodePrimitive);
  emitRef(buf, "_rf", readField);
  emitRef(buf, "_rt", readTail);
  emitRef(buf, "_ge", getErrorCtx);
  emitRef(buf, "_split", splitByDelimiter);
  emitRef(buf, "_kl", splitKeyLine);
  emitRef(buf, "_hc", headerCount);
  emitRef(buf, "_fd", findDiscriminantValue);
  emitRef(buf, "_scan", scanBlock);
  emitRef(buf, "_delim", g.delim);

  emit(buf, "return function toonParse(input) {");
  buf.indent++;
  emit(buf, 'var lines = input.split("\\n");');
  emit(buf, "var li = 0;");
  const out = freshVar(buf);
  if (isPrimitive(schema)) {
    emit(buf, "var raw = lines[li++].trim();");
    emitCell(g, schema, "raw", '""', out);
  } else {
    const { core, nul } = unwrap(schema);
    emit(buf, `var ${out} = null;`);
    if (nul) {
      emit(buf, 'if (input.trim() === "null") li = lines.length;');
      emit(buf, "else {");
      buf.indent++;
    }
    const v = freshVar(buf);
    if (core.kind === "array" || core.kind === "tuple") {
      emitHeaderParse(g, core, "lines[0]", 0, '""', v);
    } else {
      emitBodyParse(g, core, 0, '""', v);
    }
    emit(buf, `${out} = ${v};`);
    if (nul) {
      buf.indent--;
      emit(buf, "}");
    }
  }
  // Everything must be consumed (trailing blank lines allowed) — leftovers
  // mean the input does not match the schema's layout.
  emit(buf, 'while (li < lines.length && lines[li].trim() === "") li++;');
  emit(buf, 'if (li < lines.length) return _err(_me("", "end of input", lines[li]));');
  emit(buf, `return _ok(${out});`);
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(toon: string) => Result<Infer<S>, SchemaError>>(buf);
}

/**
 * Emit code decoding the token in variable `raw` for a primitive-shaped
 * schema into `out` (declared here). An empty token means "absent": it yields
 * `undefined` when an `optional` wrapper allows it, an error otherwise.
 */
function emitCell(g: Gen, schema: Schema, raw: string, path: string, out: string): void {
  const buf = g.buf;
  const { core, opt, nul } = unwrap(schema);
  emit(buf, `var ${out};`);
  const fail = (expected: string): string =>
    `return _err(_me(${path}, ${escapeJsonString(expected)}, ${raw}));`;
  let open = 0;
  if (opt) {
    emit(buf, `if (${raw} === "") ${out} = undefined; else {`);
    open++;
  }
  if (nul) {
    emit(buf, `if (${raw} === "null") ${out} = null; else {`);
    open++;
  }
  switch (core.kind) {
    case "string":
      emit(buf, `if (${raw} === "") ${fail("string")}`);
      emit(buf, `${out} = _uq(${raw});`);
      break;
    case "number":
      emit(buf, `${out} = _pn(${raw});`);
      emit(buf, `if (${out} !== ${out}) ${fail("number")}`);
      break;
    case "integer":
      emit(buf, `${out} = _pn(${raw});`);
      emit(buf, `if (!_isSafe(${out})) ${fail("integer")}`);
      break;
    case "boolean":
      emit(buf, `if (${raw} === "true") ${out} = true;`);
      emit(buf, `else if (${raw} === "false") ${out} = false;`);
      emit(buf, `else ${fail("boolean")}`);
      break;
    case "null":
      emit(buf, `if (${raw} !== "null") ${fail("null")}`);
      emit(buf, `${out} = null;`);
      break;
    case "literal": {
      const value = core.meta.value as string | number | boolean | null;
      const lit = emitRef(buf, freshVar(buf), value);
      emit(buf, `${out} = ${typeof value === "string" ? "_uq" : "_dec"}(${raw});`);
      const label = "literal(" + JSON.stringify(value) + ")";
      emit(buf, `if (${raw} === "" || ${out} !== ${lit}) ${fail(label)}`);
      break;
    }
    case "enum": {
      const set = emitRef(buf, freshVar(buf), new Set(core.meta.values as (string | number)[]));
      // Typed decode first (quoted "1" vs number 1), then the plain text for
      // string members written without quotes.
      emit(buf, `${out} = _dec(${raw});`);
      emit(buf, `if (!${set}.has(${out})) {`);
      emit(buf, `  ${out} = _uq(${raw});`);
      emit(buf, `  if (${raw} === "" || !${set}.has(${out})) ${fail("enum")}`);
      emit(buf, "}");
      break;
    }
    default: {
      // Union of primitives: decode the token's own type, then the first
      // variant whose validator accepts it wins.
      const union = core as Schema & { readonly kind: "union" };
      const variants = union.meta.variants as Schema[];
      emit(buf, `${out} = _dec(${raw});`);
      // oneOf needs the whole-union validator (exactly one variant matches)
      const checks =
        union.meta.exclusive === true
          ? [`!${emitRef(buf, freshVar(buf), validate(union))}(${out})[0]`]
          : variants.map((v) => `!${emitRef(buf, freshVar(buf), validate(v))}(${out})[0]`);
      emit(buf, `if (${checks.join(" && ") || "true"}) ${fail("union")}`);
      break;
    }
  }
  for (; open > 0; open--) emit(buf, "}");
}

/** Emit parsing of an object / record / discriminated-union body at `depth` into `out`. */
function emitBodyParse(g: Gen, core: Schema, depth: number, path: string, out: string): void {
  if (core.kind === "object") emitObjectParse(g, core, depth, path, out);
  else if (core.kind === "record") emitRecordParse(g, core, depth, path, out);
  else emitDiscParse(g, core as Schema & { readonly kind: "union" }, depth, path, out);
}

function emitObjectParse(
  g: Gen,
  schema: Schema & { readonly kind: "object" },
  depth: number,
  path: string,
  out: string,
): void {
  const buf = g.buf;
  const padStr = pad(g, depth);
  const props = schema.meta.properties as Record<string, Schema>;
  emit(buf, `var ${out} = {};`);
  const scan = freshVar(buf);
  if (g.flexible) emit(buf, `var ${scan} = _scan(lines, li, ${escapeJsonString(padStr)});`);
  for (const k of Object.keys(props)) {
    const child = props[k];
    const { core, opt, nul } = unwrap(child);
    const kLit = escapeJsonString(k);
    const kPath = childPath(path, k);
    const prefix = padStr + encodeKey(k, -1);
    const missing = `return _err(_me(${kPath}, ${escapeJsonString("key '" + k + "'")}, _ge(lines, li)));`;
    if (g.flexible) {
      emit(buf, `if (${kLit} in ${scan}[0]) {`);
      emit(buf, `li = ${scan}[0][${kLit}];`);
    }
    const tmp = freshVar(buf);
    const v = freshVar(buf);
    const prim = isPrimitive(child);
    if (prim) {
      const pfx = prefix + ": ";
      emit(buf, `var ${tmp} = _rf(lines, li, ${escapeJsonString(pfx)}, ${pfx.length});`);
    } else {
      emit(buf, `var ${tmp} = _rt(lines, li, ${escapeJsonString(prefix)}, ${prefix.length});`);
    }
    emit(buf, opt ? `if (${tmp} !== null) {` : `if (${tmp} === null) ${missing}`);
    if (prim) {
      emit(buf, "li++;");
      emitCell(g, child, tmp, kPath, v);
    } else {
      emitTailParse(g, core, nul, tmp, depth, kPath, v);
    }
    // Absent optionals stay absent; `__proto__` is never assigned (pollution).
    if (k !== "__proto__") emit(buf, `if (${v} !== undefined) ${out}[${kLit}] = ${v};`);
    if (opt) emit(buf, "}");
    if (g.flexible) emit(buf, opt ? "}" : `} else ${missing}`);
  }
  if (g.flexible) emit(buf, `li = ${scan}[1];`);
}

/**
 * Emit parsing of a compound value whose key line is `lines[li]`; `tail`
 * (a variable) holds the text after the key: `:`, `: null` or `[N]...`.
 */
function emitTailParse(
  g: Gen,
  core: Schema,
  nul: boolean,
  tail: string,
  depth: number,
  path: string,
  out: string,
): void {
  const buf = g.buf;
  emit(buf, `var ${out} = null;`);
  if (nul) {
    emit(buf, `if (${tail} === ": null") li++;`);
    emit(buf, "else {");
    buf.indent++;
  }
  const v = freshVar(buf);
  if (core.kind === "array" || core.kind === "tuple") {
    emitHeaderParse(g, core, tail, depth, path, v);
  } else {
    emit(buf, `if (${tail} !== ":") return _err(_me(${path}, "nested block", lines[li]));`);
    emit(buf, "li++;");
    emitBodyParse(g, core, depth + 1, path, v);
  }
  emit(buf, `${out} = ${v};`);
  if (nul) {
    buf.indent--;
    emit(buf, "}");
  }
}

/** Emit parsing of an array/tuple whose header line is `lines[li]`; `tail` starts at `[`. */
function emitHeaderParse(
  g: Gen,
  core: Schema & { readonly kind: "array" | "tuple" },
  tail: string,
  depth: number,
  path: string,
  out: string,
): void {
  const buf = g.buf;
  const n = freshVar(buf);
  const rest = freshVar(buf);
  const idx = freshVar(buf);
  emit(buf, `var ${n} = _hc(${tail}, ${g.delim.charCodeAt(0)});`);
  emit(buf, `if (${n} < 0) return _err(_me(${path}, "array header", _ge(lines, li)));`);
  emit(buf, `var ${rest} = ${tail}.slice(${tail}.indexOf("]") + 1);`);
  emit(buf, "li++;");
  emit(buf, `var ${out} = [];`);
  const fixed = core.kind === "tuple" ? (core.meta.items as Schema[]) : null;
  if (fixed !== null) {
    emit(
      buf,
      `if (${n} !== ${fixed.length}) return _err(_me(${path}, "${fixed.length} items", "" + ${n}));`,
    );
  }
  const inline = fixed !== null ? fixed.every(isPrimitive) : isPrimitive(core.meta.items);

  if (inline) {
    const cells = freshVar(buf);
    emit(buf, `var ${cells} = ${n} === 0 && (${rest} === ":" || ${rest} === ": ") ? [] :`);
    emit(buf, `  ${rest}.startsWith(": ") ? _split(${rest}.slice(2), _delim, ${n}) : null;`);
    emit(buf, `if (${cells} === null) return _err(_me(${path}, ${n} + " inline items", ${rest}));`);
    if (fixed !== null) {
      for (let i = 0; i < fixed.length; i++) {
        const v = freshVar(buf);
        emit(buf, `var ${v}_r = ${cells}[${i}];`);
        emitCell(g, fixed[i], `${v}_r`, childPath(path, String(i)), v);
        emit(buf, `${out}.push(${v});`);
      }
    } else {
      emit(buf, `for (var ${idx} = 0; ${idx} < ${n}; ${idx}++) {`);
      buf.indent++;
      const v = freshVar(buf);
      emit(buf, `var ${v}_r = ${cells}[${idx}];`);
      emitCell(g, core.meta.items, `${v}_r`, dynamicChildPath(path, idx), v);
      emit(buf, `${out}.push(${v});`);
      buf.indent--;
      emit(buf, "}");
    }
  } else if (fixed === null && isTabular(core as Schema & { readonly kind: "array" })) {
    const obj = core.meta.items as Schema & { readonly kind: "object" };
    const props = obj.meta.properties as Record<string, Schema>;
    const fields = Object.keys(props);
    const dc = g.delim.charCodeAt(0);
    const header = "{" + fields.map((f) => encodeKey(f, dc)).join(g.delim) + "}:";
    const rowPad = pad(g, depth + 1);
    emit(
      buf,
      `if (${rest} !== ${escapeJsonString(header)}) return _err(_me(${path}, ${escapeJsonString("tabular header " + header)}, ${rest}));`,
    );
    emit(buf, `for (var ${idx} = 0; ${idx} < ${n}; ${idx}++) {`);
    buf.indent++;
    const rowPath = dynamicChildPath(path, idx);
    const cells = freshVar(buf);
    emit(
      buf,
      `var ${cells} = li < lines.length && lines[li].startsWith(${escapeJsonString(rowPad)}) ? _split(lines[li].slice(${rowPad.length}), _delim, ${fields.length}) : null;`,
    );
    emit(
      buf,
      `if (${cells} === null) return _err(_me(${rowPath}, "tabular row", _ge(lines, li)));`,
    );
    emit(buf, "li++;");
    const row = freshVar(buf);
    emit(buf, `var ${row} = {};`);
    for (let j = 0; j < fields.length; j++) {
      const f = fields[j];
      const v = freshVar(buf);
      emit(buf, `var ${v}_r = ${cells}[${j}];`);
      // Field names are untrusted (e.g. from fromJsonSchema): always emitted
      // as escaped string literals, never raw inside generated source.
      emitCell(g, props[f], `${v}_r`, `${rowPath} + ${escapeJsonString("." + f)}`, v);
      if (f !== "__proto__") {
        emit(buf, `if (${v} !== undefined) ${row}[${escapeJsonString(f)}] = ${v};`);
      }
    }
    emit(buf, `${out}.push(${row});`);
    buf.indent--;
    emit(buf, "}");
  } else {
    emit(buf, `if (${rest} !== ":") return _err(_me(${path}, "list header", ${rest}));`);
    if (fixed !== null) {
      for (let i = 0; i < fixed.length; i++) {
        const v = freshVar(buf);
        emitListItemParse(g, fixed[i], depth + 1, childPath(path, String(i)), v);
        emit(buf, `${out}.push(${v});`);
      }
    } else {
      emit(buf, `for (var ${idx} = 0; ${idx} < ${n}; ${idx}++) {`);
      buf.indent++;
      const v = freshVar(buf);
      emitListItemParse(g, core.meta.items, depth + 1, dynamicChildPath(path, idx), v);
      emit(buf, `${out}.push(${v});`);
      buf.indent--;
      emit(buf, "}");
    }
  }
}

/** Emit parsing of one `- ` list item whose hyphen sits at `depth`. */
function emitListItemParse(g: Gen, schema: Schema, depth: number, path: string, out: string): void {
  const buf = g.buf;
  const hyphen = pad(g, depth) + "-";
  const hl = hyphen.length;
  const line = freshVar(buf);
  const content = freshVar(buf);
  emit(
    buf,
    `if (li >= lines.length || !lines[li].startsWith(${escapeJsonString(hyphen)})) return _err(_me(${path}, "list item", _ge(lines, li)));`,
  );
  emit(buf, `var ${line} = lines[li];`);
  // After the hyphen: nothing (bare `-`), or one space and the content.
  emit(
    buf,
    `if (${line}.length > ${hl} && ${line}.charCodeAt(${hl}) !== 32) return _err(_me(${path}, "list item", ${line}));`,
  );
  emit(buf, `var ${content} = ${line}.slice(${hl + 1});`);
  if (isPrimitive(schema)) {
    emit(buf, "li++;");
    emitCell(g, schema, content, path, out);
    return;
  }
  const { core, nul } = unwrap(schema);
  emit(buf, `var ${out} = null;`);
  if (nul) {
    emit(buf, `if (${content} === "null") li++;`);
    emit(buf, "else {");
    buf.indent++;
  }
  const v = freshVar(buf);
  if (core.kind === "array" || core.kind === "tuple") {
    emitHeaderParse(g, core, content, depth, path, v);
  } else {
    // `- first: v` → re-indent the hyphen line to body depth and parse the
    // body normally; a bare `-` is an empty body.
    emit(buf, `if (${content} === "") li++;`);
    emit(buf, `else lines[li] = ${escapeJsonString(pad(g, depth + 1))} + ${content};`);
    emitBodyParse(g, core, depth + 1, path, v);
  }
  emit(buf, `${out} = ${v};`);
  if (nul) {
    buf.indent--;
    emit(buf, "}");
  }
}

function emitRecordParse(
  g: Gen,
  schema: Schema & { readonly kind: "record" },
  depth: number,
  path: string,
  out: string,
): void {
  const buf = g.buf;
  const padStr = pad(g, depth);
  const values = schema.meta.values as Schema;
  const kv = freshVar(buf);
  const key = freshVar(buf);
  const tail = freshVar(buf);
  emit(buf, `var ${out} = {};`);
  emit(buf, `while (li < lines.length && lines[li].startsWith(${escapeJsonString(padStr)})) {`);
  buf.indent++;
  emit(buf, `var ${kv} = _kl(lines[li], ${padStr.length});`);
  emit(buf, `if (${kv} === null) break;`);
  emit(buf, `var ${key} = ${kv}[0], ${tail} = ${kv}[1];`);
  const vPath = dynamicChildPath(path, key);
  const v = freshVar(buf);
  if (isPrimitive(values)) {
    emit(buf, `if (!${tail}.startsWith(": ")) return _err(_me(${vPath}, "value", lines[li]));`);
    emit(buf, "li++;");
    emit(buf, `var ${v}_r = ${tail}.slice(2);`);
    emitCell(g, values, `${v}_r`, vPath, v);
  } else {
    const { core, nul } = unwrap(values);
    emitTailParse(g, core, nul, tail, depth, vPath, v);
  }
  // Prototype pollution guard — never assign an own `__proto__` key.
  emit(buf, `if (${key} !== "__proto__") ${out}[${key}] = ${v};`);
  buf.indent--;
  emit(buf, "}");
}

function emitDiscParse(
  g: Gen,
  schema: Schema & { readonly kind: "union" },
  depth: number,
  path: string,
  out: string,
): void {
  const buf = g.buf;
  const variants = schema.meta.variants as (Schema & { readonly kind: "object" })[];
  const disc = findDiscriminant(variants) as string;
  const padStr = pad(g, depth);
  const prefix = padStr + encodeKey(disc, -1) + ": ";
  const raw = freshVar(buf);
  const dv = freshVar(buf);
  const discPath = childPath(path, disc);
  emit(
    buf,
    `var ${raw} = _fd(lines, li, ${escapeJsonString(padStr)}, ${escapeJsonString(prefix)});`,
  );
  emit(
    buf,
    `if (${raw} === null) return _err(_me(${discPath}, ${escapeJsonString("key '" + disc + "'")}, _ge(lines, li)));`,
  );
  emit(buf, `var ${dv} = _dec(${raw});`);
  emit(buf, `var ${out} = null;`);
  for (let i = 0; i < variants.length; i++) {
    const lit = emitRef(buf, freshVar(buf), variants[i].meta.properties[disc].meta.value);
    emit(buf, `${i === 0 ? "" : "else "}if (${dv} === ${lit}) {`);
    buf.indent++;
    const v = freshVar(buf);
    emitObjectParse(g, variants[i], depth, path, v);
    emit(buf, `${out} = ${v};`);
    buf.indent--;
    emit(buf, "}");
  }
  emit(buf, `else return _err(_me(${discPath}, "discriminant", ${raw}));`);
}
