/**
 * lint-docs.js — verifies that every public src module has an entry in llms.txt.
 *
 * Usage: node scripts/lint-docs.js
 *
 * Exits 0 if all modules are present, 1 if any are missing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Internal modules that are not part of the public API
const EXCLUDED = new Set(["WorkerPool.worker.ts", "WorkerPool.protocol.ts"]);

/**
 * @param {string} dir - absolute path to the directory
 * @param {string} pkgPrefix - import path prefix (e.g. "@dolphin278/vjuga")
 * @returns {string[]} list of import paths like "@dolphin278/vjuga/Module.js"
 */
function publicModules(dir, pkgPrefix) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !EXCLUDED.has(f))
    .map((f) => `${pkgPrefix}/${f.replace(/\.ts$/, ".js")}`);
}

const modules = [
  ...publicModules(join(ROOT, "src"), "@dolphin278/vjuga"),
  ...publicModules(join(ROOT, "src/schema"), "@dolphin278/vjuga/schema"),
];

const llmsTxt = readFileSync(join(ROOT, "llms.txt"), "utf8");
const missing = modules.filter((m) => !llmsTxt.includes(m));

if (missing.length > 0) {
  console.error("lint-docs: llms.txt is missing entries for:");
  for (const m of missing) console.error(`  ${m}`);
  console.error(
    "\nAdd an entry for each missing module to the appropriate section in llms.txt.",
  );
  process.exit(1);
}

console.log(`lint-docs: all ${modules.length} modules present in llms.txt ✓`);
