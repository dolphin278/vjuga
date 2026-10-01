/**
 * FunctionReference — serializable pointers to functions for cross-context
 * dispatch.
 *
 * A function reference is a `file:///path/to/module.ts#exportName` URL that can
 * be resolved via native `import()` in any execution context (child processes,
 * worker threads, remote machines). The URL hash fragment selects the named
 * export (percent-decoded); omitting it defaults to the `default` export.
 *
 * String references: a string starting with `file:` is parsed as a URL; any
 * other string is a filesystem path (the part before the last `#`) resolved
 * against `process.cwd()` — NOT against the calling module. Paths may contain
 * `%` or `?`; the last `#` always starts the export name. For caller-relative
 * references pass a URL: `new URL("./handlers.ts#processItem", import.meta.url)`.
 *
 * When to use: cross-thread or cross-process function dispatch where closures
 * cannot be serialized. Not needed for same-thread callbacks — pass functions
 * directly.
 *
 * Prior art: Piscina's `filename` + `name` pattern for worker-thread task
 * dispatch; Temporal.io's activity references for cross-process invocation.
 *
 * @example
 * ```ts
 * import * as FunctionReference from "@dolphin278/vjuga/FunctionReference";
 * const fn = await FunctionReference.resolve("./handlers.ts#processItem");
 * await fn(data);
 * ```
 */

import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Function takes path to module file and name of the exported function
 * from the module and returns the function. This allows to share functions
 * between execution contexts without passing the source code of the function
 * which is error prone.
 */
export async function resolve(reference: URL | string): Promise<(...args: unknown[]) => unknown> {
  const original = reference;
  if (typeof reference === "string") {
    reference = toFileURL(reference);
  }
  const exportName = reference.hash ? decodeHash(reference.hash.slice(1)) : "default";

  let module: Record<string, unknown>;
  try {
    module = await (import(reference.href) as Promise<Record<string, unknown>>);
  } catch (error) {
    // import() always throws Error; the else branch is a safety net
    /* node:coverage ignore next 2 */
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new ModuleResolutionError(reference.href, cause);
  }

  const symbol: unknown = Reflect.get(module, exportName);
  if (typeof symbol === "function") {
    return symbol as (...args: unknown[]) => unknown;
  } else {
    throw new ReferencedSymbolIsNotAFunction(reference, original, typeof symbol);
  }
}

function toFileURL(reference: string): URL {
  if (reference.startsWith("file:")) return new URL(reference);
  const hashAt = reference.lastIndexOf("#");
  if (hashAt === -1) return pathToFileURL(pathResolve(reference));
  const url = pathToFileURL(pathResolve(reference.slice(0, hashAt)));
  url.hash = reference.slice(hashAt + 1);
  return url;
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    // Malformed percent-encoding: use the raw text.
    return hash;
  }
}

export class ModuleResolutionError extends Error {
  override readonly name = "ModuleResolutionError";
  constructor(reference: string, cause: Error) {
    super(`Failed to import module ${reference}`, { cause });
  }
}

export class ReferencedSymbolIsNotAFunction extends Error {
  override readonly name = "ReferencedSymbolIsNotAFunction";
  readonly url: URL;
  readonly reference: string | URL;
  readonly typeFound: string;

  constructor(url: URL, reference: string | URL, typeFound: string) {
    super(
      `Resolving reference ${url} failed - module loaded but exported symbol is not a function, but ${typeFound} (from ${reference})`,
    );
    this.url = url;
    this.reference = reference;
    this.typeFound = typeFound;
  }
}
