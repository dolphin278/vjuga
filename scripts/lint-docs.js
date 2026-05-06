/**
 * lint-docs.js — verifies agent-facing doc structure and llms coverage.
 *
 * Usage: node scripts/lint-docs.js
 *
 * Exits 0 if all checks pass, 1 otherwise.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CANONICAL_GUIDE = "CONTRIBUTING-AGENTS.md";

// Internal modules that are not part of the public API
const EXCLUDED = new Set(["WorkerPool.worker.ts", "WorkerPool.protocol.ts"]);
const DOC_REQUIREMENTS = [
  {
    file: "AGENTS.md",
    required: [
      "[CONTRIBUTING-AGENTS.md](./CONTRIBUTING-AGENTS.md)",
      "[llms.txt](./llms.txt)",
    ],
  },
  {
    file: "CLAUDE.md",
    required: [
      "[CONTRIBUTING-AGENTS.md](./CONTRIBUTING-AGENTS.md)",
      "[AGENTS.md](./AGENTS.md)",
      "[llms.txt](./llms.txt)",
    ],
    forbidden: [
      "**100% code coverage is required**",
      "**Fuzz tests are mandatory.**",
      "**Module-level docstrings are required.**",
    ],
  },
  {
    file: "README.md",
    required: ["[CONTRIBUTING-AGENTS.md](./CONTRIBUTING-AGENTS.md)"],
  },
];

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

const canonicalGuide = readFileSync(join(ROOT, CANONICAL_GUIDE), "utf8");
if (!canonicalGuide.includes("authoritative source for repo-specific engineering policy")) {
  console.error(
    `lint-docs: ${CANONICAL_GUIDE} must declare itself as the authoritative shared guide.`,
  );
  process.exit(1);
}

for (const requirement of DOC_REQUIREMENTS) {
  const contents = readFileSync(join(ROOT, requirement.file), "utf8");

  for (const needle of requirement.required) {
    if (!contents.includes(needle)) {
      console.error(`lint-docs: ${requirement.file} is missing required reference ${needle}`);
      process.exit(1);
    }
  }

  for (const needle of requirement.forbidden ?? []) {
    if (contents.includes(needle)) {
      console.error(
        `lint-docs: ${requirement.file} still contains repo policy that belongs in ${CANONICAL_GUIDE}`,
      );
      process.exit(1);
    }
  }
}

console.log(
  `lint-docs: llms coverage and agent-facing doc structure validated for ${modules.length} modules ✓`,
);
