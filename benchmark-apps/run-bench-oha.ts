/**
 * Benchmark orchestrator using oha (Rust HTTP load generator).
 *
 * oha eliminates the JS client bottleneck — it can saturate the server
 * with far more concurrent requests than node:http or fetch().
 *
 * Usage:
 *   node --experimental-strip-types benchmark-apps/run-bench-oha.ts
 *   node --experimental-strip-types benchmark-apps/run-bench-oha.ts --smoke
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleRequest } from "./shared/bench.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_BUN = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

const args = process.argv.slice(2);
const SMOKE = args.includes("--smoke");
const CONCURRENCY = parseInt(getArg("--concurrency") || "200", 10);
const DURATION_S = parseInt(getArg("--duration") || "10", 10);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── Server spawning ──────────────────────────────────────────────────

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status } = await simpleRequest(port, "GET", "/health");
      if (status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Server on port ${port} did not start within ${timeoutMs}ms`);
}

function spawnServer(script: string, port: number): Promise<ChildProcess> {
  return new Promise((resolve_, reject) => {
    const scriptPath = resolve(__dirname, script);
    let cmd: string;
    let spawnArgs: string[];

    if (IS_BUN) {
      cmd = "bun";
      spawnArgs = [scriptPath];
    } else {
      cmd = process.execPath;
      spawnArgs = ["--experimental-strip-types", scriptPath];
    }

    const child = spawn(cmd, spawnArgs, {
      env: { ...process.env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      reject(new Error(`Server ${script} did not start within 10s`));
      child.kill("SIGTERM");
    }, 10000);

    waitForReady(port, 9000).then(() => {
      clearTimeout(timeout);
      resolve_(child);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[${script}] ${data}`);
    });
  });
}

function killServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve_) => {
    if (child.exitCode !== null) { resolve_(); return; }
    child.on("exit", () => resolve_());
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve_(); }, 3000);
  });
}

// ── oha runner ───────────────────────────────────────────────────────

interface OhaResult {
  rps: number;
  p50: number;
  p99: number;
  total: number;
  errors: number;
}

function runOha(
  port: number,
  path: string,
  method: string,
  body?: string,
  randRegex?: boolean,
): OhaResult {
  const ohaArgs = [
    "-c", String(CONCURRENCY),
    "-z", `${DURATION_S}s`,
    "-m", method,
    "--no-tui",
  ];
  if (randRegex) ohaArgs.push("--rand-regex-url");
  if (body) {
    ohaArgs.push("-d", body);
    ohaArgs.push("-T", "application/json");
  }
  ohaArgs.push(`http://127.0.0.1:${port}${path}`);

  const output = execFileSync("oha", ohaArgs, {
    encoding: "utf8",
    timeout: (DURATION_S + 10) * 1000,
  });

  // Parse oha text output
  const rpsMatch = output.match(/Requests\/sec:\s+([\d.]+)/);
  const p50Match = output.match(/50\.00% in ([\d.]+) ms/);
  const p99Match = output.match(/99\.00% in ([\d.]+) ms/);
  const totalMatch = output.match(/\[200\] (\d+) responses/);

  return {
    rps: Math.round(parseFloat(rpsMatch?.[1] ?? "0")),
    p50: parseFloat(p50Match?.[1] ?? "0") / 1000, // convert ms to seconds
    p99: parseFloat(p99Match?.[1] ?? "0") / 1000,
    total: parseInt(totalMatch?.[1] ?? "0", 10),
    errors: 0,
  };
}

// ── Scenarios ────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  method: string;
  path: string;
  body?: string;
  randRegex?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "GET /health", method: "GET", path: "/health" },
  { name: "GET /users?limit=20", method: "GET", path: "/users?offset=0&limit=20" },
  { name: "GET /users/:id", method: "GET", path: "/users/42" },
  { name: "GET /users/:id varied", method: "GET", path: "/users/[1-9][0-9]{0,2}", randRegex: true },
  { name: "GET /users?varied", method: "GET", path: "/users\\?offset=[0-9]{1,2}0&limit=20", randRegex: true },
  { name: "POST /auth/login", method: "POST", path: "/auth/login", body: '{"user":"user0","pass":"pass0"}' },
  { name: "POST /users", method: "POST", path: "/users", body: '{"username":"oha_bench","password":"p","email":"e@e.com"}' },
  { name: "GET /files/large.txt", method: "GET", path: "/files/large.txt" },
];

// ── Smoke test ───────────────────────────────────────────────────────

async function smokeTest(port: number, label: string): Promise<boolean> {
  console.log(`\n── Smoke testing ${label} (port ${port}) ──`);
  let pass = true;

  const health = await simpleRequest(port, "GET", "/health");
  check("GET /health", health.status === 200);

  const users = await simpleRequest(port, "GET", "/users?offset=0&limit=5");
  check("GET /users", users.status === 200 && JSON.parse(users.body).length === 5);

  const user = await simpleRequest(port, "GET", "/users/1");
  check("GET /users/1", user.status === 200);

  const login = await simpleRequest(port, "POST", "/auth/login", '{"user":"user0","pass":"pass0"}');
  check("POST /auth/login", login.status === 200);

  const file = await simpleRequest(port, "GET", "/files/large.txt");
  check("GET /files/large.txt", file.status === 200 && file.body.length === 100_000);

  console.log(`  ${label}: ${pass ? "ALL PASSED" : "SOME FAILED"}`);
  return pass;

  function check(name: string, ok: boolean): void {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) pass = false;
  }
}

// ── Output ───────────────────────────────────────────────────────────

function formatLatency(secs: number): string {
  const ms = secs * 1000;
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function printComparison(naiveResults: OhaResult[], optResults: OhaResult[]): void {
  console.log("\n" + "═".repeat(95));
  console.log(`  BENCHMARK (oha, ${CONCURRENCY} connections, ${DURATION_S}s per scenario)`);
  console.log("═".repeat(95));

  const header = [
    "Scenario".padEnd(25),
    "naive rps".padStart(10),
    "opt rps".padStart(10),
    "speedup".padStart(8),
    "naive p99".padStart(10),
    "opt p99".padStart(10),
  ].join(" │ ");

  console.log(header);
  console.log("─".repeat(95));

  for (let i = 0; i < SCENARIOS.length; i++) {
    const n = naiveResults[i];
    const o = optResults[i];
    const speedup = n.rps > 0 ? (o.rps / n.rps) : 0;
    const speedupStr = speedup >= 1
      ? `${speedup.toFixed(2)}x`
      : `${(1 / speedup).toFixed(2)}x ↓`;

    console.log([
      SCENARIOS[i].name.padEnd(25),
      String(n.rps).padStart(10),
      String(o.rps).padStart(10),
      speedupStr.padStart(8),
      formatLatency(n.p99).padStart(10),
      formatLatency(o.p99).padStart(10),
    ].join(" │ "));
  }

  console.log("═".repeat(95));

  let totalN = 0, totalO = 0;
  for (let i = 0; i < naiveResults.length; i++) {
    totalN += naiveResults[i].rps;
    totalO += optResults[i].rps;
  }
  console.log(`\n  Overall: naive ${totalN} rps, optimized ${totalO} rps (${(totalO / totalN).toFixed(2)}x)`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const NAIVE_PORT = 3100;
  const OPT_PORT = 3200;

  console.log("Spawning servers...");
  const [naiveChild, optChild] = await Promise.all([
    spawnServer("naive/server.ts", NAIVE_PORT),
    spawnServer("optimized/server.ts", OPT_PORT),
  ]);

  try {
    // Smoke test
    const [naiveOk, optOk] = await Promise.all([
      smokeTest(NAIVE_PORT, "naive"),
      smokeTest(OPT_PORT, "optimized"),
    ]);
    if (!naiveOk || !optOk) {
      console.error("Smoke tests failed");
      process.exitCode = 1;
      return;
    }
    if (SMOKE) return;

    // Benchmark
    console.log(`\nBenchmarking: ${CONCURRENCY} connections, ${DURATION_S}s per scenario (oha)\n`);

    const naiveResults: OhaResult[] = [];
    const optResults: OhaResult[] = [];

    for (const scenario of SCENARIOS) {
      process.stdout.write(`  ${scenario.name}...`);
      const n = runOha(NAIVE_PORT, scenario.path, scenario.method, scenario.body, scenario.randRegex);
      process.stdout.write(` naive=${n.rps}`);
      const o = runOha(OPT_PORT, scenario.path, scenario.method, scenario.body, scenario.randRegex);
      const speedup = n.rps > 0 ? (o.rps / n.rps).toFixed(2) : "N/A";
      process.stdout.write(` opt=${o.rps} (${speedup}x)\n`);
      naiveResults.push(n);
      optResults.push(o);
    }

    printComparison(naiveResults, optResults);

    // Fetch batch stats from optimized server
    try {
      const stats = await simpleRequest(OPT_PORT, "GET", "/debug/batch-stats");
      console.log("\n  Batch stats:", stats.body);
    } catch { /* ignore */ }

  } finally {
    console.log("\nShutting down servers...");
    await Promise.all([killServer(naiveChild), killServer(optChild)]);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
