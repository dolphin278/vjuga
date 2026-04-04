declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { resolve, ModuleResolutionError } from "../FunctionReference.js";
import { fileURLToPath } from "node:url";
import { resolve as pathResolve } from "node:path";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

// Construct a valid reference to a known exported function from the src directory
// FunctionUtils.js exports `pipe` — use that as our test target
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const functionUtilsPath = pathResolve(__dirname, "../FunctionUtils.js");
const validReference = `${functionUtilsPath}#pipe`;
const validReferenceURL = new URL(`file://${functionUtilsPath}#pipe`);

// Construct an invalid path for error benchmarks
const invalidReference = "/nonexistent/module.js#export";

// --- Warm-up ---
{
  for (let i = 0; i < 1_000; i++) {
    await resolve(validReference);
  }
  reportOptimizationStatus(resolve, "FunctionReference.resolve");
}

// --- Benchmarks ---

bench("FunctionReference.resolve: string path (cache hit after first import)", async () => {
  // Module is already loaded in the import cache — this primarily measures URL parsing + hash extract
  return resolve(validReference);
});

bench("FunctionReference.resolve: URL object", async () => {
  return resolve(validReferenceURL);
});

bench("FunctionReference.resolve: nonexistent module (error path)", async () => {
  return resolve(invalidReference).catch((e) => {
    if (e instanceof ModuleResolutionError) return "caught";
    throw e;
  });
});

bench("FunctionReference.resolve: valid + call returned fn", async () => {
  const fn = await resolve(validReference);
  // pipe with 2 args
  return (fn as Function)(
    (x: number) => x + 1,
    (x: number) => x * 2,
  );
});

bench("new URL() construction overhead", () => {
  return new URL(`file://${functionUtilsPath}#pipe`);
});

bench("URL hash extraction", () => {
  const url = validReferenceURL;
  return url.hash?.slice(1) ?? "default";
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const resolvedFns: Function[] = [];
for (let i = 0; i < 1_000; i++) {
  resolvedFns.push((await resolve(validReference)) as Function);
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 1k FunctionReference.resolve (cached): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void resolvedFns;
