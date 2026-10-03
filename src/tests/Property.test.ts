/* c8 ignore start -- test file */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";

const fixedSeed = PRNG.seed(42n);

// ---------------------------------------------------------------------------
// check — sync
// ---------------------------------------------------------------------------

test("check() returns ok:true for valid properties", () => {
  const result = Prop.check(Arb.integer(0, 100), (n) => n >= 0, { seed: fixedSeed, numRuns: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.numRuns, 50);
});

test("check() finds counterexample for invalid properties", () => {
  const result = Prop.check(Arb.integer(0, 1000), (n) => n < 50, {
    seed: fixedSeed,
    numRuns: 200,
    maxSize: 1000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.counterexample !== undefined);
  assert.ok(
    result.counterexample! >= 50,
    `counterexample ${result.counterexample} should be >= 50`,
  );
});

test("check() shrinks counterexample to minimal value", () => {
  const result = Prop.check(Arb.integer(0, 1000), (n) => n < 100, {
    seed: fixedSeed,
    numRuns: 200,
    maxSize: 1000,
  });
  assert.equal(result.ok, false);
  // Should shrink to exactly 100 (the boundary)
  assert.equal(result.counterexample, 100);
});

test("check() catches thrown errors", () => {
  const result = Prop.check(
    Arb.integer(0, 100),
    (n) => {
      if (n > 50) throw new Error("too big");
    },
    { seed: fixedSeed, numRuns: 200, maxSize: 200 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
});

test("check() seed reproducibility", () => {
  const seed = PRNG.seed(123n);
  const arb = Arb.integer(0, 1000);
  const pred = (n: number) => n < 500;

  const r1 = Prop.check(arb, pred, { seed, numRuns: 200, maxSize: 1000 });
  const r2 = Prop.check(arb, pred, { seed, numRuns: 200, maxSize: 1000 });

  assert.equal(r1.ok, r2.ok);
  assert.equal(r1.numRuns, r2.numRuns);
  assert.deepEqual(r1.counterexample, r2.counterexample);
  assert.equal(r1.path, r2.path);
});

test("check() returns path for replay", () => {
  const result = Prop.check(Arb.integer(0, 1000), (n) => n < 100, {
    seed: fixedSeed,
    numRuns: 200,
    maxSize: 1000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.path !== undefined);
  assert.ok(typeof result.path === "string");
  assert.ok(result.path!.length > 0);
});

test("check() path replay reproduces exact counterexample", () => {
  const seed = PRNG.seed(77n);
  const arb = Arb.integer(0, 1000);
  const pred = (n: number) => n < 100;

  const original = Prop.check(arb, pred, { seed, numRuns: 200, maxSize: 1000 });
  assert.equal(original.ok, false);

  // Replay with same seed, numRuns, and path
  const replay = Prop.check(arb, pred, { seed, numRuns: 200, maxSize: 1000, path: original.path });
  assert.equal(replay.ok, false);
  assert.equal(replay.counterexample, original.counterexample);
});

test("check() with numRuns: 1", () => {
  const result = Prop.check(Arb.constant(42), (n) => n === 42, { numRuns: 1, seed: fixedSeed });
  assert.equal(result.ok, true);
  assert.equal(result.numRuns, 1);
});

// ---------------------------------------------------------------------------
// assert — sync
// ---------------------------------------------------------------------------

test("assert() does not throw on valid property", () => {
  Prop.assert(Arb.integer(0, 100), (n) => n >= 0, { seed: fixedSeed, numRuns: 50 });
});

test("assert() throws on invalid property with readable message", () => {
  assert.throws(
    () =>
      Prop.assert(Arb.integer(0, 1000), (n) => n < 100, {
        seed: fixedSeed,
        numRuns: 200,
        maxSize: 1000,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("Property check failed!"));
      assert.ok(err.message.includes("Counterexample:"));
      assert.ok(err.message.includes("Seed:"));
      assert.ok(err.message.includes("Replay:"));
      return true;
    },
  );
});

test("assert() includes error message in output", () => {
  assert.throws(
    () =>
      Prop.assert(
        Arb.integer(0, 100),
        (n) => {
          if (n > 50) throw new Error("custom error");
        },
        { seed: fixedSeed, numRuns: 200, maxSize: 200 },
      ),
    (err: Error) => {
      assert.ok(err.message.includes("Error:"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// checkAsync / assertAsync
// ---------------------------------------------------------------------------

test("checkAsync() handles async predicates", async () => {
  const result = await Prop.checkAsync(
    Arb.integer(0, 100),
    async (n) => {
      await Promise.resolve();
      return n >= 0;
    },
    { seed: fixedSeed, numRuns: 50 },
  );
  assert.equal(result.ok, true);
});

test("checkAsync() finds counterexample in async predicate", async () => {
  const result = await Prop.checkAsync(
    Arb.integer(0, 1000),
    async (n) => {
      await Promise.resolve();
      return n < 100;
    },
    { seed: fixedSeed, numRuns: 200, maxSize: 1000 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.counterexample, 100);
});

test("checkAsync() shrinks async failures", async () => {
  const result = await Prop.checkAsync(
    Arb.integer(0, 1000),
    async (n) => {
      await Promise.resolve();
      if (n >= 100) throw new Error("too big");
    },
    { seed: fixedSeed, numRuns: 200, maxSize: 1000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.shrinks! > 0);
});

test("checkAsync() path replay", async () => {
  const seed = PRNG.seed(77n);
  const original = await Prop.checkAsync(Arb.integer(0, 1000), async (n) => n < 100, {
    seed,
    numRuns: 200,
    maxSize: 1000,
  });
  assert.equal(original.ok, false);

  const replay = await Prop.checkAsync(Arb.integer(0, 1000), async (n) => n < 100, {
    seed,
    numRuns: 200,
    maxSize: 1000,
    path: original.path,
  });
  assert.equal(replay.counterexample, original.counterexample);
});

test("assertAsync() does not throw on valid async property", async () => {
  await Prop.assertAsync(
    Arb.integer(0, 100),
    async (n) => {
      return n >= 0;
    },
    { seed: fixedSeed, numRuns: 50 },
  );
});

test("assertAsync() throws on invalid async property", async () => {
  await assert.rejects(
    () =>
      Prop.assertAsync(Arb.integer(0, 1000), async (n) => n < 100, {
        seed: fixedSeed,
        numRuns: 200,
        maxSize: 1000,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("Property check failed!"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// stringify coverage (via assert error messages)
// ---------------------------------------------------------------------------

test("assert() formats various types in error messages", () => {
  // Object counterexample
  assert.throws(
    () =>
      Prop.assert(Arb.record<{ n: number }>({ n: Arb.integer(0, 100) }), (obj) => obj.n < 5, {
        seed: fixedSeed,
        numRuns: 200,
        maxSize: 200,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("n:"));
      return true;
    },
  );

  // Array counterexample
  assert.throws(
    () =>
      Prop.assert(Arb.array(Arb.integer(0, 10), { minLength: 1 }), () => false, {
        seed: fixedSeed,
        numRuns: 1,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("["));
      return true;
    },
  );
});

test("assert() formats Map counterexample", () => {
  const mapArb = Arb.map(Arb.integer(0, 10), (n) => new Map([["key", n]]));
  assert.throws(
    () => Prop.assert(mapArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("Map("));
      return true;
    },
  );
});

test("assert() formats Set counterexample", () => {
  const setArb = Arb.map(Arb.integer(0, 10), (n) => new Set([n]));
  assert.throws(
    () => Prop.assert(setArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("Set("));
      return true;
    },
  );
});

test("assert() formats TypedArray counterexample", () => {
  const typedArb = Arb.map(Arb.integer(0, 10), (n) => new Uint8Array([n]));
  assert.throws(
    () => Prop.assert(typedArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("Uint8Array["));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// config: maxShrinks
// ---------------------------------------------------------------------------

test("assert() formats circular reference in counterexample", () => {
  const circularArb = Arb.map(Arb.integer(0, 10), (n) => {
    const obj: Record<string, unknown> = { n };
    obj.self = obj;
    return obj;
  });
  assert.throws(
    () => Prop.assert(circularArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("[Circular]"));
      return true;
    },
  );
});

test("assert() formats deeply nested counterexample", () => {
  const deepArb = Arb.map(Arb.integer(0, 10), (n) => ({
    a: { b: { c: { d: { e: n } } } },
  }));
  assert.throws(
    () => Prop.assert(deepArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("[...]"));
      return true;
    },
  );
});

test("assert() formats large array counterexample with truncation", () => {
  const largeArb = Arb.map(Arb.integer(0, 10), (n) => Array.from({ length: 25 }, (_, i) => i + n));
  assert.throws(
    () => Prop.assert(largeArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("... (5 more)"));
      return true;
    },
  );
});

test("assert() formats large Map counterexample with truncation", () => {
  const largeMapArb = Arb.map(Arb.integer(0, 10), () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 15; i++) m.set(`k${i}`, i);
    return m;
  });
  assert.throws(
    () => Prop.assert(largeMapArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("... (5 more)"));
      return true;
    },
  );
});

test("assert() formats large Set counterexample with truncation", () => {
  const largeSetArb = Arb.map(
    Arb.integer(0, 10),
    () => new Set(Array.from({ length: 15 }, (_, i) => i)),
  );
  assert.throws(
    () => Prop.assert(largeSetArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("... (5 more)"));
      return true;
    },
  );
});

test("assert() formats large TypedArray counterexample with truncation", () => {
  const largeTypedArb = Arb.map(Arb.integer(0, 10), () => new Uint8Array(15));
  assert.throws(
    () => Prop.assert(largeTypedArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("... (5 more)"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// timeoutMs
// ---------------------------------------------------------------------------

test("check() timeoutMs: stops before numRuns when deadline passes", () => {
  const result = Prop.check(Arb.integer(), () => true, { numRuns: 10_000_000, timeoutMs: 1 });
  assert.equal(result.ok, true);
  assert.ok(result.numRuns < 10_000_000, `should stop early, got ${result.numRuns}`);
});

test("check() timeoutMs: reports full numRuns when ample time", () => {
  const result = Prop.check(Arb.integer(), () => true, {
    numRuns: 50,
    timeoutMs: 30_000,
    seed: fixedSeed,
  });
  assert.equal(result.ok, true);
  assert.equal(result.numRuns, 50);
});

test("assert() formats Date, RegExp, Error, function, symbol, bigint, null, undefined", () => {
  // Test various types through stringify
  const types: Arb.Arbitrary<unknown>[] = [
    Arb.constant(null),
    Arb.constant(undefined),
    Arb.constant(42n),
    Arb.constant(Symbol("test")),
    /* c8 ignore next -- function value, not called */
    Arb.constant(() => {}),
    Arb.constant(new Date("2020-01-01")),
    Arb.constant(/abc/g),
    Arb.constant(new Error("test")),
  ];
  for (const arb of types) {
    assert.throws(() => Prop.assert(arb, () => false, { seed: fixedSeed, numRuns: 1 }), Error);
  }
});

test("assert() formats large object counterexample with truncation", () => {
  const largeObjArb = Arb.map(Arb.integer(0, 10), () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 25; i++) obj[`k${i}`] = i;
    return obj;
  });
  assert.throws(
    () => Prop.assert(largeObjArb, () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => {
      assert.ok(err.message.includes("... (5 more)"));
      return true;
    },
  );
});

test("check() failure with non-Error thrown value", () => {
  const result = Prop.check(
    Arb.integer(0, 100),
    (n) => {
      if (n > 50) throw "string error";
    },
    { seed: fixedSeed, numRuns: 200, maxSize: 200 },
  );
  assert.equal(result.ok, false);
});

test("assert() failure with non-Error thrown value includes it in message", () => {
  assert.throws(
    () =>
      Prop.assert(
        Arb.integer(0, 100),
        (n) => {
          if (n > 50) throw "string error";
        },
        { seed: fixedSeed, numRuns: 200, maxSize: 200 },
      ),
    (err: Error) => {
      assert.ok(err.message.includes("string error"));
      return true;
    },
  );
});

test("check() with no config uses defaults", () => {
  // Exercises the default config path (all ?? branches)
  const result = Prop.check(Arb.integer(0, 10), (n) => n >= 0);
  assert.equal(result.ok, true);
  assert.equal(result.numRuns, 100); // default
});

test("check() respects maxShrinks limit", () => {
  const result = Prop.check(Arb.integer(0, 100000), (n) => n < 1, {
    seed: fixedSeed,
    numRuns: 200,
    maxSize: 100000,
    maxShrinks: 3,
  });
  assert.equal(result.ok, false);
  assert.ok(result.shrinks! <= 3);
});

// ---------------------------------------------------------------------------
// Minimal counterexamples (G7-1) and termination (G7-2)
// ---------------------------------------------------------------------------

test("check() finds the true minimum for a two-integer property", () => {
  for (let s = 1n; s <= 20n; s++) {
    const r = Prop.check(
      Arb.tuple(Arb.integer(0, 100), Arb.integer(0, 100)),
      ([a, b]) => a - b < 20,
      {
        numRuns: 100,
        seed: PRNG.seed(s),
      },
    );
    if (!r.ok) assert.deepEqual(r.counterexample, [20, 0], `seed ${s}`);
  }
});

test("check() over dates in 2020-2030 terminates with a minimal counterexample", () => {
  const d0 = new Date("2020-01-01");
  const d1 = new Date("2030-01-01");
  const r = Prop.check(Arb.date(d0, d1), (d) => d.getTime() < d0.getTime() + 5, {
    numRuns: 100,
    seed: PRNG.seed(3n),
    maxShrinks: 50,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample!.getTime(), d0.getTime() + 5);
});

test("check() maxShrinkEvaluations bounds predicate calls during shrinking", () => {
  let calls = 0;
  // Root fails, every shrink candidate passes: only the budget stops the scan.
  const arb: Arb.Arbitrary<number> = () => ({
    value: -1,
    shrinks: {
      *[Symbol.iterator]() {
        for (let i = 0; ; i++) yield { value: i, shrinks: [] };
      },
    },
  });
  const r = Prop.check(
    arb,
    (x) => {
      calls++;
      return x >= 0;
    },
    { numRuns: 1, seed: fixedSeed, maxShrinkEvaluations: 25 },
  );
  assert.equal(r.ok, false);
  assert.equal(r.counterexample, -1);
  assert.equal(calls, 1 + 25);
});

test("check() timeoutMs also bounds shrinking", () => {
  let shrinkCalls = 0;
  const arb: Arb.Arbitrary<number> = () => ({
    value: -1,
    shrinks: {
      *[Symbol.iterator]() {
        for (let i = 0; ; i++) yield { value: i, shrinks: [] };
      },
    },
  });
  const r = Prop.check(
    arb,
    (x) => {
      if (x < 0) return false;
      shrinkCalls++;
      const until = Date.now() + 2;
      while (Date.now() < until) {
        // busy-wait so the deadline passes
      }
      return true;
    },
    { numRuns: 1, seed: fixedSeed, timeoutMs: 20 },
  );
  assert.equal(r.ok, false);
  assert.ok(shrinkCalls < 100, `shrinking ran ${shrinkCalls} evaluations past the deadline`);
});

// ---------------------------------------------------------------------------
// Reported error belongs to the reported counterexample (G7-11)
// ---------------------------------------------------------------------------

test("check() reports the error of the shrunk counterexample, not the root's", () => {
  const arb: Arb.Arbitrary<number> = () => ({ value: 100, shrinks: [{ value: 10, shrinks: [] }] });
  const r = Prop.check(
    arb,
    (x) => {
      if (x >= 50) throw new Error(`crash on ${x}`);
      return x < 5;
    },
    { numRuns: 1, seed: fixedSeed },
  );
  assert.equal(r.counterexample, 10);
  assert.equal(r.error, undefined);
});

test("check() keeps the root error when no shrink applies", () => {
  const r = Prop.check(
    Arb.constant(7),
    () => {
      throw new Error("always");
    },
    { numRuns: 1, seed: fixedSeed },
  );
  assert.equal((r.error as Error).message, "always");
});

// ---------------------------------------------------------------------------
// Path replay (G7-6)
// ---------------------------------------------------------------------------

test("check() path encodes size so the printed hint replays without numRuns", () => {
  const arb = Arb.array(Arb.integer(-1000, 1000));
  const pred = (xs: number[]) => xs.reduce((a, b) => a + b, 0) < 40;
  const r = Prop.check(arb, pred, { numRuns: 20, seed: PRNG.seed(11n) });
  assert.equal(r.ok, false);
  assert.match(r.path!, /^\d+@\d+(:\d+)*$/);
  // Replay exactly as printed by assert(): { seed, path } only.
  const replay = Prop.check(arb, pred, { seed: PRNG.seed(11n), path: r.path });
  assert.equal(replay.ok, false);
  assert.deepEqual(replay.counterexample, r.counterexample);
  assert.equal(replay.path, r.path);
  assert.equal(replay.numRuns, 1);
});

test("check() path replay evaluates the predicate (ok once fixed)", () => {
  const arb = Arb.integer(0, 1000);
  const r = Prop.check(arb, (n) => n < 10, { numRuns: 50, seed: fixedSeed });
  assert.equal(r.ok, false);
  const fixed = Prop.check(arb, () => true, { seed: fixedSeed, path: r.path });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.counterexample, undefined);
  const thrown = Prop.check(
    arb,
    (n) => {
      throw new Error(`still ${n}`);
    },
    { seed: fixedSeed, path: r.path },
  );
  assert.equal(thrown.ok, false);
  assert.equal((thrown.error as Error).message, `still ${r.counterexample}`);
});

test("check() accepts legacy paths without a size segment", () => {
  const arb = Arb.integer(0, 1000);
  const r = Prop.check(arb, (n) => n < 10, { numRuns: 50, seed: fixedSeed });
  const [head, ...rest] = r.path!.split(":");
  const legacy = [head!.split("@")[0], ...rest].join(":");
  const replay = Prop.check(arb, (n) => n < 10, { seed: fixedSeed, numRuns: 50, path: legacy });
  assert.equal(replay.counterexample, r.counterexample);
});

test("check() rejects malformed or diverging paths", () => {
  const arb = Arb.integer(0, 1000);
  assert.throws(() => Prop.check(arb, () => true, { seed: fixedSeed, path: "x" }), /invalid/);
  assert.throws(() => Prop.check(arb, () => true, { seed: fixedSeed, path: "1@2@3" }), /invalid/);
  assert.throws(() => Prop.check(arb, () => true, { seed: fixedSeed, path: "0@-1" }), /invalid/);
  assert.throws(
    () => Prop.check(Arb.constant(1), () => true, { seed: fixedSeed, path: "0@5:3" }),
    /diverged/,
  );
});

// ---------------------------------------------------------------------------
// Failure formatting (G5-7)
// ---------------------------------------------------------------------------

/** The counterexample line of the error thrown by `assert` for a failing constant. */
function counterexampleLine(value: unknown): string {
  try {
    Prop.assert(Arb.constant(value), () => false, { seed: fixedSeed, numRuns: 1 });
  } catch (e) {
    return (e as Error).message.split("\n")[1]!.replace("  Counterexample: ", "");
  }
  throw new Error("assert did not throw");
}

test("assert() reports an Invalid Date counterexample instead of throwing RangeError", () => {
  assert.equal(counterexampleLine(new Date(NaN)), "Date(Invalid)");
  assert.equal(counterexampleLine(new Date(0)), "Date(1970-01-01T00:00:00.000Z)");
});

test("assert() prints shared acyclic references in full and only cycles as [Circular]", () => {
  const a = { k: 1 };
  const d = new Date(0);
  assert.equal(counterexampleLine([a, a]), "[{k: 1}, {k: 1}]");
  assert.equal(counterexampleLine({ x: a, y: a }), "{x: {k: 1}, y: {k: 1}}");
  assert.equal(
    counterexampleLine(
      new Map([
        [1, a],
        [2, a],
      ]),
    ),
    "Map(1 => {k: 1}, 2 => {k: 1})",
  );
  assert.equal(counterexampleLine(new Set([[a], [a]])), "Set([{k: 1}], [{k: 1}])");
  assert.equal(
    counterexampleLine([d, d]),
    "[Date(1970-01-01T00:00:00.000Z), Date(1970-01-01T00:00:00.000Z)]",
  );
  const cyclic: unknown[] = [1];
  cyclic.push(cyclic);
  assert.equal(counterexampleLine(cyclic), "[1, [Circular]]");
});

test("assert() distinguishes -0 and bigint counterexamples", () => {
  assert.equal(counterexampleLine(-0), "-0");
  assert.equal(counterexampleLine(0), "0");
  assert.equal(counterexampleLine(5n), "5n");
  assert.equal(counterexampleLine([-0, 1n]), "[-0, 1n]");
});

test("assert() attaches the predicate's error as cause", () => {
  const boom = new Error("boom");
  assert.throws(
    () =>
      Prop.assert(
        Arb.constant(1),
        () => {
          throw boom;
        },
        { seed: fixedSeed, numRuns: 1 },
      ),
    (err: Error) => err.cause === boom && err.message.includes("Error: boom"),
  );
  assert.throws(
    () => Prop.assert(Arb.constant(1), () => false, { seed: fixedSeed, numRuns: 1 }),
    (err: Error) => !("cause" in err),
  );
});

// ---------------------------------------------------------------------------
// Promise-returning predicates in the sync runner (G5-10)
// ---------------------------------------------------------------------------

test("check() fails a Promise-returning predicate with a TypeError instead of passing", async () => {
  let unhandled = 0;
  const onUnhandled = (): void => {
    unhandled++;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const asyncPred = (async (_n: number) => {
      throw new Error("boom");
    }) as unknown as (n: number) => boolean;
    const r = Prop.check(Arb.integer(0, 10), asyncPred, { seed: fixedSeed, numRuns: 20 });
    assert.equal(r.ok, false);
    assert.equal(r.numRuns, 1);
    assert.ok(r.error instanceof TypeError);
    assert.match((r.error as Error).message, /returned a Promise; use checkAsync/);
    // A resolving promise and a bare thenable fail the same way.
    const resolving = (async () => true) as unknown as () => boolean;
    assert.equal(Prop.check(Arb.constant(1), resolving, { seed: fixedSeed }).ok, false);
    // eslint-disable-next-line unicorn/no-thenable -- a bare thenable is the case under test
    const thenable = (() => ({ then: () => {} })) as unknown as () => boolean;
    assert.equal(Prop.check(Arb.constant(1), thenable, { seed: fixedSeed }).ok, false);
    // Non-thenable objects and functions still count as passing.
    // eslint-disable-next-line unicorn/no-thenable -- non-callable then is not a thenable
    const obj = (() => ({ then: 1 })) as unknown as () => boolean;
    assert.equal(Prop.check(Arb.constant(1), obj, { seed: fixedSeed }).ok, true);
    const fn = (() => () => {}) as unknown as () => boolean;
    assert.equal(Prop.check(Arb.constant(1), fn, { seed: fixedSeed }).ok, true);
    const nul = (() => null) as unknown as () => boolean;
    assert.equal(Prop.check(Arb.constant(1), nul, { seed: fixedSeed }).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(unhandled, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
