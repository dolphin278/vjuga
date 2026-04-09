/**
 * HTTP load generator — built-in replacement for autocannon.
 *
 * Fires requests in a tight loop across N concurrent connections,
 * records per-request latency, and computes percentile statistics.
 *
 * Uses fetch() on Bun (native Zig HTTP — fast, avoids node:http stream
 * bugs, oven-sh/bun#27557) and node:http on Node (3x faster than
 * Node's undici-based fetch for this workload).
 */

import { request as httpRequest, type RequestOptions } from "node:http";
import type { BenchResult, BenchScenario } from "./types.ts";

const WARMUP_MS = 1_000;
const IS_BUN = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

export interface LoadConfig {
  port: number;
  concurrency: number;
  durationMs: number;
  scenarios: BenchScenario[];
  label: string;
}

/** Run a single scenario and return its result. */
export async function runScenario(
  port: number,
  scenario: BenchScenario,
  concurrency: number,
  durationMs: number,
): Promise<BenchResult> {
  // Warm up first
  await bombardWithDuration(port, scenario, concurrency, WARMUP_MS, null);

  // Collect heap before
  const heapBefore = await getHeapUsed(port);

  // Run measured phase
  const latencies: number[] = [];
  const stats = await bombardWithDuration(port, scenario, concurrency, durationMs, latencies);

  // Collect heap after
  const heapAfter = await getHeapUsed(port);

  // Sort for percentiles
  latencies.sort((a, b) => a - b);
  const len = latencies.length;

  return {
    scenario: scenario.name,
    rps: Math.round(stats.total / (durationMs / 1000)),
    latencyP50: len > 0 ? latencies[Math.floor(len * 0.5)] : 0,
    latencyP95: len > 0 ? latencies[Math.floor(len * 0.95)] : 0,
    latencyP99: len > 0 ? latencies[Math.floor(len * 0.99)] : 0,
    latencyMax: len > 0 ? latencies[len - 1] : 0,
    totalRequests: stats.total,
    errors: stats.errors,
    heapUsedBefore: heapBefore,
    heapUsedAfter: heapAfter,
  };
}

/** Fire requests in parallel for a given duration. */
async function bombardWithDuration(
  port: number,
  scenario: BenchScenario,
  concurrency: number,
  durationMs: number,
  latencies: number[] | null,
): Promise<{ total: number; errors: number }> {
  let total = 0;
  let errors = 0;
  const deadline = Date.now() + durationMs;
  let extraHeaders: Record<string, string> | undefined;

  if (scenario.setup) {
    extraHeaders = await scenario.setup(port);
  }

  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (Date.now() < deadline) {
          const start = performance.now();
          const ok = await fireRequest(port, scenario, extraHeaders);
          const elapsed = performance.now() - start;
          if (ok) {
            total++;
            if (latencies) latencies.push(elapsed);
          } else {
            errors++;
            total++;
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  return { total, errors };
}

// ── Bun: use native fetch() ──────────────────────────────────────────

async function fireRequestFetch(
  port: number,
  scenario: BenchScenario,
  extraHeaders?: Record<string, string>,
): Promise<boolean> {
  try {
    const url = `http://127.0.0.1:${port}${scenario.path}`;
    const headers: Record<string, string> = {
      ...scenario.headers,
      ...extraHeaders,
    };
    if (scenario.body) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method: scenario.method,
      headers,
      body: scenario.body ?? null,
    });
    await res.arrayBuffer();
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

// ── Node: use node:http (3x faster than Node's fetch) ────────────────

function fireRequestNodeHttp(
  port: number,
  scenario: BenchScenario,
  extraHeaders?: Record<string, string>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const headers: Record<string, string | number> = {
      ...scenario.headers,
      ...extraHeaders,
    };
    if (scenario.body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(scenario.body);
    }
    const opts: RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: scenario.path,
      method: scenario.method,
      headers,
    };
    const req = httpRequest(opts, (res) => {
      res.resume();
      res.on("end", () => {
        resolve(res.statusCode! >= 200 && res.statusCode! < 400);
      });
    });
    req.on("error", () => resolve(false));
    if (scenario.body) req.end(scenario.body);
    else req.end();
  });
}

// ── Dispatch to the right client ─────────────────────────────────────

const fireRequest = IS_BUN ? fireRequestFetch : fireRequestNodeHttp;

/** Fetch heap usage from the server's /debug/mem endpoint. */
async function getHeapUsed(port: number): Promise<number> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/debug/mem`);
    const data = await res.json() as { heapUsed?: number };
    return data.heapUsed || 0;
  } catch {
    return 0;
  }
}

/** Make a simple GET/POST request and return the response body + status. */
export async function simpleRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const reqHeaders: Record<string, string> = { ...headers };
  if (body) reqHeaders["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ?? null,
  });
  const respBody = await res.text();
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { respHeaders[k] = v; });
  return { status: res.status, body: respBody, headers: respHeaders };
}
