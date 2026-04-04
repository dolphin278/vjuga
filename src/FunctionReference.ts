import { resolve as pathResolve } from "node:path";

/**
 * Function references represent pointer to functions that can be imported by
 * various execution contexts. It may become handy when you want to share
 * functions between execution contexts, like child processes, threads,
 * remote machines, etc.
 *
 * Resolution is done by native `import()` function with slight twist - hash in
 * the path is used to determine the name of the exported function to be
 * imported.
 */

/**
 * Function takes path to module file and name of the exported function
 * from the module and returns the function. This allows to share functions
 * between execution contexts without passing the source code of the function
 * which is error prone.
 */
export async function resolve(reference: URL | string): Promise<(...args: unknown[]) => unknown> {
  if (typeof reference === "string") {
    reference = new URL(`file://${pathResolve(reference)}`);
  }
  const exportName = reference.hash?.slice(1) ?? "default";

  let module: Record<string, unknown>;
  try {
    module = await (import(reference.href) as Promise<Record<string, unknown>>);
  } catch (error) {
    if (error instanceof Error) {
      throw new ModuleResolutionError(reference.href, error);
    } else {
      throw error;
    }
  }

  const symbol: unknown = Reflect.get(module, exportName);
  if (typeof symbol === "function") {
    return symbol as (...args: unknown[]) => unknown;
  } else {
    throw new ReferencedSymbolIsNotAFunction(reference, reference, typeof symbol);
  }
}

export class ModuleResolutionError extends Error {
  constructor(reference: string, cause: Error) {
    super(`Failed to import module ${reference}`, { cause });
  }
}

export class ReferencedSymbolIsNotAFunction extends Error {
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
