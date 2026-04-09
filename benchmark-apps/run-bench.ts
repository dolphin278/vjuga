/**
 * Benchmark orchestrator — spawns naive and optimized servers,
 * runs load scenarios, and prints a side-by-side comparison table.
 *
 * Usage:
 *   node --experimental-strip-types --expose-gc benchmark-apps/run-bench.ts
 *   node --experimental-strip-types benchmark-apps/run-bench.ts --smoke
 *   bun benchmark-apps/run-bench.ts
 *   bun benchmark-apps/run-bench.ts --smoke
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario, simpleRequest } from "./shared/bench.ts";
import type { BenchResult, BenchScenario } from "./shared/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_BUN = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SMOKE = args.includes("--smoke");
const PROFILE_CPU = !IS_BUN && args.includes("--profile") && args.includes("cpu");
const PROFILE_HEAP = !IS_BUN && args.includes("--profile") && args.includes("heap");
const CONCURRENCY = parseInt(getArg("--concurrency") || "50", 10);
const DURATION_MS = parseInt(getArg("--duration") || "10000", 10);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── Readiness polling — works with any runtime ──────────────────────
async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status } = await simpleRequest(port, "GET", "/health");
      if (status === 200) return;
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

// ── Server spawning — works with both Node and Bun ──────────────────
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
      spawnArgs = ["--experimental-strip-types"];
      if (typeof globalThis.gc === "function") spawnArgs.push("--expose-gc");
      if (PROFILE_CPU) spawnArgs.push("--prof");
      if (PROFILE_HEAP) spawnArgs.push("--heap-prof");
      spawnArgs.push(scriptPath);
    }

    const child = spawn(cmd, spawnArgs, {
      env: { ...process.env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      reject(new Error(`Server ${script} did not start within 10s`));
      child.kill("SIGTERM");
    }, 10000);

    // Poll for readiness via HTTP instead of IPC (works with any runtime)
    waitForReady(port, 9000).then(() => {
      clearTimeout(timeout);
      resolve_(child);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("error", (err) => {
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
    if (child.exitCode !== null) {
      resolve_();
      return;
    }
    child.on("exit", () => resolve_());
    child.kill("SIGTERM");
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve_();
    }, 3000);
  });
}

// ── Smoke test ───────────────────────────────────────────────────────
async function smokeTest(port: number, label: string): Promise<boolean> {
  console.log(`\n── Smoke testing ${label} (port ${port}) ──`);
  let pass = true;

  // Health
  const health = await simpleRequest(port, "GET", "/health");
  check("GET /health", health.status === 200 && health.body.includes('"ok":true'));

  // Login
  const login = await simpleRequest(port, "POST", "/auth/login",
    JSON.stringify({ user: "user0", pass: "pass0" }));
  check("POST /auth/login", login.status === 200 && login.body.includes('"token"'));

  // Extract session cookie
  const cookie = login.headers["set-cookie"] || "";
  const sessionHeaders = { Cookie: cookie.split(";")[0] };

  // Get users
  const users = await simpleRequest(port, "GET", "/users?offset=0&limit=5");
  check("GET /users", users.status === 200);
  const usersList = JSON.parse(users.body);
  check("GET /users returns array", Array.isArray(usersList) && usersList.length === 5);

  // Get single user
  const user1 = await simpleRequest(port, "GET", "/users/1");
  check("GET /users/1", user1.status === 200 && user1.body.includes('"username"'));

  // Create user
  const createBody = JSON.stringify({ username: `smoke_${Date.now()}`, password: "test", email: "smoke@test.com" });
  const created = await simpleRequest(port, "POST", "/users", createBody);
  check("POST /users", created.status === 201 && created.body.includes('"id"'));

  // Update user
  const createdId = JSON.parse(created.body).id;
  const updated = await simpleRequest(port, "PUT", `/users/${createdId}`,
    JSON.stringify({ email: "updated@test.com" }));
  check("PUT /users/:id", updated.status === 200);

  // Delete user
  const deleted = await simpleRequest(port, "DELETE", `/users/${createdId}`);
  check("DELETE /users/:id", deleted.status === 200);

  // Static file
  const file = await simpleRequest(port, "GET", "/files/small.txt");
  check("GET /files/small.txt", file.status === 200 && file.body === "Hello, World!");

  const largefile = await simpleRequest(port, "GET", "/files/large.txt");
  check("GET /files/large.txt", largefile.status === 200 && largefile.body.length === 100_000);

  // 404
  const notfound = await simpleRequest(port, "GET", "/nope");
  check("GET /nope → 404", notfound.status === 404);

  // Logout
  const logout = await simpleRequest(port, "POST", "/auth/logout", undefined, sessionHeaders);
  check("POST /auth/logout", logout.status === 200);

  console.log(`  ${label}: ${pass ? "ALL PASSED" : "SOME FAILED"}`);
  return pass;

  function check(name: string, ok: boolean): void {
    const icon = ok ? "  ✓" : "  ✗";
    console.log(`${icon} ${name}`);
    if (!ok) pass = false;
  }
}

// ── Benchmark scenarios ──────────────────────────────────────────────
function makeScenarios(): BenchScenario[] {
  let userCounter = 10_000;

  return [
    {
      name: "GET /health",
      method: "GET",
      path: "/health",
    },
    {
      name: "GET /users?limit=20",
      method: "GET",
      path: "/users?offset=0&limit=20",
    },
    {
      name: "GET /users/:id",
      method: "GET",
      path: "/users/42",
    },
    {
      name: "POST /auth/login",
      method: "POST",
      path: "/auth/login",
      body: JSON.stringify({ user: "user0", pass: "pass0" }),
    },
    {
      name: "POST /users (create)",
      method: "POST",
      path: "/users",
      get body() {
        const id = userCounter++;
        return JSON.stringify({ username: `bench_user_${id}`, password: "benchpass", email: `bench${id}@test.com` });
      },
    },
    {
      name: "GET /files/large.txt",
      method: "GET",
      path: "/files/large.txt",
    },
  ];
}

// ── Output formatting ────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatLatency(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function printComparison(naiveResults: BenchResult[], optResults: BenchResult[]): void {
  console.log("\n" + "═".repeat(110));
  console.log("  BENCHMARK COMPARISON: naive vs optimized");
  console.log("═".repeat(110));

  const header = [
    "Scenario".padEnd(25),
    "naive rps".padStart(10),
    "opt rps".padStart(10),
    "speedup".padStart(8),
    "naive p99".padStart(10),
    "opt p99".padStart(10),
    "naive heap".padStart(11),
    "opt heap".padStart(11),
  ].join(" │ ");

  console.log(header);
  console.log("─".repeat(110));

  for (let i = 0; i < naiveResults.length; i++) {
    const n = naiveResults[i];
    const o = optResults[i];
    if (!n || !o) continue;

    const speedup = n.rps > 0 ? (o.rps / n.rps) : 0;
    const speedupStr = speedup >= 1
      ? `${speedup.toFixed(2)}x`
      : `${(1 / speedup).toFixed(2)}x ↓`;

    const row = [
      n.scenario.padEnd(25),
      String(n.rps).padStart(10),
      String(o.rps).padStart(10),
      speedupStr.padStart(8),
      formatLatency(n.latencyP99).padStart(10),
      formatLatency(o.latencyP99).padStart(10),
      formatBytes(n.heapUsedAfter).padStart(11),
      formatBytes(o.heapUsedAfter).padStart(11),
    ].join(" │ ");

    console.log(row);
  }

  console.log("═".repeat(110));

  // Summary
  let totalNaive = 0, totalOpt = 0;
  for (let i = 0; i < naiveResults.length; i++) {
    totalNaive += naiveResults[i].rps;
    totalOpt += optResults[i].rps;
  }
  const overallSpeedup = totalNaive > 0 ? (totalOpt / totalNaive) : 0;
  console.log(`\n  Overall: naive ${totalNaive} rps total, optimized ${totalOpt} rps total (${overallSpeedup.toFixed(2)}x)`);
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
    if (SMOKE) {
      const [naiveOk, optOk] = await Promise.all([
        smokeTest(NAIVE_PORT, "naive"),
        smokeTest(OPT_PORT, "optimized"),
      ]);
      process.exitCode = naiveOk && optOk ? 0 : 1;
      return;
    }

    // Run smoke tests first to validate
    console.log("Running smoke tests first...");
    const [naiveOk, optOk] = await Promise.all([
      smokeTest(NAIVE_PORT, "naive"),
      smokeTest(OPT_PORT, "optimized"),
    ]);
    if (!naiveOk || !optOk) {
      console.error("Smoke tests failed — aborting benchmarks");
      process.exitCode = 1;
      return;
    }

    // Benchmark
    const scenarios = makeScenarios();
    const naiveResults: BenchResult[] = [];
    const optResults: BenchResult[] = [];

    console.log(`\nBenchmarking: ${CONCURRENCY} connections, ${DURATION_MS / 1000}s per scenario\n`);

    for (const scenario of scenarios) {
      process.stdout.write(`  ${scenario.name}...`);

      // Run naive first, then optimized (sequential to avoid port contention)
      const naiveResult = await runScenario(NAIVE_PORT, scenario, CONCURRENCY, DURATION_MS);
      process.stdout.write(` naive=${naiveResult.rps} rps`);

      const optResult = await runScenario(OPT_PORT, scenario, CONCURRENCY, DURATION_MS);
      const speedup = naiveResult.rps > 0 ? (optResult.rps / naiveResult.rps).toFixed(2) : "N/A";
      process.stdout.write(` opt=${optResult.rps} rps (${speedup}x)\n`);

      naiveResults.push(naiveResult);
      optResults.push(optResult);
    }

    printComparison(naiveResults, optResults);

  } finally {
    console.log("\nShutting down servers...");
    await Promise.all([killServer(naiveChild), killServer(optChild)]);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
