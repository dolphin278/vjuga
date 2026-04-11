/**
 * Codegen — code-generation plumbing for `new Function` compilation.
 *
 * Provides the `CodeBuffer` accumulator, reference tracking, variable naming,
 * and path expression helpers. This module knows nothing about schemas — it is
 * pure string-building infrastructure that any code generator can use.
 *
 * Internal design:
 *   `CodeBuffer.code` accumulates source via string concatenation (V8 cons-
 *   string optimization). `CodeBuffer.refs` maps generated parameter names to
 *   runtime values that are passed as closure-captured arguments to the
 *   compiled `new Function`. `freshVar` produces unique variable names (v0,
 *   v1, ...) to avoid collisions in generated code.
 *
 * Design tradeoffs:
 *   String concatenation over array.join: V8 optimizes repeated `+=` on
 *   strings via cons-strings (deferred flattening). For code generation where
 *   we append many small fragments, this is faster than building an array and
 *   joining. The generated code is typically <10KB so the cons-string chain
 *   stays efficient.
 *
 * @example
 * ```ts
 * import { createBuffer, emit, emitRef, compileFunction } from "vjuga/schema/Codegen";
 * const buf = createBuffer();
 * emitRef(buf, "_ok", ok);
 * emit(buf, "return function f(v) {");
 * emit(buf, "  return _ok(v);");
 * emit(buf, "}");
 * const f = compileFunction(buf);
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

/** Build param name and value arrays in a single pass over the refs map. */
function extractRefs(buf: CodeBuffer): [string[], unknown[]] {
  const names: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of buf.refs) {
    names.push(k);
    values.push(v);
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
  return parentExpr + ' + ".' + key + '"';
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
    return `"${parent}." + ${indexVar}`;
  }
  return parentExpr + ` + "." + ${indexVar}`;
}

/** A static path expression is a simple JSON string literal with no + operators. */
function isStaticPath(expr: string): boolean {
  return expr.indexOf("+") === -1;
}
