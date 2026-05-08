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
  const result = Prop.check(
    Arb.integer(),
    () => true,
    { numRuns: 10_000_000, timeoutMs: 1 },
  );
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
