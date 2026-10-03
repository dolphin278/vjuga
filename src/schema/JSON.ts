/**
 * JSON — code-generated JSON serializers and parsers from Schema definitions.
 *
 * When to use: a schema is known at init time and you want typed parse +
 * validation in one step (`parse` → `Result<T, SchemaError>`, never throws) or
 * a serializer that emits only declared keys (`unknown` / `not` values as-is).
 * For ad-hoc JSON use `@dolphin278/vjuga/JSON`. Not a speed win for stringify.
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
 *   Non-finite numbers emit `null`; static `allOf` shapes merge at compile
 *   time, others resolve per call (slower). parse: native `JSON.parse` +
 *   generated validation; own `__proto__` keys (also `\u`-escaped
 *   spellings) are stripped. `constructor` is kept.
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
import { allOf, findDiscriminant, object, optional, propertyMayBeAbsent } from "./Schema.js";
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

/**
 * A JSON `\u` escape of a character of `__proto__`: `_` 5f, `o` 6f, `p` 70,
 * `r` 72, `t` 74 (hex digits are case-insensitive in JSON). Every spelling of
 * the key other than the literal one contains such an escape.
 */
const PROTO_ESCAPE = /\\u00(?:[56][fF]|7[024])/;

/**
 * JSON text of an `unknown` / `not` value where the slot cannot be omitted
 * (array / tuple item, root): a value with no JSON form — undefined, a
 * function, a symbol — is `null`, as in native `JSON.stringify` arrays.
 */
function unknownToJson(x: unknown): string {
  const s = JSON.stringify(x);
  return s === undefined ? "null" : s;
}

/** True if a function or symbol: values native `JSON.stringify` omits or nulls. */
function hasNoJson(x: unknown): boolean {
  return typeof x === "function" || typeof x === "symbol";
}

/**
 * True for an `unknown` / `not` property or record value (optional-wrapped
 * too): its JSON text is computed first and the key omitted when the value
 * has none (function, symbol, undefined), like native `JSON.stringify`.
 */
function mayHaveNoJson(schema: Schema): boolean {
  let s = schema;
  while (s.kind === "optional") s = s.meta.inner;
  return s.kind === "unknown" || s.kind === "not";
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
 *
 * Objects emit only their declared keys, even with `additionalProperties:
 * true`. An `allOf` emits the keys of every variant (a `record` variant: all
 * own keys), a `conditional` those of the branch its `if` selects; `unknown`
 * and `not` declare nothing, so their values are emitted as-is. As in native
 * `JSON.stringify`, an undefined record value omits its key, and a value with
 * no JSON form (function, symbol) omits its object / record key and is `null`
 * in an array slot or at the root.
 */
export function stringify<S extends Schema>(schema: S): (value: Infer<S>) => string {
  const buf = createBuffer();
  emitRef(buf, "_esc", escapeJsonString);
  emitRef(buf, "_num", numberToJson);
  emitRef(buf, "_js", JSON.stringify);
  emitRef(buf, "_ju", unknownToJson);
  emitRef(buf, "_ix", stringifyCombinator);

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
    case "not":
      // Nothing is declared about the value — it is serialized as-is. Here
      // the slot cannot be omitted: undefined / function / symbol emit null
      // (object fields and record values omit the key instead).
      return `_ju(${accessor})`;
    case "allOf": {
      const merged = mergeAllOf(schema);
      if (merged !== null) return walkStringify(buf, merged, accessor);
      return `_ix(${emitRef(buf, freshVar(buf), schema)}, ${accessor})`;
    }
    case "conditional":
      // The applicable shapes depend on the value: resolved per call
      return `_ix(${emitRef(buf, freshVar(buf), schema)}, ${accessor})`;
    default:
      unreachable(schema);
  }
}

// ---------------------------------------------------------------------------
// allOf / conditional: shapes resolved against the value
// ---------------------------------------------------------------------------

/**
 * Compile-time shape of an allOf whose shapes do not depend on the value
 * (nested allOf flattened, `unknown` / `not` dropped, `optional` unwrapped):
 * the single shape, or one object declaring every object variant's keys, each
 * the allOf of its declarations. Null when a conditional, union, nullable or
 * a mix of kinds is involved — those are resolved per call (`_ix`).
 */
function mergeAllOf(schema: Schema & { readonly kind: "allOf" }): Schema | null {
  const shapes: Schema[] = [];
  const guarded: (Schema & { readonly kind: "conditional" })[] = [];
  if (!collectStaticShapes(schema, shapes, guarded)) return null;
  // A conditional on a bare type guard (what untyped JSON Schema keyword
  // groups lower to) is decided once another variant fixes the type
  while (guarded.length > 0) {
    const known = shapeType(shapes);
    const cond = guarded.pop()!;
    const guard = guardType(cond.meta.if);
    if (known === null || guard === null) return null;
    const branch = guard === known ? cond.meta.then : cond.meta.else;
    if (!collectStaticShapes(branch, shapes, guarded)) return null;
  }
  if (shapes.length === 0) return null;
  let merged: Schema;
  if (shapes.length === 1) merged = shapes[0];
  else {
    const decls: Record<string, Schema[]> = Object.create(null);
    const keys: string[] = [];
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (shape.kind !== "object") return null;
      for (const k of Object.keys(shape.meta.properties)) {
        if (decls[k] === undefined) {
          decls[k] = [];
          keys.push(k);
        }
        decls[k].push(shape.meta.properties[k]);
      }
    }
    const props: Record<string, Schema> = {};
    for (let i = 0; i < keys.length; i++) {
      const list = decls[keys[i]];
      // defineProperty keeps a "__proto__" key as data
      Object.defineProperty(props, keys[i], {
        value: list.length === 1 ? list[0] : allOf(...list),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    merged = object(props, { additionalProperties: true });
  }
  // Undefined outside an object field still emits null, like optional(T)
  return propertyMayBeAbsent(schema) ? optional(merged) : merged;
}

function collectStaticShapes(
  schema: Schema,
  out: Schema[],
  guarded: (Schema & { readonly kind: "conditional" })[],
): boolean {
  switch (schema.kind) {
    case "allOf": {
      const variants = schema.meta.variants as readonly Schema[];
      for (let i = 0; i < variants.length; i++) {
        if (!collectStaticShapes(variants[i], out, guarded)) return false;
      }
      return true;
    }
    case "optional":
      return collectStaticShapes(schema.meta.inner, out, guarded);
    case "unknown":
    case "not":
      return true;
    case "conditional":
      guarded.push(schema);
      return true;
    case "union":
    case "nullable":
      return false;
    default:
      out.push(schema);
      return true;
  }
}

/** "object" / "array" when a collected shape fixes the value's type. */
function shapeType(shapes: readonly Schema[]): "object" | "array" | null {
  for (let i = 0; i < shapes.length; i++) {
    const kind = shapes[i].kind;
    if (kind === "object" || kind === "record") return "object";
    if (kind === "array" || kind === "tuple") return "array";
  }
  return null;
}

/**
 * The JSON type a schema accepts every value of and nothing else, if any.
 * (No "array": `array(unknown())` rejects an element that is undefined, which
 * a tuple with an optional slot accepts.)
 */
function guardType(guard: Schema): string | null {
  switch (guard.kind) {
    case "object":
      return guard.meta.additionalProperties === true &&
        Object.keys(guard.meta.properties).length === 0
        ? "object"
        : null;
    case "string":
      return guard.meta === undefined ? "string" : null;
    case "number":
      return guard.meta === undefined ? "number" : null;
    default:
      return null;
  }
}

/** Compiled `stringify` of a plain shape, by identity. */
const shapeStringifiers = new WeakMap<Schema, (v: unknown) => string>();
// Cast: Infer<> over the base `Schema` union is too deep for tsc
const validateAny = validate as unknown as (s: Schema) => (x: unknown) => Result<unknown, unknown>;
const stringifyAny = stringify as unknown as (s: Schema) => (v: unknown) => string;

/** Compiled acceptance check of a schema, by identity. */
const acceptors = new WeakMap<Schema, (v: unknown) => boolean>();

function accepts(schema: Schema, v: unknown): boolean {
  let check = acceptors.get(schema);
  if (check === undefined) {
    const validator = validateAny(schema);
    check = (x) => validator(x)[0];
    acceptors.set(schema, check);
  }
  return check(v);
}

function shapeStringify(schema: Schema, v: unknown): string {
  let str = shapeStringifiers.get(schema);
  if (str === undefined) {
    str = stringifyAny(schema);
    shapeStringifiers.set(schema, str);
  }
  return str(v);
}

/**
 * Push the shapes that describe `v` under `schema`: allOf contributes every
 * variant, a conditional the branch its `if` selects, a union the first
 * variant that accepts `v` (like the union serializer). `unknown` / `not`
 * declare nothing and contribute no shape.
 */
function collectShapes(schema: Schema, v: unknown, out: Schema[]): void {
  switch (schema.kind) {
    case "allOf": {
      const variants = schema.meta.variants as readonly Schema[];
      for (let i = 0; i < variants.length; i++) collectShapes(variants[i], v, out);
      return;
    }
    case "conditional":
      collectShapes(accepts(schema.meta.if, v) ? schema.meta.then : schema.meta.else, v, out);
      return;
    case "union": {
      const variants = schema.meta.variants as readonly Schema[];
      for (let i = 0; i < variants.length; i++) {
        if (accepts(variants[i], v)) {
          collectShapes(variants[i], v, out);
          return;
        }
      }
      throw new TypeError("value does not match any union variant");
    }
    case "optional":
      if (v !== undefined) collectShapes(schema.meta.inner, v, out);
      return;
    case "nullable":
      if (v !== null) collectShapes(schema.meta.inner, v, out);
      return;
    case "unknown":
    case "not":
      return;
    default:
      out.push(schema);
  }
}

/** `stringify` of an allOf / conditional node (`_ix` in generated code). */
function stringifyCombinator(schema: Schema, v: unknown): string {
  return stringifyShapes([schema], v);
}

/**
 * Serialize `v`, valid for every schema in `schemas`, emitting exactly the
 * keys the applicable shapes declare: the union of their object properties,
 * or every own key when a record applies. A single shape uses its compiled
 * serializer; with no shape (only `unknown` / `not`) the value is emitted
 * as-is.
 */
function stringifyShapes(schemas: readonly Schema[], v: unknown): string {
  // No JSON form (only `unknown` / `not` admit a function or symbol): null,
  // like an array item in native JSON.stringify
  if (v === undefined || hasNoJson(v)) return "null";
  if (typeof v !== "object" || v === null) {
    // Primitive output depends only on the value, not on the shapes
    if (typeof v === "string") return escapeJsonString(v);
    return typeof v === "number" ? numberToJson(v) : String(v);
  }
  const shapes: Schema[] = [];
  for (let i = 0; i < schemas.length; i++) collectShapes(schemas[i], v, shapes);
  if (shapes.length === 1) return shapeStringify(shapes[0], v);
  if (shapes.length === 0) return unknownToJson(v);
  return Array.isArray(v) ? stringifyArrayShapes(shapes, v) : stringifyObjectShapes(shapes, v);
}

function stringifyArrayShapes(shapes: readonly Schema[], a: readonly unknown[]): string {
  let s = "[";
  for (let i = 0; i < a.length; i++) {
    const per: Schema[] = [];
    for (let j = 0; j < shapes.length; j++) {
      const shape = shapes[j];
      if (shape.kind === "array") per.push(shape.meta.items);
      else if (shape.kind === "tuple" && i < shape.meta.items.length) {
        per.push(shape.meta.items[i]);
      }
    }
    s += (i === 0 ? "" : ",") + stringifyShapes(per, a[i]);
  }
  return s + "]";
}

function stringifyObjectShapes(shapes: readonly Schema[], o: object): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  let open = false;
  for (let j = 0; j < shapes.length; j++) {
    const shape = shapes[j];
    if (shape.kind === "record") open = true;
    else if (shape.kind === "object") {
      for (const k of Object.keys(shape.meta.properties)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  if (open) {
    // A record applies: every own enumerable key belongs to the value
    for (const k in o) if (Object.hasOwn(o, k) && !seen.has(k)) keys.push(k);
  }
  let s = "{";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    // Own reads only: `toString` must not pick up Object.prototype's member
    const x = Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined;
    if (x === undefined || hasNoJson(x)) continue; // omitted, as natively
    const per: Schema[] = [];
    for (let j = 0; j < shapes.length; j++) {
      const shape = shapes[j];
      if (shape.kind === "record") per.push(shape.meta.values);
      else if (shape.kind === "object" && Object.hasOwn(shape.meta.properties, k)) {
        per.push(shape.meta.properties[k]);
      }
    }
    s += (s === "{" ? "" : ",") + escapeJsonString(k) + ":" + stringifyShapes(per, x);
  }
  return s + "}";
}

function walkStringifyObject(
  buf: CodeBuffer,
  props: Record<string, Schema>,
  accessor: string,
): string {
  const keys = Object.keys(props);
  if (keys.length === 0) return `"{}"`;

  // unknown / not fields take the helper path too: a function / symbol value
  // omits its key (+~20 ns per object on node vs the inline expression).
  const hasOptional = keys.some((k) => propertyMayBeAbsent(props[k]) || mayHaveNoJson(props[k]));

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
  // `optional`: the key is included only when the value is defined.
  // `json` (unknown / not): `expr` is the value's JSON text, and the key is
  // included only when that is defined (not for a function / symbol).
  const childExprs: { key: string; expr: string; optional: boolean; json: boolean }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = props[key];
    const childAccessor = `o[${JSON.stringify(key)}]`;
    if (mayHaveNoJson(child)) {
      childExprs.push({ key, expr: `_js(${childAccessor})`, optional: true, json: true });
    } else if (child.kind === "optional") {
      const expr = walkStringify(buf, child.meta.inner, childAccessor);
      childExprs.push({ key, expr, optional: true, json: false });
    } else {
      // Any other schema accepting undefined (propertyMayBeAbsent): omit the key when absent
      const expr = walkStringify(buf, child, childAccessor);
      childExprs.push({ key, expr, optional: propertyMayBeAbsent(child), json: false });
    }
  }

  const helperName = freshVar(buf);
  let body = `function ${helperName}(o) {\n`;
  body += '  var s = "{";\n';
  body += "  var first = true;\n";
  for (let i = 0; i < childExprs.length; i++) {
    const { key, expr, optional, json } = childExprs[i];
    const keyFragment = JSON.stringify(key) + ":";
    // Names like `toString` would read an inherited member when absent.
    const own = key in Object.prototype ? `Object.hasOwn(o, ${JSON.stringify(key)}) && ` : "";
    if (json) {
      const t = "t" + i;
      const read =
        own === "" ? expr : `Object.hasOwn(o, ${JSON.stringify(key)}) ? ${expr} : undefined`;
      body += `  var ${t} = ${read};\n`;
      body += `  if (${t} !== undefined) {\n`;
      body += `    s += (first ? "" : ",") + ${JSON.stringify(keyFragment)} + ${t};\n`;
      body += "    first = false;\n";
      body += "  }\n";
    } else if (optional) {
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
  const values = schema.meta.values;
  // Like native JSON.stringify, an undefined value omits its key (so does a
  // function / symbol under unknown / not, whose JSON text is undefined).
  // The skip runs before the comma bookkeeping.
  const json = mayHaveNoJson(values);
  const read = json
    ? "var x = _js(o[k]); if (x === undefined) continue;"
    : "var x = o[k]; if (x === undefined) continue;";
  const valExpr = json ? "x" : walkStringify(buf, values, "x");

  // for...in avoids Object.keys() array allocation on the hot path.
  // Object.hasOwn guard prevents inherited/polluted prototype keys from leaking.
  const fn = compileHelper<Function>(
    buf,
    `function ${helperName}(o) {
  var s = "{", first = 1;
  for (var k in o) { if (!Object.hasOwn(o, k)) continue; ${read} if (first) first = 0; else s += ","; s += _esc(k) + ":" + ${valExpr}; }
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
  // without the literal token, but only by escaping one of its letters
  // (`_ p r o t`), so only those escapes trigger the walk — an unrelated
  // escape (`é`) no longer costs a full-tree walk (~20% of a parse).
  emitRef(buf, "_pe", PROTO_ESCAPE);
  emit(
    buf,
    'if (json.indexOf("__proto__") !== -1 || (json.indexOf("\\\\u") !== -1 && _pe.test(json))) _strip(v);',
  );
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(json: string) => Result<Infer<S>, SchemaError>>(buf);
}
