import * as path from "path";
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
 *
 * Function takes path to module file and name of the exported function
 * from the module and returns the function. This allows to share functions
 * between execution contexts without passing the source code of the function
 * which is error prone.
 *
 */
export async function resolve(reference: string | URL) {
  const url =
    typeof reference === "string"
      ? new URL(path.resolve(reference), "file://localhost")
      : reference;

  const exportName = url.hash?.slice(1) ?? "default";
  url.hash = "";

  let module: Record<string, unknown>;
  try {
    module = await import(url.href);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to import module ${url.href}`, { cause: error });
    } else {
      throw error;
    }
  }

  const moduleExport: unknown = Reflect.get(module, exportName);
  if (typeof moduleExport === "function") {
    return moduleExport;
  } else {
    throw Object.assign(
      new Error(
        `Resolving ${url.toString()} failed - module loaded but exported symbol is not a function`
      ),
      { url, reference }
    );
  }
}

export const test = 1;
