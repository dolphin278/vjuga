import { test } from "node:test";
import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type * as net from "node:net";
import * as HttpServer from "../../HttpServer.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

// Requests are fed through a fake socket handed straight to the underlying
// net.Server's 'connection' listener, so every run is synchronous and a
// million runs fit the fuzz budget. A real socket per run would not.

const uncaught: unknown[] = [];
process.on("uncaughtException", (e) => uncaught.push(e));

class FakeSocket extends EventEmitter {
  out: Buffer[] = [];
  ended = false;
  destroyed = false;
  paused = false;
  writableNeedDrain = false;
  writableLength = 0;
  setNoDelay(): void {}
  setTimeout(): void {}
  write(d: string | Buffer): boolean {
    this.out.push(Buffer.from(d));
    return true;
  }
  end(d?: Buffer): void {
    if (d !== undefined) this.out.push(d);
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
}

interface Seen {
  method: number;
  url: string;
  body: string | null;
  id: string | null;
}

const OK = HttpServer.precompute(200, "{}");

interface Harness {
  seen: Seen[];
  errors: unknown[];
  socket: FakeSocket;
}

/** `drainMask` bit i set → the i-th response reports a full write buffer. */
function connect(options: HttpServer.Options, drainMask = 0): Harness {
  const seen: Seen[] = [];
  const errors: unknown[] = [];
  const server = HttpServer.make(
    (req, socket) => {
      seen.push({
        method: req.method,
        url: req.url,
        body: req.body,
        id: HttpServer.getHeader(req, "x-id"),
      });
      HttpServer.respondRaw(socket, OK);
      if ((drainMask >>> (seen.length - 1)) & 1)
        (socket as unknown as FakeSocket).writableNeedDrain = true;
    },
    { headersTimeout: 0, keepAliveTimeout: 0, ...options, onError: (e) => errors.push(e) },
  );
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  const tcp = (server as unknown as Record<symbol, net.Server>)[sym];
  const socket = new FakeSocket();
  tcp.emit("connection", socket);
  return { seen, errors, socket };
}

/** Feed `stream` cut at the given points (sorted, deduplicated, in range). */
function feed(h: Harness, stream: Buffer, cuts: number[], drainEvery = false): void {
  let prev = 0;
  for (const c of cuts) {
    h.socket.emit("data", stream.subarray(prev, c));
    prev = c;
    if (drainEvery) drain(h);
  }
  if (prev < stream.length) h.socket.emit("data", stream.subarray(prev));
  drain(h);
}

/** Let the server resume until it stops pausing for backpressure. */
function drain(h: Harness): void {
  while (h.socket.paused) {
    h.socket.writableNeedDrain = false;
    h.socket.emit("drain");
  }
}

function cutPoints(len: number, raw: number[], bytewise: boolean): number[] {
  if (bytewise) return Array.from({ length: Math.max(0, len - 1) }, (_, i) => i + 1);
  const set = new Set<number>();
  for (const r of raw) if (len > 1) set.add(1 + (r % (len - 1)));
  return [...set].sort((a, b) => a - b);
}

// ── Valid pipelined streams vs an oracle ────────────────────────────

const from = <T>(xs: readonly T[]): Arb.Arbitrary<T> => Arb.constantFrom(...(xs as [T, ...T[]]));

const METHODS: Array<[string, number]> = [
  ["GET", HttpServer.GET],
  ["POST", HttpServer.POST],
  ["PUT", HttpServer.PUT],
  ["DELETE", HttpServer.DELETE],
  ["PATCH", HttpServer.PATCH],
  ["HEAD", 0],
  ["OPTIONS", 0],
];
const CL_NAMES = ["Content-Length", "content-length", "CONTENT-LENGTH", "Content-length"];
const ID_NAMES = ["X-Id", "x-id", "X-ID"];
const OWS = ["", " ", "  ", "\t", " \t"];
const OTHER = ["Host", "Accept", "Connection", "Cookie", "TE", "Content-Type", "Transfer"];
const BODY_EXTRA = ["", "", "é", "€😀", "\r\n\r\n", "GET / HTTP/1.1\r\n\r\n"];

interface Case {
  stream: Buffer;
  expected: Seen[];
  cuts: number[];
  drainMask: number;
  drainEvery: boolean;
}

const validCase: Arb.Arbitrary<Case> = Arb.gen((pick) => {
  const n = pick(Arb.integer(1, 6));
  const parts: string[] = [];
  const expected: Seen[] = [];
  for (let i = 0; i < n; i++) {
    const [mName, mConst] = pick(from(METHODS));
    const url = "/" + pick(Arb.string({ maxLength: 12 })).replaceAll(" ", "_");
    const body = pick(Arb.string({ maxLength: 24 })) + pick(from(BODY_EXTRA));
    const id = `${i}`;
    const headers: string[] = [];
    const nOther = pick(Arb.integer(0, 3));
    for (let k = 0; k < nOther; k++) {
      headers.push(`${pick(from(OTHER))}: ${pick(Arb.string({ maxLength: 10 }))}`);
    }
    const insert = (line: string): void => {
      headers.splice(pick(Arb.integer(0, headers.length)), 0, line);
    };
    insert(`${pick(from(ID_NAMES))}:${pick(from(OWS))}${id}`);
    const bodyLen = Buffer.byteLength(body);
    if (bodyLen > 0 || pick(Arb.boolean())) {
      const clName = pick(from(CL_NAMES));
      const before = pick(from(OWS));
      const after = pick(from(OWS));
      insert(`${clName}:${before}${bodyLen}${after}`);
      if (pick(Arb.integer(0, 7)) === 0) insert(`${clName}: ${bodyLen}`); // identical duplicate
    }
    const lead = pick(Arb.integer(0, 7)) === 0 ? "\r\n" : "";
    parts.push(
      `${lead}${mName} ${url} HTTP/1.1\r\n${headers.map((h) => h + "\r\n").join("")}\r\n${body}`,
    );
    expected.push({ method: mConst, url, body: bodyLen > 0 ? body : null, id });
  }
  const stream = Buffer.from(parts.join(""));
  const bytewise = pick(Arb.integer(0, 15)) === 0;
  const raw = pick(Arb.array(Arb.nat(1 << 20), { minLength: 0, maxLength: 8 }));
  // Backpressure on a random subset of responses; drain either after every
  // chunk or only at the end (so chunks pile up while paused)
  const drainMask = pick(Arb.integer(0, 3)) === 0 ? pick(Arb.nat(63)) : 0;
  const drainEvery = pick(Arb.boolean());
  return { stream, expected, cuts: cutPoints(stream.length, raw, bytewise), drainMask, drainEvery };
});

test("valid pipelined stream: dispatch matches the oracle for any chunking", () => {
  Prop.assert(
    validCase,
    ({ stream, expected, cuts, drainMask, drainEvery }) => {
      const h = connect({}, drainMask);
      feed(h, stream, cuts, drainEvery);
      assert.deepEqual(h.seen, expected);
      assert.deepEqual(h.errors, []);
      assert.equal(h.socket.ended || h.socket.destroyed, false);
      assert.equal(Buffer.concat(h.socket.out).length, OK.length * expected.length);
    },
    { numRuns: 1_000_000 },
  );
  assert.deepEqual(uncaught, []);
});

// ── Garbage: never crashes, chunking never changes the outcome ──────

const TOKENS = [
  "GET ",
  "POST ",
  "PATCH ",
  "/x",
  " HTTP/1.1",
  "\r\n",
  "\r",
  "\n",
  ":",
  " ",
  "\t",
  "Content-Length:",
  "content-length: 3",
  "Transfer-Encoding: chunked",
  "X-Id: 1",
  "5",
  "-",
  "0",
  "99999999999999999",
  "abc",
  "\r\n\r\n",
  "ÿ",
];

const garbageCase = Arb.gen((pick) => {
  const n = pick(Arb.integer(0, 40));
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      pick(Arb.integer(0, 4)) === 0 ? pick(Arb.string({ maxLength: 8 })) : pick(from(TOKENS)),
    );
  }
  const stream = Buffer.from(parts.join(""), "latin1");
  const small = pick(Arb.boolean());
  const options: HttpServer.Options = small ? { maxHeaderSize: 48, maxBodySize: 8 } : {};
  const bytewise = pick(Arb.integer(0, 15)) === 0;
  const raw = pick(Arb.array(Arb.nat(1 << 20), { minLength: 0, maxLength: 8 }));
  return { stream, options, cuts: cutPoints(stream.length, raw, bytewise) };
});

test("garbage never throws, never reports an internal fault, and is chunking-invariant", () => {
  Prop.assert(
    garbageCase,
    ({ stream, options, cuts }) => {
      const whole = connect(options);
      feed(whole, stream, []);
      const split = connect(options);
      feed(split, stream, cuts);
      assert.deepEqual(whole.errors, []);
      assert.deepEqual(split.errors, []);
      assert.deepEqual(split.seen, whole.seen);
      assert.deepEqual(Buffer.concat(split.socket.out), Buffer.concat(whole.socket.out));
      assert.equal(split.socket.ended, whole.socket.ended);
      // Every dispatched request got its 200; a rejection (if any) is last
      const out = Buffer.concat(whole.socket.out);
      const okBytes = OK.length * whole.seen.length;
      assert.deepEqual(out.subarray(0, okBytes), Buffer.concat(whole.seen.map(() => OK)));
      if (out.length > okBytes) {
        assert.equal(whole.socket.ended, true);
        assert.match(out.subarray(okBytes).toString("latin1"), /^HTTP\/1\.1 (400|413|431|501) /);
      }
    },
    { numRuns: 1_000_000 },
  );
  assert.deepEqual(uncaught, []);
});
