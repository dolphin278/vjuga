/**
 * Codegen — code-generation plumbing for `new Function` compilation.
 *
 * Provides the `CodeBuffer` accumulator, reference tracking, variable naming,
 * safe literal emission, and path expression helpers. Knows nothing about
 * schemas — pure string-building infrastructure for any code generator.
 *
 * When to use: building code generators that compile domain logic into
 * optimized functions at init time. Used internally by Validate, JSON, and
 * TOON modules. Not typically imported by application code.
 *
 * Internal design:
 *   `CodeBuffer.code`: source string built via `+=` (V8 cons-string opt).
 *   `CodeBuffer.refs`: Map of param names → runtime values passed to the
 *   compiled `new Function` as closure-captured arguments.
 *   `freshVar(buf)`: allocates unique names (v0, v1, ...).
 *
 * Design tradeoffs: every value spliced into generated source (labels, keys,
 * constants) goes through `jsLiteral` — never raw template interpolation — so
 * untrusted schema text (e.g. from `fromJsonSchema`) cannot inject code.
 *
 * @example Build and compile a simple function
 * ```ts
 * import { createBuffer, emit, emitRef, compileFunction, jsLiteral } from "@dolphin278/vjuga/schema/Codegen";
 * const buf = createBuffer();
 * emitRef(buf, "_double", (n: number) => n * 2);
 * emit(buf, "return function transform(v) {");
 * emit(buf, `  return v === ${jsLiteral('"quoted"')} ? 0 : _double(v);`);
 * emit(buf, "}");
 * const fn = compileFunction<(v: number) => number>(buf);
 * fn(21); // 42
 * ```
 */

// ---------------------------------------------------------------------------
// CodeBuffer
// ---------------------------------------------------------------------------

export interface CodeBuffer {
  code: string;
  indent: number;
  refs: Map<string, unknown>;
  varCounter: number;
}

export function createBuffer(): CodeBuffer {
  return { code: "", indent: 0, refs: new Map(), varCounter: 0 };
}

/** Append an indented line to the buffer. */
export function emit(buf: CodeBuffer, line: string): void {
  // Two-space indent per level
  for (let i = 0; i < buf.indent; i++) buf.code += "  ";
  buf.code += line + "\n";
}

/**
 * Capture a runtime value as a named parameter for the generated function.
 *
 * Must be called BEFORE the ref name is used in emitted code — refs become
 * function parameters, so a missing ref is a ReferenceError at call time.
 * Registering the same name twice silently replaces the earlier value.
 */
export function emitRef(buf: CodeBuffer, name: string, value: unknown): string {
  buf.refs.set(name, value);
  return name;
}

/** Allocate a unique variable name (v0, v1, ...). */
export function freshVar(buf: CodeBuffer): string {
  return "v" + buf.varCounter++;
}

/**
 * Compile the buffer into a function via `new Function`.
 *
 * All refs become closure-captured parameters. The buffer's code must contain
 * a `return function ...` statement — `compileFunction` wraps it in
 * `new Function(...refs, code)` and calls the factory, so the returned value
 * IS the compiled function.
 */
export function compileFunction<T>(buf: CodeBuffer): T {
  const [names, values] = extractRefs(buf);
  // new Function creates a function in global scope — no access to local
  // variables except via the named parameters. This is predictable for V8
  // and avoids eval's scope chain issues.
  const factory = new Function(...names, buf.code);
  return Reflect.apply(factory, undefined, values) as T;
}

/**
 * Compile a helper function from a source string.
 *
 * Used by stringify modules that build helper functions for objects, arrays,
 * and records. The helper gets all current refs as closure-captured params;
 * register the returned function via `emitRef` to call it from emitted code.
 *
 * @example
 * ```ts
 * const add = compileHelper<Function>(buf, "function add(a, b) { return a + b; }");
 * emitRef(buf, "_add", add); // generated code can now call _add(x, y)
 * ```
 */
export function compileHelper<T>(buf: CodeBuffer, source: string): T {
  const [names, values] = extractRefs(buf);
  const factory = new Function(...names, "return " + source);
  return Reflect.apply(factory, undefined, values) as T;
}

/** Build param name and value arrays in a single pass with pre-allocated length. */
function extractRefs(buf: CodeBuffer): [string[], unknown[]] {
  const size = buf.refs.size;
  const names = Array<string>(size);
  const values = Array<unknown>(size);
  let i = 0;
  for (const [k, v] of buf.refs) {
    names[i] = k;
    values[i] = v;
    i++;
  }
  return [names, values];
}

// ---------------------------------------------------------------------------
// Literal emission
// ---------------------------------------------------------------------------

/**
 * Render a primitive as a JS source literal that evaluates back to the same
 * value. Strings are JSON-escaped (plus U+2028/U+2029, which older parsers
 * treat as line terminators); numbers are `Object.is`-exact, including `NaN`,
 * `Infinity`, `-Infinity`, and `-0` (which `JSON.stringify` would turn into
 * `null` / `0`).
 *
 * Throws `TypeError` for any other type, so a malformed schema cannot smuggle
 * an object with a hostile `toString` into generated source.
 *
 * @example
 * ```ts
 * jsLiteral('a"b\n');  // '"a\\"b\\n"'
 * jsLiteral(-Infinity); // "-Infinity"
 * jsLiteral(-0);        // "-0"
 * ```
 */
export function jsLiteral(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value).replace(LINE_SEPARATORS, escapeLineSeparator);
    case "number":
      // String() already yields "NaN", "Infinity", "-Infinity"; only -0 differs.
      return Object.is(value, -0) ? "-0" : String(value);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "undefined";
    default:
      if (value === null) return "null";
      throw new TypeError("jsLiteral: unsupported value of type " + typeof value);
  }
}

const LINE_SEPARATORS = /[\u2028\u2029]/g;

function escapeLineSeparator(ch: string): string {
  return ch === "\u2028" ? "\\u2028" : "\\u2029";
}

/**
 * JS expression that is true when `accessor` equals `value` under
 * SameValueZero (the `Set.has` / `Array.prototype.includes` relation): `NaN`
 * matches `NaN`, and `0` matches `-0`.
 */
export function eqExpr(accessor: string, value: unknown): string {
  // NaN is the only value not === to itself
  return value !== value ? `${accessor} !== ${accessor}` : `${accessor} === ${jsLiteral(value)}`;
}

/** Negation of `eqExpr` — true when `accessor` does NOT equal `value`. */
export function neExpr(accessor: string, value: unknown): string {
  return value !== value ? `${accessor} === ${accessor}` : `${accessor} !== ${jsLiteral(value)}`;
}

// ---------------------------------------------------------------------------
// Path expression helpers
// ---------------------------------------------------------------------------

/**
 * Build a child path expression from a parent path expression and a static key.
 *
 * Static paths are JSON string literals: `'"user.name"'`.
 * Dynamic paths contain `+` operators: `'"items." + v3 + ".name"'`.
 *
 * @example
 * ```ts
 * childPath('"user"', "name"); // '"user.name"'
 * ```
 */
export function childPath(parentExpr: string, key: string): string {
  if (isStaticPath(parentExpr)) {
    const parent = JSON.parse(parentExpr) as string;
    const child = parent === "" ? key : parent + "." + key;
    return jsLiteral(child);
  }
  return parentExpr + " + " + jsLiteral("." + key);
}

/**
 * Build a dynamic child path expression using a loop variable.
 *
 * The result is a JS expression that concatenates the parent path with the
 * loop variable at runtime: `"items." + idx`
 *
 * @example
 * ```ts
 * dynamicChildPath('"items"', "idx"); // '"items." + idx'
 * ```
 */
export function dynamicChildPath(parentExpr: string, indexVar: string): string {
  if (isStaticPath(parentExpr)) {
    const parent = JSON.parse(parentExpr) as string;
    if (parent === "") return `"" + ${indexVar}`;
    return `${jsLiteral(parent + ".")} + ${indexVar}`;
  }
  return parentExpr + ` + "." + ${indexVar}`;
}

/**
 * A static path expression is a single string literal with no `+` operators.
 * A key containing `+` makes a static literal look dynamic; that is harmless —
 * the dynamic branch emits a correct (just unfolded) concatenation.
 */
function isStaticPath(expr: string): boolean {
  return expr.indexOf("+") === -1;
}

// ---------------------------------------------------------------------------
// Runtime type-check expression helpers
// ---------------------------------------------------------------------------

/**
 * Returns a JS expression string that evaluates to true if `accessor` matches
 * the runtime type expected by `schema.kind`, or null for kinds that cannot be
 * distinguished by a simple typeof check (literal, enum, union, optional, nullable).
 */
export function typeCheckExpr(schema: { readonly kind: string }, accessor: string): string | null {
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
