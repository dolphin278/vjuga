/**
 * lint-docs.js — verifies agent-facing doc structure and llms coverage.
 *
 * Usage: node scripts/lint-docs.js
 *
 * Exits 0 if all checks pass, 1 otherwise.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CANONICAL_GUIDE = "CONTRIBUTING-AGENTS.md";

// Internal modules that must stay unavailable through package subpath exports.
const INTERNAL_MODULES = ["WorkerPool.worker", "WorkerPool.protocol"];
const EXCLUDED = new Set(INTERNAL_MODULES.map((m) => `${m}.ts`));
const ALLOWED_SRC_SUBDIRS = new Set(["benchmarks", "schema", "tests"]);
const SHARED_UNIT_COVERAGE = new Map([
  [
    "schema/Codegen",
    [
      "src/tests/schema/Validate.test.ts",
      "src/tests/schema/JSON.test.ts",
      "src/tests/schema/TOON.test.ts",
    ],
  ],
]);
const CONSUMER_POINTER =
  "When working with `@dolphin278/vjuga`, read `node_modules/@dolphin278/vjuga/AGENTS.md` first.";
const UNPUBLISHED_CONTRIBUTING_LINK = "[CONTRIBUTING-AGENTS.md](./CONTRIBUTING-AGENTS.md)";
const DOC_REQUIREMENTS = [
  {
    file: "AGENTS.md",
    required: ["[llms.txt](./llms.txt)", CONSUMER_POINTER, "no root export"],
    forbidden: [UNPUBLISHED_CONTRIBUTING_LINK],
  },
  {
    file: "CLAUDE.md",
    required: [
      UNPUBLISHED_CONTRIBUTING_LINK,
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
    required: ["[AGENTS.md](./AGENTS.md)", "[llms.txt](./llms.txt)", CONSUMER_POINTER],
    forbidden: [UNPUBLISHED_CONTRIBUTING_LINK],
  },
];

/**
 * @param {string} dir - absolute path to the directory
 * @param {string} pkgPrefix - import path prefix (e.g. "@dolphin278/vjuga")
 * @returns {{ name: string, importPath: string, testPath: string, fuzzPath: string }[]}
 */
function publicModules(dir, pkgPrefix) {
  const isSchema = pkgPrefix.endsWith("/schema");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !EXCLUDED.has(f))
    .map((f) => {
      const base = f.replace(/\.ts$/, "");
      return {
        name: isSchema ? `schema/${base}` : base,
        importPath: `${pkgPrefix}/${base}.js`,
        testPath: isSchema ? `src/tests/schema/${base}.test.ts` : `src/tests/${base}.test.ts`,
        fuzzPath: isSchema
          ? `src/tests/fuzz/schema/${base}.fuzz.test.ts`
          : `src/tests/fuzz/${base}.fuzz.test.ts`,
      };
    });
}

/**
 * @param {string} dir - absolute path to scan
 * @returns {string[]} TypeScript source files under dir
 */
function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "benchmarks") continue;
      out.push(...tsFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

const missingDocstrings = tsFiles(join(ROOT, "src")).filter((file) => {
  const base = file.split("/").pop();
  if (base !== undefined && EXCLUDED.has(base)) return false;
  const contents = readFileSync(file, "utf8").trimStart();
  return !contents.startsWith("/**");
});
const staleExampleImports = tsFiles(join(ROOT, "src")).filter((file) =>
  /from ["']vjuga\//.test(readFileSync(file, "utf8")),
);
if (staleExampleImports.length > 0) {
  console.error('lint-docs: JSDoc examples must import from "@dolphin278/vjuga/<Module>", not "vjuga/":');
  for (const file of staleExampleImports) console.error(`  ${file.slice(ROOT.length)}`);
  process.exit(1);
}

if (missingDocstrings.length > 0) {
  console.error("lint-docs: module docstring must be the first statement in:");
  for (const file of missingDocstrings) console.error(`  ${file.slice(ROOT.length)}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (packageJson.exports?.["."] !== null) {
  console.error('lint-docs: package.json exports["."] must be null — there is no root export');
  process.exit(1);
}
const publishedFiles = packageJson.files;
if (!Array.isArray(publishedFiles) || !publishedFiles.includes("AGENTS.md") || !publishedFiles.includes("llms.txt")) {
  console.error("lint-docs: package.json files must include AGENTS.md and llms.txt");
  process.exit(1);
}
for (const module of INTERNAL_MODULES) {
  for (const specifier of [`./${module}.js`, `./${module}`]) {
    if (packageJson.exports?.[specifier] !== null) {
      console.error(`lint-docs: internal module ${specifier} must be blocked in package exports`);
      process.exit(1);
    }
  }
}

for (const specifier of ["./benchmarks/*.js", "./benchmarks/*", "./tests/*.js", "./tests/*"]) {
  if (packageJson.exports?.[specifier] !== null) {
    console.error(`lint-docs: non-public source subpaths must be blocked by ${specifier}`);
    process.exit(1);
  }
}

const unexpectedSrcSubdirs = readdirSync(join(ROOT, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !ALLOWED_SRC_SUBDIRS.has(entry.name))
  .map((entry) => entry.name);
if (unexpectedSrcSubdirs.length > 0) {
  console.error("lint-docs: new nested src directories require explicit export/docs policy:");
  for (const dir of unexpectedSrcSubdirs) console.error(`  src/${dir}`);
  process.exit(1);
}

const modules = [
  ...publicModules(join(ROOT, "src"), "@dolphin278/vjuga"),
  ...publicModules(join(ROOT, "src/schema"), "@dolphin278/vjuga/schema"),
];

const llmsTxt = readFileSync(join(ROOT, "llms.txt"), "utf8");
if (llmsTxt.includes("](./src/")) {
  console.error("lint-docs: llms.txt must not link to src/ paths that 404 in the published package");
  process.exit(1);
}
const packedDocs = { "AGENTS.md": readFileSync(join(ROOT, "AGENTS.md"), "utf8"), "llms.txt": llmsTxt };
for (const [file, contents] of Object.entries(packedDocs)) {
  if (contents.includes("`src/<Module>.ts`")) {
    console.error(`lint-docs: ${file} must not tell package consumers to open src/<Module>.ts`);
    process.exit(1);
  }
  if (!contents.includes("node_modules/@dolphin278/vjuga/src/")) {
    console.error(`lint-docs: ${file} must name node_modules/@dolphin278/vjuga/src/ for API files`);
    process.exit(1);
  }
}
const missing = modules.filter((m) => !llmsTxt.includes(m.importPath));

if (missing.length > 0) {
  console.error("lint-docs: llms.txt is missing entries for:");
  for (const m of missing) console.error(`  ${m.importPath}`);
  console.error(
    "\nAdd an entry for each missing module to the appropriate section in llms.txt.",
  );
  process.exit(1);
}

const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const missingAgents = modules.filter((m) => !agentsMd.includes(`\`${m.name}\``));
if (missingAgents.length > 0) {
  console.error("lint-docs: AGENTS.md is missing quick-reference entries for:");
  for (const m of missingAgents) console.error(`  ${m.name}`);
  process.exit(1);
}

const missingPackageSpecifier = modules.filter((m) => {
  const source = readFileSync(join(ROOT, "src", `${m.name}.ts`), "utf8");
  return !source.includes("@dolphin278/vjuga/");
});
if (missingPackageSpecifier.length > 0) {
  console.error("lint-docs: public module JSDoc must include a resolving @dolphin278/vjuga/ import:");
  for (const m of missingPackageSpecifier) console.error(`  ${m.name}`);
  process.exit(1);
}

function hasSharedCoverage(moduleName, map) {
  const paths = map.get(moduleName);
  return paths !== undefined && paths.every((p) => existsSync(join(ROOT, p)));
}

const missingUnitCoverage = modules.filter(
  (m) => !existsSync(join(ROOT, m.testPath)) && !hasSharedCoverage(m.name, SHARED_UNIT_COVERAGE),
);
if (missingUnitCoverage.length > 0) {
  console.error("lint-docs: public modules need direct tests or explicit shared unit coverage:");
  for (const m of missingUnitCoverage) console.error(`  ${m.name}`);
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
