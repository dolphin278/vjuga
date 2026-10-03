/**
 * Validate — code-generated schema validators via `new Function`.
 *
 * `validate(schema)` compiles a schema into one optimized function returning
 * `Result<T, SchemaError>` (first error). Checks are inlined — no closure
 * chains, no per-field calls, no allocations on success. `{ allErrors: true }`
 * compiles a separate collect-all variant returning `Result<T, SchemaError[]>`.
 *
 * When to use: hot-path validation of external input (HTTP bodies, queue
 * payloads, config files); `allErrors` for hand-edited input (YAML, forms)
 * where every problem should surface in one run. Compile once at init scope.
 *
 * Internal design: `emitValidation` walks the schema and emits inline checks
 * into a `CodeBuffer`; every schema-derived constant goes through `jsLiteral`,
 * so untrusted schemas cannot inject code. `schema/JSON.parse` reuses it.
 *
 * Semantics: OWN properties only; undeclared own keys fail unless
 * `additionalProperties: true`. Unions need some variant to fully validate,
 * `oneOf` exactly one; tagged unions dispatch via `switch`. `unknown` and
 * `not` reject `undefined`. Formats: RFC 3339 `date-time` / `date` / `time`,
 * `email`, `uri`, `uuid`, `ipv4`, `ipv6`, legacy `iso-datetime` (see
 * `schema/Formats`); other names are annotation-only. allErrors: one error
 * per failed type check (no descent), every failed constraint and extra key,
 * a single error per untagged union / `oneOf` / `not` (a `conditional`'s
 * chosen branch and a tagged union's variant collect normally);
 * `errors[0]` is always the first-error result. Cyclic schemas unsupported.
 *
 * @example Compile once, validate many
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * import { validate } from "@dolphin278/vjuga/schema/Validate";
 * const User = S.object({ id: S.integer(), born: S.string({ format: "date" }) });
 * const checkUser = validate(User);
 * const [ok, value] = checkUser(input);
 * if (!ok) console.error(value.path, value.expected, value.received);
 * const [ok2, errors] = validate(User, { allErrors: true })({ id: "x", born: "?" });
 * // errors: [{ path: "id", ... }, { path: "born", ... }]
 * ```
 */

import type { Result } from "../Result.js";
import { ok, err } from "../Result.js";
import type { Schema, Infer } from "./Schema.js";
import { unreachable } from "../FunctionUtils.js";
import { findDiscriminant } from "./Schema.js";
import { formatTester, isKnownFormat } from "./Formats.js";
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
 *
 * Segments are not escaped, so `path` is for display, not for addressing:
 * `"a.b"` is either key `a.b` or key `b` under `a`, `"tags.0"` either index 0
 * or key `"0"`, and an empty key at the root reports `""` like the root itself.
 * Compare against the schema shape (or build a JSON Pointer yourself) when the
 * exact location matters.
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
 * With `{ allErrors: true }` the validator returns `Result<Infer<S>,
 * SchemaError[]>` listing every failure in check order (see the module docs
 * for what is reported); `errors[0]` equals what the default validator
 * returns, and success still allocates nothing. The default mode's generated
 * code is unaffected by the option's existence.
 *
 * Throws `SyntaxError` for an invalid `pattern` regex and `TypeError` if a
 * schema constraint/literal is not a primitive (malformed hand-built schema).
 *
 * The validator reads the input with ordinary property access and `for...in`,
 * so accessor properties and Proxy traps run, and anything they throw
 * propagates out of the call as an exception — it is not turned into an
 * `err` result. Validate plain data (parsed JSON, structured clones); wrap the
 * call in `try` if the input may carry getters or be a Proxy.
 *
 * Object properties are read as own properties even if `Object.prototype` is
 * polluted after compilation, but array / tuple elements are read directly:
 * a hole in a sparse array reads through to `Array.prototype` /
 * `Object.prototype`, so an index polluted there (data-only pollution such as
 * `Object.prototype[0] = x`) is validated as the element. JSON input never
 * has holes; a per-element own check measured 2–10× slower on arrays.
 *
 * @example
 * ```ts
 * const check = validate(S.object({ id: S.integer() }));
 * check({ id: 1 });           // [true, { id: 1 }]
 * check({ id: 1, extra: 0 }); // [false, { path: "extra", ... }]
 * const all = validate(S.object({ a: S.string(), b: S.number() }), { allErrors: true });
 * all({ a: 1, b: "x", c: 0 }); // [false, [{ path: "a" }, { path: "b" }, { path: "c" }]] (abridged)
 * ```
 */
export function validate<S extends Schema, O extends ValidateOptions = {}>(
  schema: S,
  options?: O,
): (value: unknown) => Result<Infer<S>, ValidateError<O>> {
  const buf = createBuffer();
  emitStandardRefs(buf, ok, err);

  emit(buf, "return function validate(v) {");
  buf.indent++;
  if (options?.allErrors === true) {
    // Collect mode: failures push onto a lazily allocated array and skip the
    // rest of the failing value's checks (see CollectState).
    (buf as CollectBuffer).collect = { label: "", nest: true };
    emit(buf, "var _es = null;");
    emitChild(buf, schema, "v", '""');
    emit(buf, "return _es === null ? _ok(v) : _err(_es);");
  } else {
    emitValidation(buf, schema, "v", '""');
    emit(buf, "return _ok(v);");
  }
  buf.indent--;
  emit(buf, "}");

  return compileFunction<(value: unknown) => Result<Infer<S>, ValidateError<O>>>(buf);
}

/** Options for `validate`. */
export interface ValidateOptions {
  /**
   * Collect every failure instead of stopping at the first: the validator
   * returns `Result<T, SchemaError[]>`. Default `false` (first error only, the
   * fastest path).
   */
  readonly allErrors?: boolean;
}

/**
 * Error type of a validator compiled with options `O`: `SchemaError[]` when
 * `O` has `allErrors: true`, `SchemaError | SchemaError[]` when that is only
 * known at run time (`allErrors: boolean`), else `SchemaError`.
 */
export type ValidateError<O extends ValidateOptions> = O extends { readonly allErrors: true }
  ? SchemaError[]
  : O extends { readonly allErrors?: false | undefined }
    ? SchemaError
    : SchemaError | SchemaError[];

// ---------------------------------------------------------------------------
// Collect-all mode
// ---------------------------------------------------------------------------

/**
 * Emission state of `validate(schema, { allErrors: true })`. Absent on every
 * other buffer (default `validate`, boolean sub-validators, JSON / TOON
 * parse), which therefore emit first-error code unchanged.
 *
 * A failure pushes its SchemaError onto `_es` and `break`s `label` — the
 * block of the value being checked — so a value whose type check failed is
 * never descended into (soft constraint failures record and continue).
 * `nest` is true where child values (properties, elements, record values)
 * get their own block and so report independently; inside the fallback
 * variant of an untagged union or `oneOf` it is false, so the whole
 * combinator reports a single error.
 */
interface CollectState {
  label: string;
  nest: boolean;
}

type CollectBuffer = CodeBuffer & { collect?: CollectState };

function collectOf(buf: CodeBuffer): CollectState | undefined {
  return (buf as CollectBuffer).collect;
}

/**
 * Statement reporting a failure: `return _err(...)` in first-error mode,
 * push + `break` in collect mode. `label` is a JS expression.
 */
function failStmt(
  buf: CodeBuffer,
  pathExpr: string,
  label: string,
  received: string,
  soft = false,
): string {
  const e = `_me(${pathExpr}, ${label}, ${received})`;
  const c = collectOf(buf);
  if (c === undefined) return `return _err(${e});`;
  // Soft (collect + nest): record and keep checking the same value
  if (soft && c.nest) return `(_es || (_es = [])).push(${e});`;
  return `{ (_es || (_es = [])).push(${e}); break ${c.label}; }`;
}

/** Validate a child value; in collect (nest) mode inside its own labeled block. */
function emitChild(buf: CodeBuffer, schema: Schema, accessor: string, pathExpr: string): void {
  const c = collectOf(buf);
  if (c === undefined || !c.nest) {
    emitValidation(buf, schema, accessor, pathExpr);
    return;
  }
  const outer = c.label;
  c.label = "c" + buf.varCounter++;
  emit(buf, `${c.label}: {`);
  buf.indent++;
  emitValidation(buf, schema, accessor, pathExpr);
  buf.indent--;
  emit(buf, "}");
  c.label = outer;
}

/** Emit `schema` so that it reports at most one error (combinator branches). */
function emitSingle(buf: CodeBuffer, schema: Schema, accessor: string, pathExpr: string): void {
  const c = collectOf(buf);
  if (c === undefined) {
    emitValidation(buf, schema, accessor, pathExpr);
    return;
  }
  const nest = c.nest;
  c.nest = false;
  emitValidation(buf, schema, accessor, pathExpr);
  c.nest = nest;
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
      const variants = distinctVariants(schema.meta.variants as readonly Schema[]);
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
      if (schema.meta.then === schema.meta.else) {
        // Same branch either way (a shared `$ref`): `if` is irrelevant, and
        // emitting the branch twice would double the code at every level.
        // `if` is still checked, so a malformed one throws as it would emitted.
        checkConstants(schema.meta.if);
        emitValidation(buf, schema.meta.then, accessor, pathExpr);
        break;
      }
      emit(buf, `if (${booleanCheck(buf, schema.meta.if, accessor)}) {`);
      buf.indent++;
      // The branch is already chosen by `if`: it collects like any value
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
  emit(buf, `if (${cond}) ${failStmt(buf, pathExpr, jsLiteral(label), received)}`);
}

/**
 * `emitFail` for a constraint checked after the value's type passed (lengths,
 * bounds, pattern, format, item counts). Collect mode records it without
 * leaving the value, so sibling constraints and elements still report;
 * first-error code is identical to `emitFail`.
 */
function emitSoftFail(
  buf: CodeBuffer,
  cond: string,
  pathExpr: string,
  label: string,
  received: string,
): void {
  emit(buf, `if (${cond}) ${failStmt(buf, pathExpr, jsLiteral(label), received, true)}`);
}

// ---------------------------------------------------------------------------
// Per-kind validation emitters
// ---------------------------------------------------------------------------

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
    emitSoftFail(buf, `${accessor}.length < ${n}`, pathExpr, `string(minLength=${n})`, accessor);
  }
  if (meta.maxLength !== undefined) {
    const n = jsLiteral(meta.maxLength);
    emitSoftFail(buf, `${accessor}.length > ${n}`, pathExpr, `string(maxLength=${n})`, accessor);
  }
  if (meta.pattern !== undefined) {
    const ref = freshVar(buf);
    emitRef(buf, ref, new RegExp(meta.pattern));
    // The pattern text only ever appears inside the jsLiteral-escaped label
    emitSoftFail(
      buf,
      `!${ref}.test(${accessor})`,
      pathExpr,
      `string(pattern=${meta.pattern})`,
      accessor,
    );
  }
  // Unknown formats are annotation-only (JSON Schema 2020-12 default) and ignored.
  // Testers (schema/Formats) are created once at module load and captured per
  // compiled validator; RegExp and wrapped predicates share the `.test` shape.
  const tester = meta.format === undefined ? undefined : formatTester(meta.format);
  if (tester !== undefined) {
    const ref = freshVar(buf);
    emitRef(buf, ref, tester);
    emitSoftFail(
      buf,
      `!${ref}.test(${accessor})`,
      pathExpr,
      `string(format=${meta.format})`,
      accessor,
    );
  }
}

/** True when a string schema's checks are exactly `typeof` + length bounds. */
function stringHasRegex(meta: StringMeta): boolean {
  return (
    meta !== undefined &&
    (meta.pattern !== undefined || (meta.format !== undefined && isKnownFormat(meta.format)))
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
    emitSoftFail(buf, `${accessor} < ${n}`, pathExpr, `${label}(>=${n})`, accessor);
  }
  if (meta.maximum !== undefined) {
    const n = jsLiteral(meta.maximum);
    emitSoftFail(buf, `${accessor} > ${n}`, pathExpr, `${label}(<=${n})`, accessor);
  }
  if (meta.exclusiveMinimum !== undefined) {
    const n = jsLiteral(meta.exclusiveMinimum);
    emitSoftFail(buf, `${accessor} <= ${n}`, pathExpr, `${label}(>${n})`, accessor);
  }
  if (meta.exclusiveMaximum !== undefined) {
    const n = jsLiteral(meta.exclusiveMaximum);
    emitSoftFail(buf, `${accessor} >= ${n}`, pathExpr, `${label}(<${n})`, accessor);
  }
  if (meta.multipleOf !== undefined) {
    const m = meta.multipleOf;
    const n = jsLiteral(m);
    if (Number.isInteger(m)) {
      // Integer multipleOf: exact modulo is safe
      emitSoftFail(buf, `${accessor} % ${n} !== 0`, pathExpr, `${label}(%${n})`, accessor);
    } else {
      // Non-integer multipleOf: floating-point % is unreliable (0.3 % 0.1 !== 0).
      // Check that the quotient is an integer up to a relative tolerance.
      const q = freshVar(buf);
      const d = freshVar(buf);
      emit(buf, `var ${q} = ${accessor} / ${n}, ${d} = ${q} - Math.round(${q});`);
      emitSoftFail(
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
  emit(buf, `if (${cond}) ${failStmt(buf, pathExpr, labelRef, accessor)}`);
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
 * Keys that exist on Object.prototype at compile time (`constructor`,
 * `toString`, `__proto__`, ...) are always read via `_own` (hasOwn + get).
 * Other keys are read directly when the flag emitted here is true: the
 * object's prototype is exactly `Object.prototype` AND `Object.prototype[k]`
 * is `undefined` for every such key — then a defined direct read can only be
 * an own property. Otherwise (class instances, null-prototype objects, or an
 * `Object.prototype` polluted after compilation) every key goes via `_own`.
 * The flag is computed once per object value (`base`, when given, replaces
 * the prototype check); `v.__proto__` is inlined by V8, unlike
 * `Object.getPrototypeOf` (~10ns/call when the latter goes through a ref),
 * and V8 folds the `_OP[k]` loads (free on node, ~0.6ns/key on bun).
 *
 * Residual (not defended): an object whose own chain defines a lying
 * `__proto__` getter returning `Object.prototype` gets direct reads, so a
 * property inherited from its real prototype counts as present; likewise a
 * getter installed on `Object.prototype` that returns `undefined` only when
 * the receiver is `Object.prototype` itself. Neither arises from JSON input
 * or from data-only prototype pollution (`o[a][b] = c`). Array and tuple
 * elements are not covered by this flag at all — see `validate()`.
 */
function emitPlainFlag(
  buf: CodeBuffer,
  accessor: string,
  keys: readonly string[],
  base: string | null = null,
): string | null {
  let cond = "";
  for (let i = 0; i < keys.length; i++) {
    if (!(keys[i] in Object.prototype)) cond += ` && _OP[${jsLiteral(keys[i])}] === undefined`;
  }
  if (cond === "") return base;
  const flag = freshVar(buf);
  emit(buf, `var ${flag} = ${base ?? `${accessor}.__proto__ === _OP`}${cond};`);
  return flag;
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

/**
 * Variants without identity duplicates (`allOf[X, X]` is `X`), in
 * first-occurrence order; the input array itself when it has none. A `$ref`
 * used twice resolves to one shared node, and checking it twice adds nothing
 * but doubles the emitted code at every nesting level (a DAG of depth d would
 * otherwise emit 2^d copies). For `allOf` and `anyOf` only — a repeat changes
 * a `oneOf` match count.
 */
function distinctVariants(variants: readonly Schema[]): readonly Schema[] {
  const seen = new Set(variants);
  if (seen.size === variants.length) return variants;
  return [...seen];
}

/** Schemas whose compile-time checks (`checkConstants`) already passed. */
const checkedConstants = new WeakSet<Schema>();

/**
 * Run the compile-time checks emission would run on `schema` — `new RegExp`
 * for every `pattern`, `jsLiteral` for every constraint, literal and enum
 * value — without emitting code. Used where emission skips a subtree (the
 * `if` of a `conditional` whose branches are identical), so a malformed
 * schema still throws `SyntaxError` / `TypeError` from `validate()`. Nodes are
 * marked only after their whole subtree passed, so a shared node is walked
 * once (linear on `$ref` DAGs) and a failing one throws on every compile.
 */
function checkConstants(schema: Schema): void {
  if (checkedConstants.has(schema)) return;
  switch (schema.kind) {
    case "string": {
      const meta = schema.meta as StringMeta;
      if (meta !== undefined) {
        jsLiteral(meta.minLength);
        jsLiteral(meta.maxLength);
        if (meta.pattern !== undefined) RegExp(meta.pattern);
      }
      break;
    }
    case "number":
    case "integer": {
      const meta = schema.meta as NumericMeta;
      if (meta !== undefined) {
        jsLiteral(meta.minimum);
        jsLiteral(meta.maximum);
        jsLiteral(meta.exclusiveMinimum);
        jsLiteral(meta.exclusiveMaximum);
        jsLiteral(meta.multipleOf);
      }
      break;
    }
    case "boolean":
    case "null":
    case "unknown":
      break;
    case "literal":
      jsLiteral(schema.meta.value);
      break;
    case "enum":
      for (const value of schema.meta.values as readonly unknown[]) jsLiteral(value);
      break;
    case "object": {
      const properties = schema.meta.properties as Readonly<Record<string, Schema>>;
      for (const key of Object.keys(properties)) checkConstants(properties[key]);
      break;
    }
    case "array":
      jsLiteral(schema.meta.minItems);
      jsLiteral(schema.meta.maxItems);
      checkConstants(schema.meta.items);
      break;
    case "tuple":
      for (const item of schema.meta.items as readonly Schema[]) checkConstants(item);
      break;
    case "record":
      checkConstants(schema.meta.values);
      break;
    case "union":
    case "allOf":
      for (const variant of schema.meta.variants as readonly Schema[]) checkConstants(variant);
      break;
    case "optional":
    case "nullable":
    case "not":
      checkConstants(schema.meta.inner);
      break;
    case "conditional":
      checkConstants(schema.meta.if);
      checkConstants(schema.meta.then);
      checkConstants(schema.meta.else);
      break;
    default:
      unreachable(schema);
  }
  checkedConstants.add(schema);
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
      return distinctVariants(schema.meta.variants as readonly Schema[]).some(acceptsUndefined);
    case "allOf":
      return distinctVariants(schema.meta.variants as readonly Schema[]).every(acceptsUndefined);
    case "conditional":
      // Conservative (either branch): over-approximating only costs the
      // extra-key fast path, under-approximating would let an extra key pass.
      return (
        acceptsUndefined(schema.meta.then) ||
        (schema.meta.else !== schema.meta.then && acceptsUndefined(schema.meta.else))
      );
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
    emitChild(buf, child, local, childPath(pathExpr, key));
    // Collect mode keeps going past a missing required key, so a static count
    // could hide an extra key; count every key by presence there instead.
    const c = collectOf(buf);
    if (acceptsUndefined(child) || (c !== undefined && c.nest)) {
      present += ` + (${local} !== undefined ? 1 : 0)`;
    } else fixed++;
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
  const keyPath = dynamicChildPath(pathExpr, k);
  const c = collectOf(buf);
  if (c !== undefined && c.nest) {
    // Collect mode: report every undeclared own key (same order as `_xk`)
    emit(
      buf,
      `for (${k} in ${accessor}) if (!${set}.has(${k}) && _hasOwn(${accessor}, ${k})) (_es || (_es = [])).push(_me(${keyPath}, "no additional properties", ${accessor}[${k}]));`,
    );
  } else {
    emit(buf, `${k} = _xk(${accessor}, ${set});`);
    emit(
      buf,
      `if (${k} !== undefined) ${failStmt(buf, keyPath, '"no additional properties"', `${accessor}[${k}]`)}`,
    );
  }
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
    emitSoftFail(buf, `${accessor}.length < ${n}`, pathExpr, `array(minItems=${n})`, accessor);
  }
  if (maxItems !== undefined) {
    const n = jsLiteral(maxItems);
    emitSoftFail(buf, `${accessor}.length > ${n}`, pathExpr, `array(maxItems=${n})`, accessor);
  }
  const idx = freshVar(buf);
  const len = freshVar(buf);
  emit(buf, `for (var ${idx} = 0, ${len} = ${accessor}.length; ${idx} < ${len}; ${idx}++) {`);
  buf.indent++;
  const elem = freshVar(buf);
  emit(buf, `var ${elem} = ${accessor}[${idx}];`);
  emitChild(buf, schema.meta.items, elem, dynamicChildPath(pathExpr, idx));
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
    emitChild(buf, items[i], elem, childPath(pathExpr, String(i)));
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
  emitChild(buf, schema.meta.values, elem, dynamicChildPath(pathExpr, key));
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
    emitSingle(buf, variants[last], accessor, pathExpr);
  } else {
    // Empty union matches nothing
    emit(buf, failStmt(buf, pathExpr, '"never"', accessor));
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
    emit(buf, failStmt(buf, pathExpr, '"never"', accessor));
    return;
  }
  const count = freshVar(buf);
  emit(buf, `var ${count} = 0;`);
  for (let i = 0; i < variants.length; i++) {
    emit(buf, `if (${booleanCheck(buf, variants[i], accessor)}) ${count}++;`);
  }
  if (booleanBuffers.has(buf)) {
    // Boolean sub-validator: the error is discarded, so re-running the last
    // variant for it would only double the work at every nesting level
    emit(buf, `if (${count} !== 1) ${failStmt(buf, pathExpr, '"oneOf"', accessor)}`);
    return;
  }
  emit(buf, `if (${count} === 0) {`);
  buf.indent++;
  emitSingle(buf, variants[variants.length - 1], accessor, pathExpr);
  buf.indent--;
  emit(buf, `}`);
  const label = `"oneOf(exactly one, matched " + ${count} + ")"`;
  emit(buf, `if (${count} > 1) ${failStmt(buf, pathExpr, label, accessor)}`);
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

/**
 * Boolean sub-validators by schema identity. A node shared by several parents
 * (a `$ref` target, a reused hand-built schema) compiles once, which keeps
 * combinator-heavy schemas from recompiling the same subtree at every use.
 */
const booleanValidators = new WeakMap<Schema, (v: unknown) => boolean>();

/** Buffers being emitted by `compileBooleanValidator` (errors are discarded). */
const booleanBuffers = new WeakSet<CodeBuffer>();

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
  const cached = booleanValidators.get(schema);
  if (cached !== undefined) return cached;
  const buf = createBuffer();
  booleanBuffers.add(buf);
  emitStandardRefs(buf, returnTrue, returnFalse);
  emitRef(buf, "_me", noError);
  emit(buf, "return function variant(v) {");
  buf.indent++;
  emitValidation(buf, schema, "v", '""');
  emit(buf, "return _ok(v);");
  buf.indent--;
  emit(buf, "}");
  const fn = compileFunction<(v: unknown) => boolean>(buf);
  booleanValidators.set(schema, fn);
  return fn;
}

/**
 * Discriminated union: read the tag once, then a single `switch` dispatch to
 * the matching variant's inline checks. Not constant-time in the number of
 * variants: V8 compiles a `switch` on string tags to sequential `===`
 * comparisons, so a late tag pays for every earlier case (still far cheaper
 * than trying each variant as an untagged union does).
 */
function emitDiscriminatedValidation(
  buf: CodeBuffer,
  variants: readonly Schema[],
  discriminant: string,
  accessor: string,
  pathExpr: string,
): void {
  emitObjectTypeCheck(buf, accessor, pathExpr);
  // The flag for the tag read is computed before the switch; each case extends
  // it with its own keys, so only the matched variant's keys are checked
  const tagFlag = emitPlainFlag(buf, accessor, [discriminant]);
  const tag = emitOwnRead(buf, accessor, discriminant, tagFlag);
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
    const plainFlag = emitPlainFlag(
      buf,
      accessor,
      keys.filter((k) => k !== discriminant),
      tagFlag,
    );
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
  emit(buf, `default: ${failStmt(buf, discPathExpr, discLabelRef, tag)}`);
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
      // A repeated variant changes a `oneOf` count, but never an `anyOf` result
      const exclusive = schema.meta.exclusive === true;
      const checks = exactChecks(exclusive ? variants : distinctVariants(variants), accessor);
      if (checks === null) return null;
      if (checks.length === 0) return "false";
      if (exclusive) {
        return `((${checks.map((c) => `(${c} ? 1 : 0)`).join(" + ")}) === 1)`;
      }
      return `(${checks.join(" || ")})`;
    }
    case "allOf": {
      const checks = exactChecks(
        distinctVariants(schema.meta.variants as readonly Schema[]),
        accessor,
      );
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
      if (schema.meta.then === schema.meta.else) {
        checkConstants(schema.meta.if);
        return exactCheck(schema.meta.then, accessor);
      }
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
