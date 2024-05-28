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
 *
 * Function takes path to module file and name of the exported function
 * from the module and returns the function. This allows to share functions
 * between execution contexts without passing the source code of the function
 * which is error prone.
 *
 * @param {URL|string} reference
 * @returns {Promise<(...args: unknown[]) => unknown>}
 */
export async function resolve(reference) {
  if (typeof reference === "string") {
    reference = new URL(`file://${pathResolve(reference)}`);
  }
  const exportName = reference.hash?.slice(1) ?? "default";

  /** @type {Record<string, unknown>} */
  let module;
  try {
    // @ts-expect-error - dynamic import actually works with URLs
    module = await import(reference);
  } catch (error) {
    if (error instanceof Error) {
      throw new ModuleResolutionError(reference.href, error);
    } else {
      throw error;
    }
  }

  const symbol = /** @type {unknown} */ (Reflect.get(module, exportName));
  if (typeof symbol === "function") {
    return /** @type {(...args: unknown[]) => unknown} */ (symbol);
  } else {
    throw new ReferencedSymbolIsNotAFunction(
      reference,
      reference,
      typeof symbol
    );
  }
}

export class ModuleResolutionError extends Error {
  /**
   *
   * @param {string} reference
   * @param {Error} cause
   */
  constructor(reference, cause) {
    super(`Failed to import module ${reference}`, { cause });
  }
}

export class ReferencedSymbolIsNotAFunction extends Error {
  /**
   * @readonly
   * @type {URL}
   */
  url;

  /**
   * @readonly
   * @type {string | URL}
   */
  reference;

  /**
   * @readonly
   * @type {string}
   */
  typeFound;

  /**
   *
   * @param {URL} url
   * @param {string | URL} reference
   * @param {string} typeFound
   */
  constructor(url, reference, typeFound) {
    super(
      `Resolving reference ${url} failed - module loaded but exported symbol is not a function, but ${typeFound} (from ${reference})`
    );
    this.url = url;
    this.reference = reference;
    this.typeFound = typeFound;
  }
}

export const test = 1;
