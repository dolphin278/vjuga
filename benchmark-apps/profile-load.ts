/**
 * Standalone load driver for profiling a single server.
 * Usage: node --experimental-strip-types benchmark-apps/profile-load.ts <port> <durationSec>
 */

import { request as httpRequest } from "node:http";

const PORT = parseInt(process.argv[2] || "3200", 10);
const DURATION_S = parseInt(process.argv[3] || "15", 10);
const CONCURRENCY = 50;

interface Scenario {
  name: string;
  method: string;
  path: string;
  body?: string;
}

const SCENARIOS: Scenario[] = [
  { name: "health", method: "GET", path: "/health" },
  { name: "users-list", method: "GET", path: "/users?offset=0&limit=20" },
  { name: "user-by-id", method: "GET", path: "/users/42" },
  { name: "login", method: "POST", path: "/auth/login", body: '{"user":"user0","pass":"pass0"}' },
  { name: "create-user", method: "POST", path: "/users", body: '{"username":"prof_USER","password":"p","email":"e@e.com"}' },
  { name: "static-file", method: "GET", path: "/files/large.txt" },
];

let counter = 0;

function fire(scenario: Scenario): Promise<boolean> {
  return new Promise((resolve) => {
    let body = scenario.body;
    if (scenario.name === "create-user") {
      body = `{"username":"prof_${counter++}","password":"p","email":"e@e.com"}`;
    }
    const headers: Record<string, string | number> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = httpRequest({ hostname: "127.0.0.1", port: PORT, path: scenario.path, method: scenario.method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode! < 400));
    });
    req.on("error", () => resolve(false));
    if (body) req.end(body); else req.end();
  });
}

async function worker(deadline: number): Promise<number> {
  let count = 0;
  while (Date.now() < deadline) {
    const scenario = SCENARIOS[count % SCENARIOS.length];
    await fire(scenario);
    count++;
  }
  return count;
}

async function main() {
  // Wait for server to be ready
  await new Promise(r => setTimeout(r, 500));
  console.log(`Loading port ${PORT} for ${DURATION_S}s with ${CONCURRENCY} connections...`);

  const deadline = Date.now() + DURATION_S * 1000;
  const workers = Array.from({ length: CONCURRENCY }, () => worker(deadline));
  const counts = await Promise.all(workers);
  const total = counts.reduce((a, b) => a + b, 0);
  console.log(`Done: ${total} requests in ${DURATION_S}s (${Math.round(total / DURATION_S)} rps)`);
}

main().catch(console.error);
