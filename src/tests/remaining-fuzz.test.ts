/**
 * Fuzz tests for all remaining modules without fuzz coverage:
 * Result, TaggedUnion, BatchExecutor, BufferizedFunction,
 * TimedFunction, PromiseUtils, PRNG, FunctionUtils, UUID,
 * ISOTimestamp, UnixTimestamp
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import type { Result } from "../Result.js";

// ============================================================================
// Result
// ============================================================================

test("Result: ok/err discriminant and payload round-trip", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.integer(-10000, 10000), (n) => {
    const o = R.ok(n);
    if (!R.isOk(o)) return false;
    if (R.isErr(o)) return false;
    if (o[0] !== true || o[1] !== n) return false;

    const e = R.err(n);
    if (R.isOk(e)) return false;
    if (!R.isErr(e)) return false;
    if (e[0] !== false || e[1] !== n) return false;

    return true;
  }, { numRuns: 2000 });
});

test("Result: map transforms Ok, passes Err through", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.integer(-1000, 1000), (n) => {
    const doubled = R.map(R.ok(n), (x: number) => x * 2);
    if (!R.isOk(doubled) || doubled[1] !== n * 2) return false;

    const errResult = R.map(R.err("fail") as Result<number, string>, (x: number) => x * 2);
    if (!R.isErr(errResult) || errResult[1] !== "fail") return false;

    return true;
  }, { numRuns: 2000 });
});

test("Result: mapErr transforms Err, passes Ok through", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.string({ maxLength: 10 }), (s) => {
    const mapped = R.mapErr(R.err(s), (e: string) => e.toUpperCase());
    if (!R.isErr(mapped) || mapped[1] !== s.toUpperCase()) return false;

    const okResult = R.mapErr(R.ok(42) as Result<number, string>, (e: string) => e.toUpperCase());
    if (!R.isOk(okResult) || okResult[1] !== 42) return false;

    return true;
  }, { numRuns: 2000 });
});

test("Result: flatMap chains Ok, passes Err through", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.integer(0, 1000), (n) => {
    const chained = R.flatMap(R.ok(n), (x: number) =>
      x > 500 ? R.err("too big") : R.ok(x * 2),
    );
    if (n > 500) {
      if (!R.isErr(chained) || chained[1] !== "too big") return false;
    } else {
      if (!R.isOk(chained) || chained[1] !== n * 2) return false;
    }
    return true;
  }, { numRuns: 2000 });
});

test("Result: unwrapOr returns fallback for Err", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.tuple(Arb.integer(-100, 100), Arb.integer(-100, 100)), ([val, fallback]) => {
    if (R.unwrapOr(R.ok(val), fallback) !== val) return false;
    if (R.unwrapOr(R.err("nope") as Result<number, string>, fallback) !== fallback) return false;
    return true;
  }, { numRuns: 2000 });
});

test("Result: unwrap returns Ok value, throws on Err", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.integer(-1000, 1000), (n) => {
    if (R.unwrap(R.ok(n)) !== n) return false;

    try {
      R.unwrap(R.err(new Error("boom")));
      return false; // should have thrown
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "boom") return false;
    }

    try {
      R.unwrap(R.err("string error"));
      return false;
    } catch (e) {
      if (!(e instanceof Error)) return false;
    }

    return true;
  }, { numRuns: 1000 });
});

test("Result: fromThrowable captures exceptions", async () => {
  const R = await import("../Result.js");

  Prop.assert(Arb.integer(-100, 100), (n) => {
    const good = R.fromThrowable(() => n * 2);
    if (!R.isOk(good) || good[1] !== n * 2) return false;

    const bad = R.fromThrowable(() => { throw new Error("fail"); });
    if (!R.isErr(bad)) return false;

    const mapped = R.fromThrowable(
      () => { throw "raw"; },
      (e) => `caught: ${e}`,
    );
    if (!R.isErr(mapped) || mapped[1] !== "caught: raw") return false;

    return true;
  }, { numRuns: 1000 });
});

test("Result: fromPromise never rejects", async () => {
  const R = await import("../Result.js");

  const ok = await R.fromPromise(Promise.resolve(42));
  assert.equal(R.isOk(ok), true);
  assert.equal(ok[1], 42);

  const err = await R.fromPromise(Promise.reject("fail"));
  assert.equal(R.isErr(err), true);
  assert.equal(err[1], "fail");

  const mapped = await R.fromPromise(
    Promise.reject("raw"),
    (e) => `caught: ${e}`,
  );
  assert.equal(R.isErr(mapped), true);
  assert.equal(mapped[1], "caught: raw");
});

// ============================================================================
// TaggedUnion
// ============================================================================

test("TaggedUnion: variant + match round-trip", async () => {
  const TU = await import("../TaggedUnion.js");

  type Shape = { circle: { r: number }; rect: { w: number; h: number } };
  type ShapeUnion = import("../TaggedUnion.js").TaggedUnion<Shape>;

  Prop.assert(
    Arb.tuple(Arb.boolean(), Arb.integer(1, 100), Arb.integer(1, 100)),
    ([isCircle, a, b]) => {
      const shape: ShapeUnion = isCircle
        ? TU.variant("circle", { r: a })
        : TU.variant("rect", { w: a, h: b });

      const area = TU.match(shape, {
        circle: (v) => Math.PI * v.r ** 2,
        rect: (v) => v.w * v.h,
      }) as number;

      if (isCircle) {
        return Math.abs(area - Math.PI * a * a) < 1e-10;
      }
      return area === a * b;
    },
    { numRuns: 2000 },
  );
});

test("TaggedUnion: is() narrows correctly", async () => {
  const TU = await import("../TaggedUnion.js");

  Prop.assert(
    Arb.constantFrom("a", "b", "c"),
    (tag) => {
      const v = TU.variant(tag, tag.toUpperCase());
      if (!TU.is(v, tag)) return false;
      const others = ["a", "b", "c"].filter((t) => t !== tag);
      for (const other of others) {
        if (TU.is(v, other)) return false;
      }
      return true;
    },
    { numRuns: 2000 },
  );
});

// ============================================================================
// BatchExecutor (async — batches calls and distributes results)
// ============================================================================

test("BatchExecutor: batches calls and returns correct results", async () => {
  const BE = await import("../BatchExecutor.js");

  const executor = BE.make<number, number>(async (args) =>
    args.map((n) => ({ status: "fulfilled" as const, value: n * 2 })),
  );

  // Fire multiple calls synchronously — they should batch together
  const results = await Promise.all([
    executor(1), executor(2), executor(3), executor(4), executor(5),
  ]);

  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("BatchExecutor: per-item rejection works", async () => {
  const BE = await import("../BatchExecutor.js");

  const executor = BE.make<number, number>(async (args) =>
    args.map((n) =>
      n < 0
        ? { status: "rejected" as const, reason: new Error(`negative: ${n}`) }
        : { status: "fulfilled" as const, value: n * 2 },
    ),
  );

  const [a, b] = await Promise.allSettled([executor(5), executor(-1)]);
  assert.equal(a.status, "fulfilled");
  if (a.status === "fulfilled") assert.equal(a.value, 10);
  assert.equal(b.status, "rejected");
});

test("BatchExecutor: batch function error rejects all pending", async () => {
  const BE = await import("../BatchExecutor.js");

  const executor = BE.make<number, number>(async () => {
    throw new Error("batch boom");
  });

  const results = await Promise.allSettled([executor(1), executor(2), executor(3)]);
  for (const r of results) {
    assert.equal(r.status, "rejected");
  }
});

// ============================================================================
// BufferizedFunction (async — batches fire-and-forget calls)
// ============================================================================

test("BufferizedFunction: batches synchronous calls", async () => {
  const BF = await import("../BufferizedFunction.js");

  let batches: number[][] = [];
  const buf = BF.make((batch: number[]) => { batches.push(batch); });

  buf(1);
  buf(2);
  buf(3);

  // Wait for macrotask
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [1, 2, 3]);
});

test("BufferizedFunction: io schedule mode", async () => {
  const BF = await import("../BufferizedFunction.js");

  let batches: string[][] = [];
  const buf = BF.make((batch: string[]) => { batches.push(batch); }, "io");

  buf("a");
  buf("b");

  await new Promise((r) => setImmediate(r));
  // May need another tick
  await new Promise((r) => setTimeout(r, 5));

  assert.ok(batches.length >= 1);
  assert.ok(batches.flat().includes("a"));
  assert.ok(batches.flat().includes("b"));
});

// ============================================================================
// TimedFunction (throttle/debounce — timer-based)
// ============================================================================

test("TimedFunction: throttle fires immediately, blocks until window", async () => {
  const TF = await import("../TimedFunction.js");

  let calls: number[] = [];
  const throttled = TF.throttle((n: number) => { calls.push(n); }, 50);

  throttled(1); // fires immediately
  throttled(2); // dropped (within window)
  throttled(3); // dropped

  assert.deepEqual(calls, [1]);

  await new Promise((r) => setTimeout(r, 60));

  throttled(4); // fires (window expired)
  assert.deepEqual(calls, [1, 4]);
});

test("TimedFunction: debounce fires after silence", async () => {
  const TF = await import("../TimedFunction.js");

  let calls: number[] = [];
  const debounced = TF.debounce((n: number) => { calls.push(n); }, 30);

  debounced(1);
  debounced(2);
  debounced(3); // only this should fire (after 30ms of silence)

  assert.deepEqual(calls, []); // nothing yet

  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(calls, [3]);
});

// ============================================================================
// PromiseUtils (props, propsMap)
// ============================================================================

test("PromiseUtils: props resolves record of promises", async () => {
  const PU = await import("../PromiseUtils.js");

  const result = await PU.props({
    a: Promise.resolve(1),
    b: Promise.resolve("hello"),
    c: Promise.resolve(true),
  });

  assert.equal(result.a, 1);
  assert.equal(result.b, "hello");
  assert.equal(result.c, true);
});

test("PromiseUtils: props with immediate values", async () => {
  const PU = await import("../PromiseUtils.js");

  // Non-promise values should pass through
  const result = await PU.props({ x: 42, y: "hi" });
  assert.equal(result.x, 42);
  assert.equal(result.y, "hi");
});

test("PromiseUtils: props rejects if any promise rejects", async () => {
  const PU = await import("../PromiseUtils.js");

  await assert.rejects(
    () => PU.props({ a: Promise.resolve(1), b: Promise.reject("fail") }),
  );
});

test("PromiseUtils: propsMap resolves map of promises", async () => {
  const PU = await import("../PromiseUtils.js");

  const input = new Map<string, Promise<number>>([
    ["a", Promise.resolve(1)],
    ["b", Promise.resolve(2)],
    ["c", Promise.resolve(3)],
  ]);

  const result = await PU.propsMap(input);
  assert.equal(result.get("a"), 1);
  assert.equal(result.get("b"), 2);
  assert.equal(result.get("c"), 3);
  assert.equal(result.size, 3);
});

test("PromiseUtils: propsMap with empty map", async () => {
  const PU = await import("../PromiseUtils.js");
  const result = await PU.propsMap(new Map());
  assert.equal(result.size, 0);
});

// ============================================================================
// PRNG
// ============================================================================

test("PRNG: deterministic — same seed produces same sequence", async () => {
  const P = await import("../PRNG.js");

  Prop.assert(Arb.bigint(0n, 0xffff_ffff_ffff_ffffn), (rawSeed) => {
    const s = P.seed(rawSeed);
    const rng1 = P.make(s);
    const rng2 = P.make(s);

    for (let i = 0; i < 100; i++) {
      if (P.next(rng1) !== P.next(rng2)) return false;
    }
    return true;
  }, { numRuns: 500 });
});

test("PRNG: next() always in [0, 1)", async () => {
  const P = await import("../PRNG.js");

  Prop.assert(Arb.bigint(0n, 0xffff_ffff_ffff_ffffn), (rawSeed) => {
    const rng = P.make(P.seed(rawSeed));
    for (let i = 0; i < 100; i++) {
      const v = P.next(rng);
      if (v < 0 || v >= 1) return false;
    }
    return true;
  }, { numRuns: 1000 });
});

test("PRNG: nextInt() always in [min, max]", async () => {
  const P = await import("../PRNG.js");

  Prop.assert(
    Arb.tuple(Arb.bigint(0n, 0xffff_ffffn), Arb.integer(-100, 100), Arb.integer(1, 200)),
    ([rawSeed, min, range]) => {
      const max = min + range;
      const rng = P.make(P.seed(rawSeed));
      for (let i = 0; i < 50; i++) {
        const v = P.nextInt(rng, min, max);
        if (v < min || v > max) return false;
        if (v !== Math.floor(v)) return false;
      }
      return true;
    },
    { numRuns: 2000 },
  );
});

test("PRNG: split() produces independent streams", async () => {
  const P = await import("../PRNG.js");

  Prop.assert(Arb.bigint(0n, 0xffff_ffff_ffff_ffffn), (rawSeed) => {
    const rng = P.make(P.seed(rawSeed));
    const fork = P.split(rng);

    // After split, both should diverge
    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(P.next(rng));
      seq2.push(P.next(fork));
    }

    // Sequences should differ (extremely unlikely to be identical for 20 values)
    let allSame = true;
    for (let i = 0; i < seq1.length; i++) {
      if (seq1[i] !== seq2[i]) { allSame = false; break; }
    }
    return !allSame;
  }, { numRuns: 500 });
});

// ============================================================================
// FunctionUtils (pipe, partial, branded types)
// ============================================================================

test("FunctionUtils: pipe composes left-to-right", async () => {
  const FU = await import("../FunctionUtils.js");

  Prop.assert(Arb.integer(-1000, 1000), (n) => {
    const double = (x: number) => x * 2;
    const inc = (x: number) => x + 1;
    const neg = (x: number) => -x;

    // pipe(2): double then inc
    const p2 = FU.pipe(double, inc);
    if (p2(n) !== n * 2 + 1) return false;

    // pipe(3): double then inc then neg
    const p3 = FU.pipe(double, inc, neg);
    if (p3(n) !== -(n * 2 + 1)) return false;

    // pipe(1): identity wrapper
    const p1 = FU.pipe(double);
    if (p1(n) !== n * 2) return false;

    return true;
  }, { numRuns: 2000 });
});

test("FunctionUtils: pipe with 4 and 5 functions", async () => {
  const FU = await import("../FunctionUtils.js");

  const add1 = (x: number) => x + 1;
  const mul2 = (x: number) => x * 2;
  const sub3 = (x: number) => x - 3;
  const abs = (x: number) => Math.abs(x);
  const str = (x: number) => String(x);

  Prop.assert(Arb.integer(-100, 100), (n) => {
    const p4 = FU.pipe(add1, mul2, sub3, abs);
    if (p4(n) !== Math.abs((n + 1) * 2 - 3)) return false;

    const p5 = FU.pipe(add1, mul2, sub3, abs, str);
    if (p5(n) !== String(Math.abs((n + 1) * 2 - 3))) return false;

    return true;
  }, { numRuns: 2000 });
});

test("FunctionUtils: pipe variadic (>5 functions)", async () => {
  const FU = await import("../FunctionUtils.js");

  const fns = [
    (x: number) => x + 1,
    (x: number) => x * 2,
    (x: number) => x - 3,
    (x: number) => x * x,
    (x: number) => x + 10,
    (x: number) => x / 2,
  ];

  const piped = FU.pipe(...fns);

  Prop.assert(Arb.integer(-10, 10), (n) => {
    let expected = n;
    for (const f of fns) expected = f(expected);
    return piped(n) === expected;
  }, { numRuns: 1000 });
});

test("FunctionUtils: branded number validators", async () => {
  const FU = await import("../FunctionUtils.js");

  // positiveNumber
  assert.throws(() => FU.positiveNumber(0), RangeError);
  assert.throws(() => FU.positiveNumber(-1), RangeError);
  assert.throws(() => FU.positiveNumber(NaN), RangeError);
  FU.positiveNumber(0.001); // should not throw

  // integer
  assert.throws(() => FU.integer(1.5), RangeError);
  assert.throws(() => FU.integer(NaN), RangeError);
  assert.throws(() => FU.integer(Infinity), RangeError);
  FU.integer(0); // ok
  FU.integer(-42); // ok

  // positiveInteger
  assert.throws(() => FU.positiveInteger(0), RangeError);
  assert.throws(() => FU.positiveInteger(-1), RangeError);
  assert.throws(() => FU.positiveInteger(1.5), RangeError);
  FU.positiveInteger(1); // ok

  // nonNegativeInteger
  assert.throws(() => FU.nonNegativeInteger(-1), RangeError);
  assert.throws(() => FU.nonNegativeInteger(1.5), RangeError);
  FU.nonNegativeInteger(0); // ok
});

test("FunctionUtils: partial application", async () => {
  const FU = await import("../FunctionUtils.js");

  const add = (a: number, b: number) => a + b;
  const add5 = FU.partial(add, 5);

  Prop.assert(Arb.integer(-1000, 1000), (n) => {
    return add5(n) === 5 + n;
  }, { numRuns: 2000 });
});

test("FunctionUtils: tuple and tupled round-trip", async () => {
  const FU = await import("../FunctionUtils.js");

  Prop.assert(Arb.tuple(Arb.integer(), Arb.string({ maxLength: 5 }), Arb.boolean()), ([a, b, c]) => {
    const t = FU.tuple(a, b, c);
    if (t[0] !== a || t[1] !== b || t[2] !== c) return false;

    const add = (x: number, y: number) => x + y;
    const tupledAdd = FU.tupled(add);
    if (tupledAdd([3, 4]) !== 7) return false;

    const spreadAdd = FU.spread(tupledAdd);
    if (spreadAdd(3, 4) !== 7) return false;

    return true;
  }, { numRuns: 1000 });
});

// ============================================================================
// UUID
// ============================================================================

test("UUID: v4() produces valid UUIDs", async () => {
  const UUID = await import("../UUID.js");

  for (let i = 0; i < 100; i++) {
    const id = UUID.v4();
    // Should not throw when re-validated
    UUID.uuid(id as string);
    assert.equal(UUID.version(id), 4);
  }
});

test("UUID: uuid() rejects invalid strings", async () => {
  const UUID = await import("../UUID.js");

  const invalid = [
    "", "not-a-uuid", "12345678-1234-1234-1234-123456789012",  // wrong variant
    "ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ",
    "12345678-1234-1234-0234-123456789012",  // variant bits wrong (0 not 8-b)
  ];

  for (const s of invalid) {
    assert.throws(() => UUID.uuid(s), RangeError);
  }
});

// ============================================================================
// ISOTimestamp
// ============================================================================

test("ISOTimestamp: now() produces valid timestamp", async () => {
  const ISO = await import("../ISOTimestamp.js");

  const ts = ISO.now();
  // Should be parseable by Date
  const date = ISO.toDate(ts);
  assert.ok(!isNaN(date.getTime()));

  // Round-trip
  const back = ISO.fromDate(date);
  assert.equal(typeof back, "string");
});

test("ISOTimestamp: fromDate/toDate round-trip", async () => {
  const ISO = await import("../ISOTimestamp.js");

  Prop.assert(
    // Generate epoch ms in reasonable range (year 2000-2030)
    Arb.integer(946684800000, 1893456000000),
    (epochMs) => {
      const date = new Date(epochMs);
      const ts = ISO.fromDate(date);
      const back = ISO.toDate(ts);
      // Millisecond precision
      return Math.abs(back.getTime() - date.getTime()) < 1;
    },
    { numRuns: 2000 },
  );
});

test("ISOTimestamp: rejects invalid strings", async () => {
  const ISO = await import("../ISOTimestamp.js");

  const invalid = ["", "not-a-date", "2024-99-99T00:00:00Z", "Tuesday"];
  for (const s of invalid) {
    assert.throws(() => ISO.isoTimestamp(s));
  }
});

// ============================================================================
// UnixTimestamp
// ============================================================================

test("UnixTimestamp: fromDate/toDate round-trip", async () => {
  const UT = await import("../UnixTimestamp.js");

  Prop.assert(
    Arb.integer(0, 2000000000),
    (epochSec) => {
      const ts = UT.unixTimestamp(epochSec);
      const date = UT.toDate(ts);
      const back = UT.fromDate(date);
      return back === epochSec;
    },
    { numRuns: 2000 },
  );
});

test("UnixTimestamp: rejects non-finite values", async () => {
  const UT = await import("../UnixTimestamp.js");

  assert.throws(() => UT.unixTimestamp(NaN), RangeError);
  assert.throws(() => UT.unixTimestamp(Infinity), RangeError);
  assert.throws(() => UT.unixTimestamp(-Infinity), RangeError);

  // Finite values should work (including negative for pre-epoch)
  UT.unixTimestamp(0);
  UT.unixTimestamp(-1000);
  UT.unixTimestamp(2000000000);
});

test("UnixTimestamp: now() returns current time", async () => {
  const UT = await import("../UnixTimestamp.js");

  const before = Math.floor(Date.now() / 1000);
  const ts = UT.now();
  const after = Math.floor(Date.now() / 1000);

  assert.ok(ts >= before && ts <= after);
});
