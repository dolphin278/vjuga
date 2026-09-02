/**
 * Validate — code-generated schema validators via `new Function`.
 *
 * `validate(schema)` compiles a schema into a single optimized function that
 * validates `unknown` values and returns `Result<T, SchemaError>`. The
 * generated code inlines all type checks — no closure chains, no Reflect.apply
 * per field, no intermediate allocations on the success path.
 *
 * When to use: any hot-path validation of external input (HTTP request bodies,
 * message queue payloads, config files). For one-shot or cold-path validation,
 * the overhead of code generation (~0.1ms per schema) is amortized after a
 * handful of calls.
 *
 * Internal design:
 *   `emitValidation` walks the schema tree and emits inline checks into a
 *   `CodeBuffer`. The buffer is then compiled via `new Function`. This emitter
 *   is also used by `schema/JSON.parse` to inline validation after parsing.
 *
 * @example Compile once, validate many
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * import { validate } from "@dolphin278/vjuga/schema/Validate";
 *
 * const checkUser = validate(S.object({
 *   id: S.integer(),
 *   name: S.string(),
 *   email: S.string({ format: "email" }),
 * }));
 *
 * const result = checkUser(input); // Result<{ id: number; name: string; email: string }, SchemaError>
 * if (result[0]) {
 *   const user = result[1]; // fully typed
 * } else {
 *   console.error(result[1].path, result[1].expected, result[1].received);
 * }
 * ```
 *
 * @example Discriminated union — auto-detected, emits switch statement
 * ```ts
 * const checkEvent = validate(S.union(
 *   S.object({ type: S.literal("click"), x: S.number(), y: S.number() }),
 *   S.object({ type: S.literal("key"), code: S.string() }),
 * ));
 * // Generated code dispatches on event.type via switch — O(1), not O(n).
 * ```
 *
 * @example SchemaError structure
 * ```ts
 * // SchemaError is a plain object, not an Error subclass — cheap to construct.
 * // { path: "user.address.zip", expected: "string", received: 12345 }
 * ```
 *
 * Best practices:
 *   - Compile validators at module/init scope, not inside request handlers.
 *     Compilation costs ~0.1ms; the compiled function runs in nanoseconds.
 *   - Use `Result` destructuring: `const [ok, value] = check(input)`.
 *   - For objects, all properties are required unless wrapped in `optional()`.
 *   - Discriminated unions (shared literal property) get O(1) dispatch
 *     automatically — prefer them over untagged unions.
 *
 * Pitfalls:
 *   - Do NOT call `validate(schema)` inside a loop — each call compiles a
 *     new function via `new Function`. Store the compiled validator.
 *   - The validator trusts its own generated code but validates ALL input
 *     fields. There is no "partial" or "strip unknown keys" mode — extra
 *     keys on input objects are silently accepted.
 *   - SchemaError.received holds the raw input value. Be careful logging it
 *     for large payloads — it is not truncated.
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
} from "./Codegen.js";

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------

/**
 * Validation/parse error — plain object, no prototype chain, no stack trace.
 * Cheaper to construct than Error subclasses on the failure path.
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

/** Emit standard refs used by validation-emitting compiled functions. */
export function emitStandardRefs(buf: CodeBuffer, okFn: unknown, errFn: unknown): void {
  emitRef(buf, "_ok", okFn);
  emitRef(buf, "_err", errFn);
  emitRef(buf, "_me", makeError);
  emitRef(buf, "_isArr", Array.isArray);
  emitRef(buf, "_isSafe", Number.isSafeInteger);
}

// ---------------------------------------------------------------------------
// Validator compilation
// ---------------------------------------------------------------------------

/**
 * Compiles a schema into a single optimized validator function.
 *
 * The returned function validates an `unknown` value against the schema and
 * returns `Result<Infer<S>, SchemaError>`. On the success path, the input
 * value is returned as-is — zero allocations.
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
 * Handles all 14 schema kinds with recursive descent into objects, arrays,
 * tuples, records, and unions. Used by both `validate()` and `JSON.parse()`.
 *
 * `pathExpr` is a JS expression string for error paths. Static paths are
 * `JSON.stringify`'d literals; dynamic paths (array/record loops) use
 * string concatenation with loop variables.
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
      // v !== v is the NaN check — single ucomisd instruction in V8
      emit(
        buf,
        `if (typeof ${accessor} !== "number" || ${accessor} !== ${accessor}) return _err(_me(${pathExpr}, "number", ${accessor}));`,
      );
      emitNumericConstraints(buf, schema.meta, accessor, pathExpr, "number");
      break;
    case "integer":
      // Number.isSafeInteger covers ±2^53. Avoids (v|0)!==v which truncates to ±2^31.
      emit(
        buf,
        `if (typeof ${accessor} !== "number" || !_isSafe(${accessor})) return _err(_me(${pathExpr}, "integer", ${accessor}));`,
      );
      emitNumericConstraints(buf, schema.meta, accessor, pathExpr, "integer");
      break;
    case "boolean":
      emit(
        buf,
        `if (typeof ${accessor} !== "boolean") return _err(_me(${pathExpr}, "boolean", ${accessor}));`,
      );
      break;
    case "null":
      emit(buf, `if (${accessor} !== null) return _err(_me(${pathExpr}, "null", ${accessor}));`);
      break;
    case "literal": {
      const ref = freshVar(buf);
      emitRef(buf, ref, schema.meta.value);
      emit(
        buf,
        `if (${accessor} !== ${ref}) return _err(_me(${pathExpr}, ${JSON.stringify("literal(" + JSON.stringify(schema.meta.value) + ")")}, ${accessor}));`,
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
    default:
      unreachable(schema);
  }
}

// ---------------------------------------------------------------------------
// Per-kind validation emitters
// ---------------------------------------------------------------------------

// Pre-computed format validation regexes — compiled once at module load,
// captured via emitRef per compiled validator that needs them.
const FORMAT_PATTERNS: Record<string, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/\S+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "iso-datetime": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
};

function emitStringCheck(
  buf: CodeBuffer,
  meta:
    | {
        readonly minLength?: number;
        readonly maxLength?: number;
        readonly pattern?: string;
        readonly format?: string;
      }
    | undefined,
  accessor: string,
  pathExpr: string,
): void {
  emit(
    buf,
    `if (typeof ${accessor} !== "string") return _err(_me(${pathExpr}, "string", ${accessor}));`,
  );
  if (meta !== undefined) {
    if (meta.minLength !== undefined) {
      emit(
        buf,
        `if (${accessor}.length < ${meta.minLength}) return _err(_me(${pathExpr}, "string(minLength=${meta.minLength})", ${accessor}));`,
      );
    }
    if (meta.maxLength !== undefined) {
      emit(
        buf,
        `if (${accessor}.length > ${meta.maxLength}) return _err(_me(${pathExpr}, "string(maxLength=${meta.maxLength})", ${accessor}));`,
      );
    }
    if (meta.pattern !== undefined) {
      const ref = freshVar(buf);
      emitRef(buf, ref, new RegExp(meta.pattern));
      emit(
        buf,
        `if (!${ref}.test(${accessor})) return _err(_me(${pathExpr}, "string(pattern=${meta.pattern})", ${accessor}));`,
      );
    }
    if (meta.format !== undefined) {
      const fmtRegex = FORMAT_PATTERNS[meta.format];
      if (fmtRegex !== undefined) {
        const ref = freshVar(buf);
        emitRef(buf, ref, fmtRegex);
        emit(
          buf,
          `if (!${ref}.test(${accessor})) return _err(_me(${pathExpr}, "string(format=${meta.format})", ${accessor}));`,
        );
      }
    }
  }
}

function emitNumericConstraints(
  buf: CodeBuffer,
  meta:
    | {
        readonly minimum?: number;
        readonly maximum?: number;
        readonly exclusiveMinimum?: number;
        readonly exclusiveMaximum?: number;
        readonly multipleOf?: number;
      }
    | undefined,
  accessor: string,
  pathExpr: string,
  label: string,
): void {
  if (meta === undefined) return;
  if (meta.minimum !== undefined) {
    emit(
      buf,
      `if (${accessor} < ${meta.minimum}) return _err(_me(${pathExpr}, "${label}(>=${meta.minimum})", ${accessor}));`,
    );
  }
  if (meta.maximum !== undefined) {
    emit(
      buf,
      `if (${accessor} > ${meta.maximum}) return _err(_me(${pathExpr}, "${label}(<=${meta.maximum})", ${accessor}));`,
    );
  }
  if (meta.exclusiveMinimum !== undefined) {
    emit(
      buf,
      `if (${accessor} <= ${meta.exclusiveMinimum}) return _err(_me(${pathExpr}, "${label}(>${meta.exclusiveMinimum})", ${accessor}));`,
    );
  }
  if (meta.exclusiveMaximum !== undefined) {
    emit(
      buf,
      `if (${accessor} >= ${meta.exclusiveMaximum}) return _err(_me(${pathExpr}, "${label}(<${meta.exclusiveMaximum})", ${accessor}));`,
    );
  }
  if (meta.multipleOf !== undefined) {
    const m = meta.multipleOf;
    if (Number.isInteger(m)) {
      // Integer multipleOf: exact modulo is safe
      emit(
        buf,
        `if (${accessor} % ${m} !== 0) return _err(_me(${pathExpr}, "${label}(%${m})", ${accessor}));`,
      );
    } else {
      // Non-integer multipleOf: floating-point % is unreliable (0.3 % 0.1 !== 0).
      // Use tolerance: check that remainder is near 0 or near the divisor.
      emit(
        buf,
        `{ var _rem = Math.abs(${accessor} % ${m}); if (_rem > 1e-9 && Math.abs(_rem - ${m}) > 1e-9) return _err(_me(${pathExpr}, "${label}(%${m})", ${accessor})); }`,
      );
    }
  }
}

function emitEnumCheck(
  buf: CodeBuffer,
  values: readonly (string | number)[],
  accessor: string,
  pathExpr: string,
): void {
  const labelRef = freshVar(buf);
  const label = "enum(" + values.map((v) => JSON.stringify(v)).join(",") + ")";
  emitRef(buf, labelRef, label);
  if (values.length <= 8) {
    const checks = values.map((v) => `${accessor} !== ${JSON.stringify(v)}`).join(" && ");
    emit(buf, `if (${checks}) return _err(_me(${pathExpr}, ${labelRef}, ${accessor}));`);
  } else {
    const ref = freshVar(buf);
    emitRef(buf, ref, new Set(values));
    emit(
      buf,
      `if (!${ref}.has(${accessor})) return _err(_me(${pathExpr}, ${labelRef}, ${accessor}));`,
    );
  }
}

function emitObjectValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "object" },
  accessor: string,
  pathExpr: string,
): void {
  // Array check required: typeof [] === "object", so without _isArr guard
  // an array with matching properties (e.g. [1,2,3] has .length) would pass.
  emit(
    buf,
    `if (${accessor} === null || typeof ${accessor} !== "object" || _isArr(${accessor})) return _err(_me(${pathExpr}, "object", ${accessor}));`,
  );
  const keys = Object.keys(schema.meta.properties);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const child = schema.meta.properties[key];
    const childAccessor = `${accessor}[${JSON.stringify(key)}]`;
    const childPathExpr = childPath(pathExpr, key);
    emitValidation(buf, child, childAccessor, childPathExpr);
  }
}

function emitArrayValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "array" },
  accessor: string,
  pathExpr: string,
): void {
  emit(buf, `if (!_isArr(${accessor})) return _err(_me(${pathExpr}, "array", ${accessor}));`);
  if (schema.meta.minItems !== undefined) {
    emit(
      buf,
      `if (${accessor}.length < ${schema.meta.minItems}) return _err(_me(${pathExpr}, "array(minItems=${schema.meta.minItems})", ${accessor}));`,
    );
  }
  if (schema.meta.maxItems !== undefined) {
    emit(
      buf,
      `if (${accessor}.length > ${schema.meta.maxItems}) return _err(_me(${pathExpr}, "array(maxItems=${schema.meta.maxItems})", ${accessor}));`,
    );
  }
  const idx = freshVar(buf);
  const len = freshVar(buf);
  emit(buf, `for (var ${idx} = 0, ${len} = ${accessor}.length; ${idx} < ${len}; ${idx}++) {`);
  buf.indent++;
  const elemAccessor = `${accessor}[${idx}]`;
  const elemPathExpr = dynamicChildPath(pathExpr, idx);
  emitValidation(buf, schema.meta.items, elemAccessor, elemPathExpr);
  buf.indent--;
  emit(buf, "}");
}

function emitTupleValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "tuple" },
  accessor: string,
  pathExpr: string,
): void {
  const items = schema.meta.items;
  emit(
    buf,
    `if (!_isArr(${accessor}) || ${accessor}.length !== ${items.length}) return _err(_me(${pathExpr}, "tuple[${items.length}]", ${accessor}));`,
  );
  for (let i = 0; i < items.length; i++) {
    const childAccessor = `${accessor}[${i}]`;
    const childPathExpr = childPath(pathExpr, String(i));
    emitValidation(buf, items[i], childAccessor, childPathExpr);
  }
}

function emitRecordValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "record" },
  accessor: string,
  pathExpr: string,
): void {
  emit(
    buf,
    `if (${accessor} === null || typeof ${accessor} !== "object" || _isArr(${accessor})) return _err(_me(${pathExpr}, "object", ${accessor}));`,
  );
  const key = freshVar(buf);
  emit(buf, `for (var ${key} in ${accessor}) {`);
  buf.indent++;
  // Skip inherited properties — only validate own properties
  emit(buf, `if (!Object.hasOwn(${accessor}, ${key})) continue;`);
  const elemAccessor = `${accessor}[${key}]`;
  const elemPathExpr = dynamicChildPath(pathExpr, key);
  emitValidation(buf, schema.meta.values, elemAccessor, elemPathExpr);
  buf.indent--;
  emit(buf, "}");
}

function emitUnionValidation(
  buf: CodeBuffer,
  schema: Schema & { readonly kind: "union" },
  accessor: string,
  pathExpr: string,
): void {
  const variants = schema.meta.variants;

  const discriminant = findDiscriminant(variants);
  if (discriminant !== null) {
    emitDiscriminatedValidation(buf, variants, discriminant, accessor, pathExpr);
    return;
  }

  const label = "u" + buf.varCounter++;
  emit(buf, `${label}: {`);
  buf.indent++;
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    if (i < variants.length - 1) {
      const check = quickTypeCheck(variant, accessor);
      if (check !== null) {
        emit(buf, `if (${check}) break ${label};`);
      } else {
        // quickTypeCheck returned null (e.g., large enum, nested union) —
        // can't use a simple type-of guard. Compile a sub-validator for this
        // variant and call it: if it returns Ok, break out of the union block.
        const subBuf = createBuffer();
        emitStandardRefs(subBuf, ok, err);
        emit(subBuf, "return function(v) {");
        subBuf.indent++;
        emitValidation(subBuf, variant, "v", '""');
        emit(subBuf, "return _ok(v);");
        subBuf.indent--;
        emit(subBuf, "}");
        const subValidator = compileFunction(subBuf);
        const ref = freshVar(buf);
        emitRef(buf, ref, subValidator);
        emit(buf, `if (${ref}(${accessor})[0]) break ${label};`);
      }
    } else {
      emitValidation(buf, variant, accessor, pathExpr);
    }
  }
  buf.indent--;
  emit(buf, "}");
}

function emitDiscriminatedValidation(
  buf: CodeBuffer,
  variants: readonly Schema[],
  discriminant: string,
  accessor: string,
  pathExpr: string,
): void {
  emit(
    buf,
    `if (${accessor} === null || typeof ${accessor} !== "object" || _isArr(${accessor})) return _err(_me(${pathExpr}, "object", ${accessor}));`,
  );
  const discAccessor = `${accessor}[${JSON.stringify(discriminant)}]`;
  emit(buf, `switch (${discAccessor}) {`);
  buf.indent++;
  for (let i = 0; i < variants.length; i++) {
    const obj = variants[i];
    /* node:coverage ignore next 2 */
    if (obj.kind !== "object") continue; // guaranteed by findDiscriminant
    const litSchema = obj.meta.properties[discriminant];
    emit(buf, `case ${JSON.stringify(litSchema.meta.value)}: {`);
    buf.indent++;
    const keys = Object.keys(obj.meta.properties);
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      if (key === discriminant) continue;
      const child = obj.meta.properties[key];
      const childAccessor = `${accessor}[${JSON.stringify(key)}]`;
      const childPathExpr = childPath(pathExpr, key);
      emitValidation(buf, child, childAccessor, childPathExpr);
    }
    emit(buf, "break;");
    buf.indent--;
    emit(buf, "}");
  }
  const discLabelRef = freshVar(buf);
  const discLabels: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    /* node:coverage ignore next 2 */
    if (v.kind !== "object") continue;
    discLabels.push(JSON.stringify(v.meta.properties[discriminant].meta.value));
  }
  const discLabel = "one of: " + discLabels.join(", ");
  emitRef(buf, discLabelRef, discLabel);
  const discPathExpr = childPath(pathExpr, discriminant);
  emit(buf, `default: return _err(_me(${discPathExpr}, ${discLabelRef}, ${discAccessor}));`);
  buf.indent--;
  emit(buf, "}");
}

/**
 * Generate an inline JS expression that type-checks a value against a schema.
 * Returns null for complex schemas that can't be checked with a single expression.
 */
function quickTypeCheck(schema: Schema, accessor: string): string | null {
  switch (schema.kind) {
    case "string":
      return `typeof ${accessor} === "string"`;
    case "number":
      return `typeof ${accessor} === "number" && ${accessor} === ${accessor}`;
    case "integer":
      return `typeof ${accessor} === "number" && _isSafe(${accessor})`;
    case "boolean":
      return `typeof ${accessor} === "boolean"`;
    case "null":
      return `${accessor} === null`;
    case "literal": {
      const v = schema.meta.value;
      if (v === null) return `${accessor} === null`;
      if (typeof v === "boolean") return `${accessor} === ${v}`;
      if (typeof v === "number") return `${accessor} === ${v}`;
      return `${accessor} === ${JSON.stringify(v)}`;
    }
    case "enum": {
      const values = schema.meta.values as readonly (string | number)[];
      if (values.length <= 4) {
        return values.map((v) => `${accessor} === ${JSON.stringify(v)}`).join(" || ");
      }
      return null;
    }
    case "union": {
      const checks: string[] = [];
      for (const v of schema.meta.variants) {
        const c = quickTypeCheck(v, accessor);
        if (c !== null) checks.push(c);
      }
      return checks.length > 0 ? checks.join(" || ") : null;
    }
    case "array":
    case "tuple":
      return `_isArr(${accessor})`;
    case "object":
    case "record":
      return `typeof ${accessor} === "object" && ${accessor} !== null && !_isArr(${accessor})`;
    case "optional":
      return `${accessor} === undefined || (${quickTypeCheck(schema.meta.inner, accessor) ?? "true"})`;
    case "nullable":
      return `${accessor} === null || (${quickTypeCheck(schema.meta.inner, accessor) ?? "true"})`;
    default:
      return null;
  }
}
