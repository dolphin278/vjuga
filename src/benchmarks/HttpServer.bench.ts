// HttpServer load benchmark — server on the main thread, load generator on a
// worker thread (raw node:net pipelining, no autocannon dependency).
//
//   node --experimental-strip-types src/benchmarks/HttpServer.bench.ts [modulePath]
//
// `modulePath` (optional) points at an alternative build of HttpServer.js so
// two implementations can be compared within one run; ratios between runs on
// a busy machine are meaningless, ratios within a run are not.

import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import * as path from "node:path";

type HttpServerModule = typeof import("../HttpServer.js");

const DURATION_MS = Number(process.env.BENCH_MS ?? 3000);
const WARMUP_MS = 1000;

const CLIENT = `
const { parentPort, workerData } = require("node:worker_threads");
const net = require("node:net");
const { port, request, responseLen, connections, depth, warmupMs, durationMs } = workerData;
const req = Buffer.from(request);
const batch = Buffer.alloc(req.length * depth);
for (let i = 0; i < depth; i++) req.copy(batch, i * req.length);
let counting = false;
let total = 0;
const sockets = [];
for (let c = 0; c < connections; c++) {
  const s = net.connect(port, "127.0.0.1");
  s.setNoDelay(true);
  let bytes = 0;
  let done = 0;
  s.on("connect", () => s.write(batch));
  s.on("data", (d) => {
    bytes += d.length;
    const nowDone = Math.floor(bytes / responseLen);
    const n = nowDone - done;
    if (n === 0) return;
    done = nowDone;
    if (counting) total += n;
    s.write(n === depth ? batch : batch.subarray(0, n * req.length));
  });
  s.on("error", () => {});
  sockets.push(s);
}
setTimeout(() => {
  counting = true;
  const t0 = process.hrtime.bigint();
  setTimeout(() => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    counting = false;
    for (const s of sockets) s.destroy();
    parentPort.postMessage(Math.round((total / ms) * 1000));
  }, durationMs);
}, warmupMs);
`;

interface Scenario {
  name: string;
  request: string;
  connections: number;
  depth: number;
}

const GET_REQ =
  "GET /api/users/42?fields=name HTTP/1.1\r\nHost: localhost:3000\r\n" +
  "User-Agent: bench/1.0\r\nAccept: application/json\r\nAccept-Encoding: gzip, deflate\r\n" +
  "Connection: keep-alive\r\n\r\n";
const POST_BODY = JSON.stringify({ name: "alice", email: "alice@example.com", age: 42 });
const POST_REQ =
  "POST /api/users HTTP/1.1\r\nHost: localhost:3000\r\nUser-Agent: bench/1.0\r\n" +
  "Accept: application/json\r\nContent-Type: application/json\r\n" +
  `Content-Length: ${Buffer.byteLength(POST_BODY)}\r\nConnection: keep-alive\r\n\r\n${POST_BODY}`;

const SCENARIOS: Scenario[] = [
  { name: "GET pipelined (32 conn x 16)", request: GET_REQ, connections: 32, depth: 16 },
  { name: "POST+body pipelined (32 conn x 16)", request: POST_REQ, connections: 32, depth: 16 },
  { name: "GET keep-alive (64 conn x 1)", request: GET_REQ, connections: 64, depth: 1 },
];

async function runScenario(H: HttpServerModule, sc: Scenario): Promise<number> {
  const okRaw = H.precompute(200, '{"ok":true}');
  const server = H.make((req, socket) => {
    if (req.body === null) H.respondRaw(socket, okRaw);
    else H.respond(socket, 201, req.body);
  });
  await H.listen(server, 0);
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  const port = ((server as any)[sym].address() as { port: number }).port;
  const responseLen =
    sc.request === POST_REQ
      ? Buffer.byteLength(
          `HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: ${Buffer.byteLength(POST_BODY)}\r\n\r\n${POST_BODY}`,
        )
      : okRaw.length;
  const runWorker = (connections: number): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const w = new Worker(CLIENT, {
        eval: true,
        workerData: {
          port,
          request: sc.request,
          responseLen,
          connections,
          depth: sc.depth,
          warmupMs: WARMUP_MS,
          durationMs: DURATION_MS,
        },
      });
      w.once("message", (n: number) => {
        void w.terminate();
        resolve(n);
      });
      w.once("error", reject);
    });
  // Two load-generator threads so the client is not the bottleneck
  const parts = await Promise.all([runWorker(sc.connections / 2), runWorker(sc.connections / 2)]);
  const rps = parts[0] + parts[1];
  await H.close(server);
  return rps;
}

const target = process.argv[2];
const H: HttpServerModule = target
  ? await import(pathToFileURL(path.resolve(target)).href)
  : await import("../HttpServer.js");

console.log(`HttpServer load bench (${target ?? "../HttpServer.js"})`);
for (const sc of SCENARIOS) {
  const rps = await runScenario(H, sc);
  console.log(`  ${sc.name.padEnd(38)} ${rps.toLocaleString("en-US").padStart(12)} req/s`);
}
