/**
 * run.ts — runs every `*.bench.ts` here under Bun, Node and as a scriptc
 * native binary, checks that all kinds compute the same checksums, then times
 * each bench in its own process per kind and prints a side-by-side table.
 *
 * Usage (from the repo root, after `npm ci && npm install --no-save scriptc@0.4.4`):
 *   bun scripts/scriptc-bench/run.ts [--kinds bun,node,scriptc] [--modules Queue,BitSet]
 *                                    [--check] [--no-skip] [--out results.tsv]
 *
 * --check builds and diffs checksums only (no timing); CI runs that. --no-skip also
 * builds the modules in SCRIPTC_SKIP, to see whether a scriptc fix landed. Exit 1 on
 * any build error, crash, checksum mismatch, or a bench missing from a kind.
 * SCRIPTC overrides the compiler path (default node_modules/.bin/scriptc).
 * Node runs the same sources emitted by tsc into a temp dir (tsconfig.json
 * here), so nothing is written next to src/.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Modules with a bench file that scriptc cannot run correctly yet. They still
// run under Bun and Node. Delete the line once the issue is fixed and
// `--check --modules <Module>` passes.
const SCRIPTC_SKIP: Record<string, string> = {
  RadixTree:
    "build fails, SC2009 on makeNode's `T & null` arm (unfiled); behind it symbol-keyed " +
    "recursive nodes miscompile (vercel-labs/scriptc#2139)",
};

type Kind = "bun" | "node" | "scriptc";
const KINDS: Kind[] = ["bun", "node", "scriptc"];

const HERE = resolve(import.meta.dirname);
const ROOT = resolve(HERE, "../..");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const checkOnly = process.argv.includes("--check");
const kinds = (arg("--kinds") ?? KINDS.join(",")).split(",") as Kind[];
for (const k of kinds) if (!KINDS.includes(k)) throw new Error(`unknown kind ${k}`);
const wanted = arg("--modules")?.split(",");
const outPath = arg("--out");
const noSkip = process.argv.includes("--no-skip");

// tsc / `npm run build:test` emit src/**/*.js next to the sources. Bun and
// scriptc would resolve `../../src/X.js` to that stale JS, not the .ts.
const stale = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" }).filter((f) =>
  f.endsWith(".js"),
);
if (stale.length > 0) {
  console.error(
    `src/ holds ${stale.length} emitted .js files (e.g. src/${stale[0]}); they shadow the .ts ` +
      "sources. Preview with `git clean -n -X src`, delete them, and rerun.",
  );
  process.exit(2);
}

const modules = readdirSync(HERE)
  .filter((f) => f.endsWith(".bench.ts"))
  .map((f) => f.slice(0, -".bench.ts".length))
  .filter((m) => wanted === undefined || wanted.includes(m))
  .sort();
if (wanted !== undefined && modules.length !== wanted.length) {
  throw new Error(`no bench file for: ${wanted.filter((m) => !modules.includes(m)).join(",")}`);
}

const work = mkdtempSync(join(tmpdir(), "scriptc-bench-"));
let failed = false;
function fail(msg: string): void {
  console.error(`FAIL ${msg}`);
  failed = true;
}

function exec(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd: HERE });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => done({ code: code ?? 1, out }));
  });
}

function version(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : `unavailable (${cmd})`;
}

const SCRIPTC = resolve(process.env.SCRIPTC ?? join(ROOT, "node_modules/.bin/scriptc"));
const TSC = join(ROOT, "node_modules/.bin/tsc");

// Command per kind and module; undefined = not run (skipped or failed to build).
const commands: Record<Kind, Map<string, [string, string[]]>> = {
  bun: new Map(),
  node: new Map(),
  scriptc: new Map(),
};
for (const m of modules) commands.bun.set(m, ["bun", [`${m}.bench.ts`]]);

if (kinds.includes("node")) {
  const outDir = join(work, "node");
  const r = spawnSync(TSC, ["-p", join(HERE, "tsconfig.json"), "--outDir", outDir], {
    encoding: "utf8",
  });
  if (r.status !== 0) fail(`tsc emit for node\n${r.stdout}${r.stderr}`);
  else {
    writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n');
    for (const m of modules) {
      commands.node.set(m, ["node", [join(outDir, "scripts/scriptc-bench", `${m}.bench.js`)]]);
    }
  }
}

if (kinds.includes("scriptc")) {
  if (!existsSync(SCRIPTC)) throw new Error(`scriptc not found at ${SCRIPTC}; set SCRIPTC`);
  const todo = modules.filter((m) => noSkip || !(m in SCRIPTC_SKIP));
  for (const m of modules) {
    if (!noSkip && m in SCRIPTC_SKIP) console.log(`skip scriptc ${m}: ${SCRIPTC_SKIP[m]}`);
  }
  const started = performance.now();
  // Four builds at a time: scriptc spends most of a build in LLVM on one core.
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
        const bin = join(work, "native", m);
        const r = await exec(SCRIPTC, ["build", `${m}.bench.ts`, "-o", bin]);
        if (r.code !== 0) fail(`scriptc build ${m}\n${r.out}`);
        else commands.scriptc.set(m, [bin, []]);
      }
    }),
  );
  console.log(
    `scriptc built ${commands.scriptc.size}/${todo.length} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
}

// Check: every kind prints the same `name<TAB>checksum` lines as Bun.
const names = new Map<string, string[]>();
const checksums = new Map<string, string[]>();
for (const m of modules) {
  const outputs = new Map<Kind, string>();
  for (const k of ["bun", ...kinds.filter((x) => x !== "bun")] as Kind[]) {
    const c = commands[k].get(m);
    if (c === undefined) continue;
    const r = await exec(c[0], [...c[1], "--check"]);
    if (r.code !== 0) {
      fail(`${k} --check ${m} exited ${r.code}\n${r.out}`);
      commands[k].delete(m);
      continue;
    }
    outputs.set(k, r.out);
  }
  const oracle = outputs.get("bun");
  if (oracle === undefined) continue;
  const lines = oracle.trimEnd().split("\n");
  if (!lines.every((l) => /^[^\t]+\t-?\d+$/.test(l))) {
    fail(`bun --check ${m}: expected name<TAB>integer lines, got\n${oracle}`);
    continue;
  }
  names.set(
    m,
    lines.map((l) => l.split("\t")[0] as string),
  );
  checksums.set(
    m,
    lines.map((l) => l.split("\t")[1] as string),
  );
  const matched: Kind[] = [];
  for (const [k, out] of outputs) {
    if (out === oracle) {
      matched.push(k);
      continue;
    }
    fail(`${k} checksums differ from bun for ${m}\n--- bun\n${oracle}+++ ${k}\n${out}`);
    commands[k].delete(m);
  }
  if (matched.length === outputs.size) {
    console.log(`ok checksums ${m}: ${lines.length} benches match on ${matched.join(", ")}`);
  }
}

if (checkOnly) process.exit(failed ? 1 : 0);

const header = [
  `date ${new Date().toISOString()}`,
  `git ${version("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"])}`,
  `bun ${version("bun", ["--version"])}`,
  `node ${version("node", ["--version"])}`,
  `scriptc ${kinds.includes("scriptc") ? version(SCRIPTC, ["--version"]) : "not run"}`,
];
console.log(header.join("\n"));

// Time: one process per (bench, kind), kinds interleaved per bench so drift
// in machine load hits all three alike.
const rows: string[] = ["module\tbench\tkind\tmedian_ns\tmin_ns\tmax_ns\tn"];
const table: string[][] = [];
for (const m of modules) {
  const benchNames = names.get(m) ?? [];
  for (let i = 0; i < benchNames.length; i++) {
    const row = [`${m}: ${benchNames[i]}`];
    const medians = new Map<Kind, number>();
    for (const k of KINDS) {
      if (!kinds.includes(k)) continue;
      const c = commands[k].get(m);
      if (c === undefined) {
        row.push("-");
        continue;
      }
      const r = await exec(c[0], [...c[1], "--only", String(i)]);
      const f = r.out.trimEnd().split("\t");
      // The timed process must name this bench and reproduce its checksum.
      if (r.code !== 0 || f[0] !== benchNames[i] || f[5] !== checksums.get(m)?.[i]) {
        fail(`${k} --only ${i} (${m}: ${benchNames[i]})\n${r.out}`);
        row.push("FAIL");
        continue;
      }
      medians.set(k, Number(f[1]));
      rows.push([m, f[0], k, f[1], f[2], f[3], f[4]].join("\t"));
      row.push(`${f[1]} [${f[2]}–${f[3]}]`);
    }
    const b = medians.get("bun");
    const s = medians.get("scriptc");
    if (kinds.includes("scriptc")) row.push(b && s ? (s / b).toFixed(2) : "-");
    table.push(row);
    console.log(row.join("\t"));
  }
}

if (outPath !== undefined)
  writeFileSync(
    resolve(outPath),
    `${header.map((h) => `# ${h}`).join("\n")}\n${rows.join("\n")}\n`,
  );
process.exit(failed ? 1 : 0);
