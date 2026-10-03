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
  get writable(): boolean {
    return !this.ended && !this.destroyed;
  }
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
  cork(): void {}
  uncork(): void {}
}

interface Seen {
  method: number;
  url: string;
  body: string | null;
  id: string | null;
}

const OK = HttpServer.precompute(200, "{}");
// What respondRaw(OK) sends as the last response of a closing connection
const OK_CLOSE = Buffer.from(
  OK.toString("latin1").replace("Connection: keep-alive", "Connection: close"),
  "latin1",
);

interface Harness {
  seen: Seen[];
  errors: unknown[];
  socket: FakeSocket;
  /** Deferred (async) responses not yet sent. */
  pending: Array<() => void>;
  /** Most responses ever pending at once (one request in flight → <= 1). */
  maxPending: number;
}

/**
 * `drainMask` bit i set → the i-th response reports a full write buffer.
 * `deferMask` bit i set → the i-th request is answered later (async handler).
 * `killAt` → the handler of that request destroys (or, with `killEnds`,
 * ends) the socket right after answering.
 */
function connect(
  options: HttpServer.Options,
  drainMask = 0,
  deferMask = 0,
  killAt = -1,
  killEnds = false,
): Harness {
  const h: Harness = {
    seen: [],
    errors: [],
    socket: new FakeSocket(),
    pending: [],
    maxPending: 0,
  };
  const server = HttpServer.make(
    (req, socket) => {
      const i = h.seen.length;
      h.seen.push({
        method: req.method,
        url: req.url,
        body: req.body,
        id: HttpServer.getHeader(req, "x-id"),
      });
      const answer = (): void => {
        // getHeader() must still see this request's bytes when answering late
        assert.equal(HttpServer.getHeader(req, "x-id"), h.seen[i].id);
        HttpServer.respondRaw(socket, OK);
        if ((drainMask >>> i) & 1) (socket as unknown as FakeSocket).writableNeedDrain = true;
        if (i === killAt) {
          if (killEnds) socket.end();
          else socket.destroy();
        }
      };
      if ((deferMask >>> i) & 1) {
        h.pending.push(answer);
        h.maxPending = Math.max(h.maxPending, h.pending.length);
      } else answer();
    },
    { headersTimeout: 0, keepAliveTimeout: 0, ...options, onError: (e) => h.errors.push(e) },
  );
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  const tcp = (server as unknown as Record<symbol, net.Server>)[sym];
  tcp.emit("connection", h.socket);
  return h;
}

const nextTick = (): Promise<void> => new Promise((r) => process.nextTick(r));

/** Answer deferred responses and drain until the connection is idle. */
async function settle(h: Harness): Promise<void> {
  for (;;) {
    drain(h);
    const answer = h.pending.shift();
    if (answer === undefined) return;
    answer();
    await nextTick(); // dispatch resumes on the next tick
  }
}

/** feed() for async handlers: settle after every chunk or only at the end. */
async function feedAsync(
  h: Harness,
  stream: Buffer,
  cuts: number[],
  settleEvery: boolean,
): Promise<void> {
  let prev = 0;
  for (const c of cuts) {
    h.socket.emit("data", stream.subarray(prev, c));
    prev = c;
    if (settleEvery) await settle(h);
  }
  if (prev < stream.length) h.socket.emit("data", stream.subarray(prev));
  await settle(h);
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
  // A pause without a 'drain' listener waits for an async response instead
  while (h.socket.paused && h.socket.listenerCount("drain") > 0) {
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
const OTHER = ["Host", "Accept", "Upgrade", "Cookie", "TE", "Content-Type", "Transfer"];
// [version, Connection header or "", closes after the response]
const CONN_MODES: Array<[string, string, boolean]> = [
  ["HTTP/1.1", "", false],
  ["HTTP/1.1", "Connection: keep-alive", false],
  ["HTTP/1.1", "connection:Keep-Alive, Upgrade", false],
  ["HTTP/1.0", "Connection: keep-alive", false],
  ["HTTP/1.1", "Connection: close", true],
  ["HTTP/1.1", "CONNECTION: upgrade ,\tClose ", true],
  ["HTTP/1.0", "", true],
  ["HTTP/1.0", "Connection: keep-alive, close", true],
];
const BODY_EXTRA = ["", "", "é", "€😀", "\r\n\r\n", "GET / HTTP/1.1\r\n\r\n"];

interface Case {
  stream: Buffer;
  expected: Seen[];
  /** The last dispatched request asked for Connection: close (or HTTP/1.0). */
  closes: boolean;
  /** The last dispatched request's handler kills the socket. */
  killed: boolean;
  killAt: number;
  killEnds: boolean;
  cuts: number[];
  drainMask: number;
  deferMask: number;
  drainEvery: boolean;
}

const validCase: Arb.Arbitrary<Case> = Arb.gen((pick) => {
  const n = pick(Arb.integer(1, 6));
  const parts: string[] = [];
  const expected: Seen[] = [];
  let closes = false;
  let killed = false;
  // Sometimes a handler ends or destroys the socket after answering
  const killAt = pick(Arb.integer(0, 7)) === 0 ? pick(Arb.integer(0, n - 1)) : -1;
  const killEnds = pick(Arb.boolean());
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
    // Mostly keep-alive so pipelines stay long; a closing request ends it
    const [version, connHeader, close] =
      pick(Arb.integer(0, 3)) === 0 ? pick(from(CONN_MODES)) : CONN_MODES[0];
    if (connHeader !== "") insert(connHeader);
    const lead = pick(Arb.integer(0, 7)) === 0 ? "\r\n" : "";
    parts.push(
      `${lead}${mName} ${url} ${version}\r\n${headers.map((h) => h + "\r\n").join("")}\r\n${body}`,
    );
    // Requests after a closing (or killing) one are sent but never dispatched
    if (!closes && !killed) {
      expected.push({ method: mConst, url, body: bodyLen > 0 ? body : null, id });
      closes = close;
      killed = i === killAt;
    }
  }
  const stream = Buffer.from(parts.join(""));
  const bytewise = pick(Arb.integer(0, 15)) === 0;
  const raw = pick(Arb.array(Arb.nat(1 << 20), { minLength: 0, maxLength: 8 }));
  // Backpressure on a random subset of responses; drain either after every
  // chunk or only at the end (so chunks pile up while paused)
  const drainMask = pick(Arb.integer(0, 3)) === 0 ? pick(Arb.nat(63)) : 0;
  const deferMask = pick(Arb.integer(0, 1)) === 0 ? pick(Arb.nat(63)) : 0;
  const drainEvery = pick(Arb.boolean());
  const cuts = cutPoints(stream.length, raw, bytewise);
  return {
    stream,
    expected,
    closes,
    killed,
    killAt,
    killEnds,
    cuts,
    drainMask,
    deferMask,
    drainEvery,
  };
});

test("valid pipelined stream: dispatch matches the oracle for any chunking", async () => {
  await Prop.assertAsync(
    validCase,
    async (c) => {
      const { stream, expected, closes, killed, cuts, drainEvery } = c;
      const h = connect({}, c.drainMask, c.deferMask, c.killAt, c.killEnds);
      await feedAsync(h, stream, cuts, drainEvery);
      assert.deepEqual(h.seen, expected);
      assert.deepEqual(h.errors, []);
      assert.ok(h.maxPending <= 1, "more than one request in flight");
      assert.equal(h.socket.ended, closes || (killed && c.killEnds));
      assert.equal(h.socket.destroyed, killed && !c.killEnds);
      // Responses in request order; the last says close iff the request did
      const last = closes ? OK_CLOSE : OK;
      const want = Buffer.concat([...expected.slice(1).map(() => OK), last]);
      assert.deepEqual(Buffer.concat(h.socket.out), want);
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
  "\x00",
  " HTTP/1.0",
  "Connection: close",
  "Connection: keep-alive",
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
      // Every dispatched request got its 200 (the last one possibly with
      // Connection: close, which ends the stream); a rejection (if any) is last
      const out = Buffer.concat(whole.socket.out);
      const n = whole.seen.length;
      const closed = n > 0 && out.subarray(OK.length * (n - 1)).equals(OK_CLOSE);
      const want = Buffer.concat([
        ...whole.seen.slice(closed ? 1 : 0).map(() => OK),
        ...(closed ? [OK_CLOSE] : []),
      ]);
      const okBytes = want.length;
      assert.deepEqual(out.subarray(0, okBytes), want);
      if (closed) assert.equal(whole.socket.ended, true);
      if (out.length > okBytes) {
        assert.equal(whole.socket.ended, true);
        assert.match(out.subarray(okBytes).toString("latin1"), /^HTTP\/1\.1 (400|413|431|501) /);
      }
    },
    { numRuns: 1_000_000 },
  );
  assert.deepEqual(uncaught, []);
});

// ── Options: RangeError iff the value is invalid (G4-3) ────────────

const optionValue = Arb.oneOf<number>(
  Arb.constantFrom(NaN, Infinity, -Infinity, 0, -0, 1, -1, 0.5, 2 ** 31 - 1, 2 ** 31, 2 ** 53),
  Arb.integer(-10, 100_000),
  Arb.float(-1e12, 1e12),
);
const OPTION_NAMES = [
  "maxHeaderSize",
  "maxBodySize",
  "headersTimeout",
  "keepAliveTimeout",
] as const;

test("make() throws RangeError exactly for invalid size/timeout options", () => {
  Prop.assert(
    Arb.tuple<[(typeof OPTION_NAMES)[number], number]>(from(OPTION_NAMES), optionValue),
    ([name, v]) => {
      const valid =
        name === "maxHeaderSize" || name === "maxBodySize"
          ? Number.isSafeInteger(v) && v >= (name === "maxHeaderSize" ? 1 : 0)
          : v >= 0 && v <= 2 ** 31 - 1;
      let threw: unknown = null;
      try {
        HttpServer.make(() => {}, { [name]: v } as HttpServer.Options);
      } catch (e) {
        threw = e;
      }
      if (valid) assert.equal(threw, null, `${name}=${v}`);
      else assert.ok(threw instanceof RangeError, `${name}=${v}`);
    },
    { numRuns: 1_000_000 },
  );
});
