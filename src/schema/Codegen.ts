/**
 * Codegen — code-generation plumbing for `new Function` compilation.
 *
 * Provides the `CodeBuffer` accumulator, reference tracking, variable naming,
 * and path expression helpers. This module knows nothing about schemas — it is
 * pure string-building infrastructure that any code generator can use.
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
 * @example Build and compile a simple function
 * ```ts
 * import { createBuffer, emit, emitRef, compileFunction } from "vjuga/schema/Codegen";
 * const buf = createBuffer();
 * emitRef(buf, "_double", (n: number) => n * 2);
 * emit(buf, "return function transform(v) {");
 * emit(buf, "  return _double(v);");
 * emit(buf, "}");
 * const fn = compileFunction<(v: number) => number>(buf);
 * fn(21); // 42
 * ```
 *
 * @example Helper functions — compile sub-functions with access to same refs
 * ```ts
 * const helper = compileHelper<Function>(buf, "function add(a, b) { return a + b; }");
 * emitRef(buf, "_add", helper);
 * // Generated code can now call _add(x, y)
 * ```
 *
 * @example Path expressions — for error messages in validators/parsers
 * ```ts
 * childPath('"user"', "name");        // '"user.name"' (static)
 * dynamicChildPath('"items"', "idx"); // '"items." + idx' (dynamic)
 * ```
 *
 * Pitfalls:
 *   - The buffer's `code` must contain a `return function ...` statement.
 *     `compileFunction` wraps it in `new Function(...refs, code)` and calls
 *     the factory — the returned value IS the compiled function.
 *   - `emitRef` must be called BEFORE the ref name is used in emitted code.
 *     Refs are passed as function parameters — missing refs cause ReferenceError.
 *   - `compileHelper` creates a sub-function with access to all current refs.
 *     Call it to get the function, then register the result via `emitRef`.
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

/** Capture a runtime value as a named parameter for the generated function. */
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
 * a `return function ...` statement — the returned value is that function.
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
 * and records. The helper gets all current refs as closure-captured params.
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
// Path expression helpers
// ---------------------------------------------------------------------------

/**
 * Build a child path expression from a parent path expression and a static key.
 *
 * Static paths are JSON string literals: `'"user.name"'`.
 * Dynamic paths contain `+` operators: `'"items." + v3 + ".name"'`.
 */
export function childPath(parentExpr: string, key: string): string {
  if (isStaticPath(parentExpr)) {
    const parent = JSON.parse(parentExpr) as string;
    const child = parent === "" ? key : parent + "." + key;
    return JSON.stringify(child);
  }
  // JSON.stringify handles all special chars (quotes, backslash, newlines,
  // control chars) — .slice(1,-1) strips the surrounding quotes.
  const escaped = JSON.stringify(key).slice(1, -1);
  return parentExpr + ' + ".' + escaped + '"';
}

/**
 * Build a dynamic child path expression using a loop variable.
 *
 * The result is a JS expression that concatenates the parent path with the
 * loop variable at runtime: `"items." + idx`
 */
export function dynamicChildPath(parentExpr: string, indexVar: string): string {
  if (isStaticPath(parentExpr)) {
    const parent = JSON.parse(parentExpr) as string;
    if (parent === "") return `"" + ${indexVar}`;
    // JSON.stringify escapes quotes, backslash, control chars in parent
    return `${JSON.stringify(parent + ".")} + ${indexVar}`;
  }
  return parentExpr + ` + "." + ${indexVar}`;
}

/** A static path expression is a simple JSON string literal with no + operators. */
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
