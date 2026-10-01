/**
 * Validate — code-generated schema validators via `new Function`.
 *
 * `validate(schema)` compiles a schema into a single optimized function that
 * validates `unknown` values and returns `Result<T, SchemaError>`. Checks are
 * inlined — no closure chains, no per-field calls, no allocations on success.
 *
 * When to use: hot-path validation of external input (HTTP bodies, queue
 * payloads, config files). Compile once at module/init scope (~0.1ms); never
 * call `validate(schema)` per request.
 *
 * Internal design:
 *   `emitValidation` walks the schema tree and emits inline checks into a
 *   `CodeBuffer`, compiled via `new Function`. Each property / element is read
 *   once into a local; every schema-derived constant is emitted via
 *   `jsLiteral`, so untrusted schemas (`fromJsonSchema`) cannot inject code.
 *   `schema/JSON.parse` reuses the same emitter.
 *
 * Semantics: objects are checked against OWN properties only, and reject
 * undeclared own enumerable keys unless built with `additionalProperties:
 * true`. Unions accept a value iff some variant fully validates it; `oneOf`
 * iff exactly one does; tagged unions dispatch via `switch`. `allOf` checks
 * every variant, `not` / `conditional` use boolean sub-validators; `unknown`
 * and `not` reject `undefined`. Recursive (cyclic) schemas are unsupported.
 *
 * @example Compile once, validate many
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * import { validate } from "@dolphin278/vjuga/schema/Validate";
 * const checkUser = validate(S.object({ id: S.integer(), name: S.string() }));
 * const [ok, value] = checkUser(input);
 * if (!ok) console.error(value.path, value.expected, value.received);
 * ```
 *
 * @example Discriminated union — `switch` on the shared literal key
 * ```ts
 * const checkEvent = validate(S.union(
 *   S.object({ type: S.literal("click"), x: S.number(), y: S.number() }),
 *   S.object({ type: S.literal("key"), code: S.string() }),
 * ));
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import type { Schema, Infer } from "./Schema.js";
import { unreachable } from "../FunctionUtils.js";
import { findDiscriminant } from "./Schema.js";
import {
  type CodeBuffer,
  createBuffer,
  emit,
  emitRef,
  freshVar,
  compileFunction,
  childPath,
  dynamicChildPath,
  jsLiteral,
  eqExpr,
  neExpr,
} from "./Codegen.js";

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------

/**
 * Validation/parse error — plain object, no prototype chain, no stack trace.
 * Cheaper to construct than Error subclasses on the failure path.
 *
 * `received` holds the raw offending input value (not truncated) — be careful
 * logging it for large payloads. `path` is dot-separated (`"user.tags.0"`);
 * `""` means the root value failed.
 */
export interface SchemaError {
  readonly path: string;
  readonly expected: string;
  readonly received: unknown;
}

/** Create a SchemaError. Captured as a ref in generated code. */
export function makeError(path: string, expected: string, received: unknown): SchemaError {
  return { path, expected, received };
}

// ---------------------------------------------------------------------------
// Standard refs
// ---------------------------------------------------------------------------

/** Read an own property, ignoring anything inherited from the prototype chain. */
function ownGet(o: object, k: string): unknown {
  return Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined;
}

/**
 * Emit standard refs used by validation-emitting compiled functions.
 *
 * Every ref that `emitValidation` output may reference is registered here, so
 * callers (Validate, JSON.parse, TOON) only need this one call.
 */
export function emitStandardRefs(buf: CodeBuffer, okFn: unknown, errFn: unknown): void {
  emitRef(buf, "_ok", okFn);
  emitRef(buf, "_err", errFn);
  emitRef(buf, "_me", makeError);
  emitRef(buf, "_isArr", Array.isArray);
  emitRef(buf, "_isSafe", Number.isSafeInteger);
  emitRef(buf, "_isFin", Number.isFinite);
  emitRef(buf, "_hasOwn", Object.hasOwn);
  emitRef(buf, "_own", ownGet);
  emitRef(buf, "_xk", firstExtraKey);
  emitRef(buf, "_OP", Object.prototype);
}

// ---------------------------------------------------------------------------
// Validator compilation
// ---------------------------------------------------------------------------

/**
 * Compiles a schema into a single optimized validator function.
 *
 * The returned function validates an `unknown` value against the schema and
 * returns `Result<Infer<S>, SchemaError>`. On the success path, the input
 * value is returned as-is — zero allocations. Objects must not carry
 * undeclared own keys unless built with `{ additionalProperties: true }`;
 * there is no "strip unknown keys" mode.
 *
 * Throws `SyntaxError` for an invalid `pattern` regex and `TypeError` if a
 * schema constraint/literal is not a primitive (malformed hand-built schema).
 *
 * @example
 * ```ts
 * const check = validate(S.object({ id: S.integer() }));
 * check({ id: 1 });           // [true, { id: 1 }]
 * check({ id: 1, extra: 0 }); // [false, { path: "extra", ... }]
 * ```
 */
export function validate<S extends Schema>(
  schema: S,
): (value: unknown) => Result<Infer<S>, SchemaError> {
  const buf = createBuffer();
  emitStandardRefs(buf, ok, err);

  emit(buf, "return function validate(v) {");
  buf.indent++;
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(value: unknown) => Result<Infer<S>, SchemaError>>(buf);
}

// ---------------------------------------------------------------------------
// Validation code emission — used by Validate and JSON parse
// ---------------------------------------------------------------------------

/**
 * Emit a validation check for any schema kind into the code buffer.
 *
 * Handles all 18 schema kinds with recursive descent into objects, arrays,
 * tuples, records, unions and the combinator kinds. Used by both `validate()` and `JSON.parse()`.
 * The buffer must have `emitStandardRefs` registered.
 *
 * `accessor` should be a variable name (it is referenced several times).
 * `pathExpr` is a JS expression string for error paths. Static paths are
 * string literals; dynamic paths (array/record loops) use string
 * concatenation with loop variables.
 */
export function emitValidation(
  buf: CodeBuffer,
  schema: Schema,
  accessor: string,
  pathExpr: string,
): void {
  switch (schema.kind) {
    case "string":
      emitStringCheck(buf, schema.meta, accessor, pathExpr);
      break;
    case "number":
      // Number.isFinite rejects NaN and ±Infinity (neither is JSON-representable)
      emitFail(
        buf,
        `typeof ${accessor} !== "number" || !_isFin(${accessor})`,
        pathExpr,
        "number",
        accessor,
      );
      emitNumericConstraints(buf, schema.meta, accessor, pathExpr, "number");
      break;
    case "integer":
      // Number.isSafeInteger covers ±2^53. Avoids (v|0)!==v which truncates to ±2^31.
      emitFail(
        buf,
        `typeof ${accessor} !== "number" || !_isSafe(${accessor})`,
        pathExpr,
        "integer",
        accessor,
      );
      emitNumericConstraints(buf, schema.meta, accessor, pathExpr, "integer");
      break;
    case "boolean":
      emitFail(buf, `typeof ${accessor} !== "boolean"`, pathExpr, "boolean", accessor);
      break;
    case "null":
      emitFail(buf, `${accessor} !== null`, pathExpr, "null", accessor);
      break;
    case "literal": {
      const value = schema.meta.value;
      emitFail(
        buf,
        neExpr(accessor, value),
        pathExpr,
        "literal(" + jsLiteral(value) + ")",
        accessor,
      );
      break;
    }
    case "enum":
      emitEnumCheck(buf, schema.meta.values, accessor, pathExpr);
      break;
    case "object":
      emitObjectValidation(buf, schema, accessor, pathExpr);
      break;
    case "array":
      emitArrayValidation(buf, schema, accessor, pathExpr);
      break;
    case "tuple":
      emitTupleValidation(buf, schema, accessor, pathExpr);
      break;
    case "record":
      emitRecordValidation(buf, schema, accessor, pathExpr);
      break;
    case "union":
      emitUnionValidation(buf, schema, accessor, pathExpr);
      break;
    case "optional":
      emit(buf, `if (${accessor} !== undefined) {`);
      buf.indent++;
      emitValidation(buf, schema.meta.inner, accessor, pathExpr);
      buf.indent--;
      emit(buf, "}");
      break;
    case "nullable":
      emit(buf, `if (${accessor} !== null) {`);
      buf.indent++;
      emitValidation(buf, schema.meta.inner, accessor, pathExpr);
      buf.indent--;
      emit(buf, "}");
      break;
    case "unknown":
      emitFail(buf, `${accessor} === undefined`, pathExpr, "any value", accessor);
      break;
    case "allOf": {
      // Sequential inline checks: the first failing variant reports its error
      const variants = schema.meta.variants as readonly Schema[];
      for (let i = 0; i < variants.length; i++) {
        emitValidation(buf, variants[i], accessor, pathExpr);
      }
      break;
    }
    case "not": {
      const inner = booleanCheck(buf, schema.meta.inner, accessor);
      emitFail(
        buf,
        `${accessor} === undefined || ${inner}`,
        pathExpr,
        "not(" + schema.meta.inner.kind + ")",
        accessor,
      );
      break;
    }
    case "conditional":
      emit(buf, `if (${booleanCheck(buf, schema.meta.if, accessor)}) {`);
      buf.indent++;
      emitValidation(buf, schema.meta.then, accessor, pathExpr);
      buf.indent--;
      emit(buf, "} else {");
      buf.indent++;
      emitValidation(buf, schema.meta.else, accessor, pathExpr);
      buf.indent--;
      emit(buf, "}");
      break;
    default:
      unreachable(schema);
  }
}

/** `if (cond) return _err(_me(path, label, received));` — label is always a safe literal. */
function emitFail(
  buf: CodeBuffer,
  cond: string,
  pathExpr: string,
  label: string,
  received: string,
): void {
  emit(buf, `if (${cond}) return _err(_me(${pathExpr}, ${jsLiteral(label)}, ${received}));`);
}

// ---------------------------------------------------------------------------
// Per-kind validation emitters
// ---------------------------------------------------------------------------

// Pre-computed format validation regexes — compiled once at module load,
// captured via emitRef per compiled validator that needs them. Looked up with
// Object.hasOwn so names like "constructor" never resolve to prototype members.
const FORMAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/\S+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "iso-datetime": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
};

type StringMeta =
  | {
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly pattern?: string;
      readonly format?: string;
    }
  | undefined;

function emitStringCheck(
  buf: CodeBuffer,
  meta: StringMeta,
  accessor: string,
  pathExpr: string,
): void {
  emitFail(buf, `typeof ${accessor} !== "string"`, pathExpr, "string", accessor);
  if (meta === undefined) return;
  if (meta.minLength !== undefined) {
    const n = jsLiteral(meta.minLength);
    emitFail(buf, `${accessor}.length < ${n}`, pathExpr, `string(minLength=${n})`, accessor);
  }
  if (meta.maxLength !== undefined) {
    const n = jsLiteral(meta.maxLength);
    emitFail(buf, `${accessor}.length > ${n}`, pathExpr, `string(maxLength=${n})`, accessor);
  }
  if (meta.pattern !== undefined) {
    const ref = freshVar(buf);
    emitRef(buf, ref, new RegExp(meta.pattern));
    // The pattern text only ever appears inside the jsLiteral-escaped label
    emitFail(
      buf,
      `!${ref}.test(${accessor})`,
      pathExpr,
      `string(pattern=${meta.pattern})`,
      accessor,
    );
  }
  // Unknown formats are annotation-only (JSON Schema 2020-12 default) and ignored
  if (meta.format !== undefined && Object.hasOwn(FORMAT_PATTERNS, meta.format)) {
    const ref = freshVar(buf);
    emitRef(buf, ref, FORMAT_PATTERNS[meta.format]);
    emitFail(buf, `!${ref}.test(${accessor})`, pathExpr, `string(format=${meta.format})`, accessor);
  }
}

/** True when a string schema's checks are exactly `typeof` + length bounds. */
function stringHasRegex(meta: StringMeta): boolean {
  return (
    meta !== undefined &&
    (meta.pattern !== undefined ||
      (meta.format !== undefined && Object.hasOwn(FORMAT_PATTERNS, meta.format)))
  );
}

type NumericMeta =
  | {
      readonly minimum?: number;
      readonly maximum?: number;
      readonly exclusiveMinimum?: number;
      readonly exclusiveMaximum?: number;
      readonly multipleOf?: number;
    }
  | undefined;

function hasNumericConstraints(meta: NumericMeta): boolean {
  return (
    meta !== undefined &&
    (meta.minimum !== undefined ||
      meta.maximum !== undefined ||
      meta.exclusiveMinimum !== undefined ||
      meta.exclusiveMaximum !== undefined ||
      meta.multipleOf !== undefined)
  );
}

// Relative tolerance for non-integer multipleOf: a few ulps of the quotient.
// Absorbs decimal representation error (0.3 / 0.1 = 2.9999999999999996)
// without accepting genuinely fractional quotients at any magnitude.
const MULTIPLE_OF_RTOL = jsLiteral(4 * Number.EPSILON);

function emitNumericConstraints(
  buf: CodeBuffer,
  meta: NumericMeta,
  accessor: string,
  pathExpr: string,
  label: string,
): void {
  if (meta === undefined) return;
  if (meta.minimum !== undefined) {
    const n = jsLiteral(meta.minimum);
    emitFail(buf, `${accessor} < ${n}`, pathExpr, `${label}(>=${n})`, accessor);
  }
  if (meta.maximum !== undefined) {
    const n = jsLiteral(meta.maximum);
    emitFail(buf, `${accessor} > ${n}`, pathExpr, `${label}(<=${n})`, accessor);
  }
  if (meta.exclusiveMinimum !== undefined) {
    const n = jsLiteral(meta.exclusiveMinimum);
    emitFail(buf, `${accessor} <= ${n}`, pathExpr, `${label}(>${n})`, accessor);
  }
  if (meta.exclusiveMaximum !== undefined) {
    const n = jsLiteral(meta.exclusiveMaximum);
    emitFail(buf, `${accessor} >= ${n}`, pathExpr, `${label}(<${n})`, accessor);
  }
  if (meta.multipleOf !== undefined) {
    const m = meta.multipleOf;
    const n = jsLiteral(m);
    if (Number.isInteger(m)) {
      // Integer multipleOf: exact modulo is safe
      emitFail(buf, `${accessor} % ${n} !== 0`, pathExpr, `${label}(%${n})`, accessor);
    } else {
      // Non-integer multipleOf: floating-point % is unreliable (0.3 % 0.1 !== 0).
      // Check that the quotient is an integer up to a relative tolerance.
      const q = freshVar(buf);
      const d = freshVar(buf);
      emit(buf, `var ${q} = ${accessor} / ${n}, ${d} = ${q} - Math.round(${q});`);
      emitFail(
        buf,
        `${d} !== 0 && Math.abs(${d}) > Math.abs(${q}) * ${MULTIPLE_OF_RTOL}`,
        pathExpr,
        `${label}(%${n})`,
        accessor,
      );
    }
  }
}

/** Enum lists up to this size use an inline `===` chain; larger ones a Set. */
const ENUM_INLINE_MAX = 8;

function emitEnumCheck(
  buf: CodeBuffer,
  values: readonly (string | number)[],
  accessor: string,
  pathExpr: string,
): void {
  const labelRef = freshVar(buf);
  emitRef(buf, labelRef, "enum(" + values.map(jsLiteral).join(",") + ")");
  // Both paths use SameValueZero (NaN matches NaN, 0 matches -0)
  const cond =
    values.length <= ENUM_INLINE_MAX
      ? values.map((v) => neExpr(accessor, v)).join(" && ")
      : `!${emitRef(buf, freshVar(buf), new Set(values))}.has(${accessor})`;
  emit(buf, `if (${cond}) return _err(_me(${pathExpr}, ${labelRef}, ${accessor}));`);
}

/** Emit the non-null, non-array object type check shared by object-like kinds. */
function emitObjectTypeCheck(buf: CodeBuffer, accessor: string, pathExpr: string): void {
  // Array check required: typeof [] === "object", so without _isArr guard
  // an array with matching properties (e.g. [1,2,3] has .length) would pass.
  emitFail(
    buf,
    `${accessor} === null || typeof ${accessor} !== "object" || _isArr(${accessor})`,
    pathExpr,
    "object",
    accessor,
  );
}

/**
 * Own-property read strategy for one object value.
 *
 * Keys that exist on Object.prototype (`constructor`, `toString`,
 * `__proto__`, ...) are always read via `_own` (hasOwn + get). Other keys are
 * read directly when the object's prototype is exactly `Object.prototype` —
 * then a defined result can only be an own property — and via `_own`
 * otherwise (class instances, null-prototype objects). The prototype check is
 * emitted once per object value; `v.__proto__` is inlined by V8, unlike
 * `Object.getPrototypeOf` (~10ns/call when the latter goes through a ref).
 */
function emitPlainFlag(buf: CodeBuffer, accessor: string, keys: readonly string[]): string | null {
  for (let i = 0; i < keys.length; i++) {
    if (!(keys[i] in Object.prototype)) {
      const flag = freshVar(buf);
      emit(buf, `var ${flag} = ${accessor}.__proto__ === _OP;`);
      return flag;
    }
  }
  return null;
}

/** Emit `var x = <own read of accessor[key]>;` and return `x`. */
function emitOwnRead(
  buf: CodeBuffer,
  accessor: string,
  key: string,
  plainFlag: string | null,
): string {
  const local = freshVar(buf);
  const k = jsLiteral(key);
  const read =
    plainFlag === null || key in Object.prototype
      ? `_own(${accessor}, ${k})`
      : `${plainFlag} ? ${accessor}[${k}] : _own(${accessor}, ${k})`;
  emit(buf, `var ${local} = ${read};`);
  return local;
}

/** True if `schema` can accept `undefined` (so a required key may be absent). */
function acceptsUndefined(schema: Schema): boolean {
  switch (schema.kind) {
    case "optional":
      return true;
    case "nullable":
      return acceptsUndefined(schema.meta.inner);
    case "literal":
      return schema.meta.value === undefined;
    case "union":
      return (schema.meta.variants as readonly Schema[]).some(acceptsUndefined);
    case "allOf":
      return (schema.meta.variants as readonly Schema[]).every(acceptsUndefined);
    case "conditional":
      // Conservative (either branch): over-approximating only costs the
      // extra-key fast path, under-approximating would let an extra key pass.
      return acceptsUndefined(schema.meta.then) || acceptsUndefined(schema.meta.else);
    default:
      // unknown / not reject undefined; leaf kinds never accept it
      return false;
  }
}

/**
 * Validate each declared property (except `skip`) of an object value.
 *
 * Returns a JS expression for the number of declared keys known to be present
 * as own properties once validation passed: keys whose schema rejects
 * `undefined` count statically; the rest count when their value is defined.
 */
function emitProperties(
  buf: CodeBuffer,
  properties: Readonly<Record<string, Schema>>,
  keys: readonly string[],
  skip: string | null,
  accessor: string,
  pathExpr: string,
  plainFlag: string | null,
): string {
  let fixed = skip === null ? 0 : 1;
  let present = "";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === skip) continue;
    const child = properties[key];
    const local = emitOwnRead(buf, accessor, key, plainFlag);
    emitValidation(buf, child, local, childPath(pathExpr, key));
    if (acceptsUndefined(child)) present += ` + (${local} !== undefined ? 1 : 0)`;
    else fixed++;
  }
  return String(fixed) + present;
}

/** Slow path of the extra-key check: first own enumerable undeclared key. */
function firstExtraKey(o: object, declared: ReadonlySet<string>): string | undefined {
  for (const k in o) {
    if (!declared.has(k) && Object.hasOwn(o, k)) return k;
  }
  return undefined;
}

/**
 * Reject own enumerable keys not in `keys` (`additionalProperties: false`).
 *
 * Fast path: count `for...in` keys and compare with the number of declared
 * keys present (`presentExpr`) — equal means no extras, at ~0.5ns/key (a
 * `switch`/Set membership test per key measured 3–5× slower). On mismatch
 * (optionals set to `undefined`, inherited enumerables, extras), `_xk` finds
 * the first undeclared own key exactly. The fast path assumes declared own
 * properties are enumerable — always true for parsed JSON.
 */
function emitExtraKeyCheck(
  buf: CodeBuffer,
  keys: readonly string[],
  presentExpr: string,
  accessor: string,
  pathExpr: string,
): void {
  const count = freshVar(buf);
  const k = freshVar(buf);
  emit(buf, `var ${count} = 0;`);
  emit(buf, `for (var ${k} in ${accessor}) ${count}++;`);
  emit(buf, `if (${count} !== ${presentExpr}) {`);
  buf.indent++;
  const set = emitRef(buf, freshVar(buf), new Set(keys));
  emit(buf, `${k} = _xk(${accessor}, ${set});`);
  emit(
    buf,
    `if (${k} !== undefined) return _err(_me(${dynamicChildPath(pathExpr, k)}, "no additional properties", ${accessor}[${k}]));`,
  );
  buf.indent--;
  emit(buf, "}");
}

function emitObjectValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  accessor: string,
  pathExpr: string,
): void {
  emitObjectTypeCheck(buf, accessor, pathExpr);
  const properties = schema.meta.properties as Readonly<Record<string, Schema>>;
  const keys = Object.keys(properties);
  const plainFlag = emitPlainFlag(buf, accessor, keys);
  const present = emitProperties(buf, properties, keys, null, accessor, pathExpr, plainFlag);
  if (!schema.meta.additionalProperties) {
    emitExtraKeyCheck(buf, keys, present, accessor, pathExpr);
  }
}

function emitArrayValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  pathExpr: string,
): void {
  emitFail(buf, `!_isArr(${accessor})`, pathExpr, "array", accessor);
  const { minItems, maxItems } = schema.meta;
  if (minItems !== undefined) {
    const n = jsLiteral(minItems);
    emitFail(buf, `${accessor}.length < ${n}`, pathExpr, `array(minItems=${n})`, accessor);
  }
  if (maxItems !== undefined) {
    const n = jsLiteral(maxItems);
    emitFail(buf, `${accessor}.length > ${n}`, pathExpr, `array(maxItems=${n})`, accessor);
  }
  const idx = freshVar(buf);
  const len = freshVar(buf);
  emit(buf, `for (var ${idx} = 0, ${len} = ${accessor}.length; ${idx} < ${len}; ${idx}++) {`);
  buf.indent++;
  const elem = freshVar(buf);
  emit(buf, `var ${elem} = ${accessor}[${idx}];`);
  emitValidation(buf, schema.meta.items, elem, dynamicChildPath(pathExpr, idx));
  buf.indent--;
  emit(buf, "}");
}

function emitTupleValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "tuple" },
  accessor: string,
  pathExpr: string,
): void {
  const items = schema.meta.items as readonly Schema[];
  emitFail(
    buf,
    `!_isArr(${accessor}) || ${accessor}.length !== ${items.length}`,
    pathExpr,
    `tuple[${items.length}]`,
    accessor,
  );
  for (let i = 0; i < items.length; i++) {
    const elem = freshVar(buf);
    emit(buf, `var ${elem} = ${accessor}[${i}];`);
    emitValidation(buf, items[i], elem, childPath(pathExpr, String(i)));
  }
}

function emitRecordValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  accessor: string,
  pathExpr: string,
): void {
  emitObjectTypeCheck(buf, accessor, pathExpr);
  const key = freshVar(buf);
  emit(buf, `for (var ${key} in ${accessor}) {`);
  buf.indent++;
  // Skip inherited properties — only validate own properties
  emit(buf, `if (!_hasOwn(${accessor}, ${key})) continue;`);
  const elem = freshVar(buf);
  emit(buf, `var ${elem} = ${accessor}[${key}];`);
  emitValidation(buf, schema.meta.values, elem, dynamicChildPath(pathExpr, key));
  buf.indent--;
  emit(buf, "}");
}

/**
 * Untagged union: try variants in order; the first that fully validates wins.
 *
 * Each non-last variant is tried with `exactCheck` (an inline expression
 * exactly equivalent to full validation) when one exists, otherwise with a
 * compiled boolean sub-validator. The last variant is validated inline so its
 * error is the one reported when nothing matches.
 */
function emitUnionValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "union" },
  accessor: string,
  pathExpr: string,
): void {
  const variants = schema.meta.variants as readonly Schema[];

  // Distinct literal tags make a discriminated union exactly-one by construction
  const discriminant = findDiscriminant(variants);
  if (discriminant !== null) {
    emitDiscriminatedValidation(buf, variants, discriminant, accessor, pathExpr);
    return;
  }

  if (schema.meta.exclusive === true) {
    emitExclusiveValidation(buf, variants, accessor, pathExpr);
    return;
  }

  const label = "u" + buf.varCounter++;
  emit(buf, `${label}: {`);
  buf.indent++;
  const last = variants.length - 1;
  for (let i = 0; i < last; i++) {
    const check = exactCheck(variants[i], accessor);
    if (check !== null) {
      emit(buf, `if (${check}) break ${label};`);
    } else {
      const ref = emitRef(buf, freshVar(buf), compileBooleanValidator(variants[i]));
      emit(buf, `if (${ref}(${accessor})) break ${label};`);
    }
  }
  if (last >= 0) {
    emitValidation(buf, variants[last], accessor, pathExpr);
  } else {
    // Empty union matches nothing
    emit(buf, `return _err(_me(${pathExpr}, "never", ${accessor}));`);
  }
  buf.indent--;
  emit(buf, "}");
}

/**
 * oneOf (non-discriminated): count matching variants. Zero matches reports
 * the last variant's own error; two or more report `oneOf(exactly one,
 * matched N)`.
 */
function emitExclusiveValidation(
  buf: CodeBuffer,
  variants: readonly Schema[],
  accessor: string,
  pathExpr: string,
): void {
  if (variants.length === 0) {
    emit(buf, `return _err(_me(${pathExpr}, "never", ${accessor}));`);
    return;
  }
  const count = freshVar(buf);
  emit(buf, `var ${count} = 0;`);
  for (let i = 0; i < variants.length; i++) {
    emit(buf, `if (${booleanCheck(buf, variants[i], accessor)}) ${count}++;`);
  }
  emit(buf, `if (${count} === 0) {`);
  buf.indent++;
  emitValidation(buf, variants[variants.length - 1], accessor, pathExpr);
  buf.indent--;
  emit(buf, `}`);
  emit(
    buf,
    `if (${count} > 1) return _err(_me(${pathExpr}, "oneOf(exactly one, matched " + ${count} + ")", ${accessor}));`,
  );
}

/**
 * JS expression true IFF `schema` accepts the value: the inline `exactCheck`
 * when one exists, otherwise a call to a compiled boolean sub-validator.
 */
function booleanCheck(buf: CodeBuffer, schema: Schema, accessor: string): string {
  const check = exactCheck(schema, accessor);
  if (check !== null) return check;
  return `${emitRef(buf, freshVar(buf), compileBooleanValidator(schema))}(${accessor})`;
}

const returnTrue = (): boolean => true;
const returnFalse = (): boolean => false;
const noError = (): undefined => undefined;

/**
 * Compile `schema` into `(v) => boolean` — the same emitted checks as
 * `validate`, but `_ok` / `_err` return true / false and no SchemaError is
 * built, so a failed union attempt allocates nothing. Nested unions inside it
 * compile their own boolean sub-validators the same way.
 */
function compileBooleanValidator(schema: Schema): (v: unknown) => boolean {
  const buf = createBuffer();
  emitStandardRefs(buf, returnTrue, returnFalse);
  emitRef(buf, "_me", noError);
  emit(buf, "return function variant(v) {");
  buf.indent++;
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");
  return compileFunction<(v: unknown) => boolean>(buf);
}

function emitDiscriminatedValidation(
  buf: CodeBuffer,
  variants: readonly Schema[],
  discriminant: string,
  accessor: string,
  pathExpr: string,
): void {
  emitObjectTypeCheck(buf, accessor, pathExpr);
  // Plain-prototype flag is computed before the switch so every case shares it
  const allKeys: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    /* node:coverage ignore next 2 */
    if (v.kind !== "object") continue; // guaranteed by findDiscriminant
    allKeys.push(...Object.keys(v.meta.properties));
  }
  const plainFlag = emitPlainFlag(buf, accessor, allKeys);
  const tag = emitOwnRead(buf, accessor, discriminant, plainFlag);
  emit(buf, `switch (${tag}) {`);
  buf.indent++;
  const tagLabels: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const obj = variants[i];
    /* node:coverage ignore next 2 */
    if (obj.kind !== "object") continue; // guaranteed by findDiscriminant
    const properties = obj.meta.properties as Readonly<Record<string, Schema>>;
    // findDiscriminant excludes NaN tags, so `case` (===) matches exactly
    const tagSchema = properties[discriminant] as Schema & { readonly kind: "literal" };
    const tagLiteral = jsLiteral(tagSchema.meta.value);
    tagLabels.push(tagLiteral);
    emit(buf, `case ${tagLiteral}: {`);
    buf.indent++;
    const keys = Object.keys(properties);
    const present = emitProperties(
      buf,
      properties,
      keys,
      discriminant,
      accessor,
      pathExpr,
      plainFlag,
    );
    if (!obj.meta.additionalProperties) {
      emitExtraKeyCheck(buf, keys, present, accessor, pathExpr);
    }
    emit(buf, "break;");
    buf.indent--;
    emit(buf, "}");
  }
  const discLabelRef = emitRef(buf, freshVar(buf), "one of: " + tagLabels.join(", "));
  const discPathExpr = childPath(pathExpr, discriminant);
  emit(buf, `default: return _err(_me(${discPathExpr}, ${discLabelRef}, ${tag}));`);
  buf.indent--;
  emit(buf, "}");
}

/**
 * Inline JS expression that is true IFF `schema` would fully validate the
 * value — or null when no such single expression exists (constrained numbers,
 * regex-checked strings, objects, arrays, ...). Only exact checks are safe for
 * union dispatch: a looser check would accept values the variant rejects.
 */
function exactCheck(schema: Schema, accessor: string): string | null {
  switch (schema.kind) {
    case "string": {
      const meta = schema.meta as StringMeta;
      if (stringHasRegex(meta)) return null;
      let check = `typeof ${accessor} === "string"`;
      if (meta?.minLength !== undefined)
        check += ` && ${accessor}.length >= ${jsLiteral(meta.minLength)}`;
      if (meta?.maxLength !== undefined)
        check += ` && ${accessor}.length <= ${jsLiteral(meta.maxLength)}`;
      return `(${check})`;
    }
    case "number":
      return hasNumericConstraints(schema.meta)
        ? null
        : `(typeof ${accessor} === "number" && _isFin(${accessor}))`;
    case "integer":
      return hasNumericConstraints(schema.meta)
        ? null
        : `(typeof ${accessor} === "number" && _isSafe(${accessor}))`;
    case "boolean":
      return `(typeof ${accessor} === "boolean")`;
    case "null":
      return `(${accessor} === null)`;
    case "literal":
      return `(${eqExpr(accessor, schema.meta.value)})`;
    case "enum": {
      const values = schema.meta.values as readonly (string | number)[];
      if (values.length > ENUM_INLINE_MAX) return null;
      return `(${values.map((v) => eqExpr(accessor, v)).join(" || ")})`;
    }
    case "optional":
    case "nullable": {
      const inner = exactCheck(schema.meta.inner, accessor);
      if (inner === null) return null;
      return `(${accessor} === ${schema.kind === "optional" ? "undefined" : "null"} || ${inner})`;
    }
    case "union": {
      const variants = schema.meta.variants as readonly Schema[];
      const checks = exactChecks(variants, accessor);
      if (checks === null) return null;
      if (checks.length === 0) return "false";
      if (schema.meta.exclusive === true) {
        return `((${checks.map((c) => `(${c} ? 1 : 0)`).join(" + ")}) === 1)`;
      }
      return `(${checks.join(" || ")})`;
    }
    case "allOf": {
      const checks = exactChecks(schema.meta.variants as readonly Schema[], accessor);
      if (checks === null) return null;
      return checks.length > 0 ? `(${checks.join(" && ")})` : "true";
    }
    case "unknown":
      return `(${accessor} !== undefined)`;
    case "not": {
      const inner = exactCheck(schema.meta.inner, accessor);
      return inner === null ? null : `(${accessor} !== undefined && !${inner})`;
    }
    case "conditional": {
      const checks = exactChecks(
        [schema.meta.if, schema.meta.then, schema.meta.else] as readonly Schema[],
        accessor,
      );
      return checks === null ? null : `(${checks[0]} ? ${checks[1]} : ${checks[2]})`;
    }
    default:
      return null;
  }
}

/** `exactCheck` of every schema, or null if any of them has none. */
function exactChecks(schemas: readonly Schema[], accessor: string): string[] | null {
  const checks: string[] = [];
  for (let i = 0; i < schemas.length; i++) {
    const c = exactCheck(schemas[i], accessor);
    if (c === null) return null;
    checks.push(c);
  }
  return checks;
}
