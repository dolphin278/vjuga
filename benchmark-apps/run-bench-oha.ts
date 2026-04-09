/**
 * Benchmark orchestrator using oha (Rust HTTP load generator).
 *
 * Compares the vjuga-optimized server against Express and Fastify baselines.
 * oha eliminates the JS client bottleneck — it can saturate the server
 * with far more concurrent requests than node:http or fetch().
 *
 * Usage:
 *   node --experimental-strip-types benchmark-apps/run-bench-oha.ts
 *   node --experimental-strip-types benchmark-apps/run-bench-oha.ts --smoke
 *   node --experimental-strip-types benchmark-apps/run-bench-oha.ts --servers express,fastify,optimized
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

// ── Server definitions ──────────────────────────────────────────────

interface ServerDef {
  name: string;
  script: string;
  port: number;
}

const ALL_SERVERS: Record<string, ServerDef> = {
  express:    { name: "express",    script: "express/server.ts",    port: 3100 },
  fastify:    { name: "fastify",    script: "fastify/server.ts",    port: 3200 },
  naive:      { name: "naive",      script: "naive/server.ts",      port: 3300 },
  optimized:  { name: "optimized",  script: "optimized/server.ts",  port: 3400 },
  "vjuga-http": { name: "vjuga-http", script: "vjuga-http/server.ts", port: 3500 },
};

const serverList = (getArg("--servers") || "express,fastify,vjuga-http").split(",");
const SERVERS: ServerDef[] = serverList.map((s) => {
  const def = ALL_SERVERS[s.trim()];
  if (!def) throw new Error(`Unknown server: ${s}. Available: ${Object.keys(ALL_SERVERS).join(", ")}`);
  return def;
});

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
  const p50Match = output.match(/50\.00% in ([\d.]+) (secs|ms)/);
  const p99Match = output.match(/99\.00% in ([\d.]+) (secs|ms)/);
  const totalMatch = output.match(/\[200\] (\d+) responses/);

  const p50Val = parseFloat(p50Match?.[1] ?? "0");
  const p99Val = parseFloat(p99Match?.[1] ?? "0");
  // Normalize to seconds
  const p50Secs = p50Match?.[2] === "ms" ? p50Val / 1000 : p50Val;
  const p99Secs = p99Match?.[2] === "ms" ? p99Val / 1000 : p99Val;

  return {
    rps: Math.round(parseFloat(rpsMatch?.[1] ?? "0")),
    p50: p50Secs,
    p99: p99Secs,
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
  if (secs === 0) return "—";
  const ms = secs * 1000;
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function printComparison(
  allResults: Map<string, OhaResult[]>,
): void {
  const serverNames = [...allResults.keys()];
  const optResults = allResults.get("vjuga-http")!;

  // Calculate column widths
  const COL_W = 12;
  const NAME_W = 25;
  const totalW = NAME_W + serverNames.length * (COL_W + 3) + COL_W + 3;

  console.log("\n" + "═".repeat(totalW));
  console.log(`  BENCHMARK (oha, ${CONCURRENCY} connections, ${DURATION_S}s per scenario)`);
  console.log("═".repeat(totalW));

  // Header: Scenario | server1 rps | server2 rps | ... | speedup vs best baseline
  const headerParts = ["Scenario".padEnd(NAME_W)];
  for (const name of serverNames) {
    headerParts.push(`${name} rps`.padStart(COL_W));
  }
  headerParts.push("best gain".padStart(COL_W));
  console.log(headerParts.join(" │ "));
  console.log("─".repeat(totalW));

  for (let i = 0; i < SCENARIOS.length; i++) {
    const parts = [SCENARIOS[i].name.padEnd(NAME_W)];

    // Find the best non-optimized baseline for this scenario
    let bestBaseline = 0;
    for (const name of serverNames) {
      const r = allResults.get(name)![i];
      parts.push(String(r.rps).padStart(COL_W));
      if (name !== "vjuga-http" && r.rps > bestBaseline) {
        bestBaseline = r.rps;
      }
    }

    // Speedup vs best baseline
    const optRps = optResults[i].rps;
    if (bestBaseline > 0) {
      const speedup = optRps / bestBaseline;
      const str = speedup >= 1
        ? `${speedup.toFixed(2)}x`
        : `${(1 / speedup).toFixed(2)}x ↓`;
      parts.push(str.padStart(COL_W));
    } else {
      parts.push("—".padStart(COL_W));
    }

    console.log(parts.join(" │ "));
  }

  console.log("═".repeat(totalW));

  // Overall totals
  const totals = new Map<string, number>();
  for (const name of serverNames) {
    let total = 0;
    for (const r of allResults.get(name)!) total += r.rps;
    totals.set(name, total);
  }

  const optTotal = totals.get("vjuga-http")!;
  console.log("\n  Overall rps:");
  for (const name of serverNames) {
    const total = totals.get(name)!;
    const ratio = name === "vjuga-http" ? "" : ` (optimized is ${(optTotal / total).toFixed(2)}x)`;
    console.log(`    ${name}: ${total}${ratio}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Spawning servers: ${SERVERS.map((s) => s.name).join(", ")}...`);

  const children = await Promise.all(
    SERVERS.map((s) => spawnServer(s.script, s.port)),
  );

  try {
    // Smoke test all servers
    const smokeResults = await Promise.all(
      SERVERS.map((s, i) => smokeTest(s.port, s.name)),
    );
    if (smokeResults.some((ok) => !ok)) {
      console.error("Smoke tests failed");
      process.exitCode = 1;
      return;
    }
    if (SMOKE) return;

    // Benchmark
    console.log(`\nBenchmarking: ${CONCURRENCY} connections, ${DURATION_S}s per scenario (oha)\n`);

    const allResults = new Map<string, OhaResult[]>();
    for (const s of SERVERS) allResults.set(s.name, []);

    for (const scenario of SCENARIOS) {
      process.stdout.write(`  ${scenario.name}...`);

      for (const server of SERVERS) {
        const r = runOha(server.port, scenario.path, scenario.method, scenario.body, scenario.randRegex);
        allResults.get(server.name)!.push(r);
        process.stdout.write(` ${server.name}=${r.rps}`);
      }

      // Show speedup vs best non-optimized baseline
      const optRps = allResults.get("vjuga-http")!.at(-1)!.rps;
      let bestBaseline = 0;
      for (const server of SERVERS) {
        if (server.name !== "vjuga-http") {
          const rps = allResults.get(server.name)!.at(-1)!.rps;
          if (rps > bestBaseline) bestBaseline = rps;
        }
      }
      if (bestBaseline > 0) {
        process.stdout.write(` (${(optRps / bestBaseline).toFixed(2)}x vs best)`);
      }
      process.stdout.write("\n");
    }

    printComparison(allResults);

    // Fetch batch stats from optimized server
    const optServer = SERVERS.find((s) => s.name === "vjuga-http");
    if (optServer) {
      try {
        const stats = await simpleRequest(optServer.port, "GET", "/debug/batch-stats");
        console.log("\n  Batch stats:", stats.body);
      } catch { /* ignore */ }
    }

  } finally {
    console.log("\nShutting down servers...");
    await Promise.all(children.map(killServer));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
