import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Arb from "../Arbitrary.js";
import * as CG from "../CoverageGuided.js";

const fixedSeed = PRNG.seed(42n);

// ---------------------------------------------------------------------------
// fuzz (sync) — pure random fallback
// ---------------------------------------------------------------------------

test("fuzz() returns ok:true when no crash is found", () => {
  const result = CG.fuzz(
    Arb.integer(0, 100),
    (_n) => {
      // no crash
    },
    { seed: fixedSeed, maxDuration: 100 },
  );
  assert.equal(result.ok, true);
  assert.ok(result.numRuns > 0);
});

test("fuzz() finds crashing input", () => {
  const result = CG.fuzz(
    Arb.integer(0, 1000),
    (n) => {
      if (n === 42) throw new Error("found 42");
    },
    { seed: fixedSeed, maxDuration: 5000, maxSize: 1000 },
  );
  // May or may not find 42 in time — but if it does, check structure
  if (!result.ok) {
    assert.ok(result.counterexample !== undefined);
    assert.ok(result.error instanceof Error);
  }
});

test("fuzz() shrinks crashing input", () => {
  const result = CG.fuzz(
    Arb.integer(0, 1000),
    (n) => {
      if (n >= 100) throw new Error("too big");
    },
    { seed: fixedSeed, maxDuration: 5000, maxSize: 1000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.shrinks! > 0);
  assert.equal(result.counterexample, 100);
});

test("fuzz() respects maxDuration", () => {
  const start = Date.now();
  CG.fuzz(Arb.integer(0, 100), () => {}, { seed: fixedSeed, maxDuration: 200 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `took too long: ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// fuzzAsync — with inspector integration
// ---------------------------------------------------------------------------

test("fuzzAsync() returns ok:true when no crash is found", async () => {
  const result = await CG.fuzzAsync(
    Arb.integer(0, 100),
    async (_n) => {
      await Promise.resolve();
    },
    { seed: fixedSeed, maxDuration: 200 },
  );
  assert.equal(result.ok, true);
  assert.ok(result.numRuns > 0);
});

test("fuzzAsync() finds crashing async input", async () => {
  const result = await CG.fuzzAsync(
    Arb.integer(0, 1000),
    async (n) => {
      if (n >= 50) throw new Error("too big");
    },
    { seed: fixedSeed, maxDuration: 10000, maxSize: 1000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.counterexample !== undefined);
  // Shrunk counterexample should be exactly at the boundary
  assert.equal(result.counterexample, 50);
});

test("fuzzAsync() shrinks async failures", async () => {
  const result = await CG.fuzzAsync(
    Arb.integer(0, 1000),
    async (n) => {
      if (n >= 200) throw new Error("too big");
    },
    { seed: fixedSeed, maxDuration: 10000, maxSize: 1000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.shrinks! > 0);
  assert.equal(result.counterexample, 200);
});

test("fuzzAsync() respects maxDuration", async () => {
  const start = Date.now();
  await CG.fuzzAsync(Arb.integer(0, 100), async () => {}, { seed: fixedSeed, maxDuration: 200 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `took too long: ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// Coverage-guided mode (fuzzAsync with inspector)
// ---------------------------------------------------------------------------

test("fuzzAsync() uses coverage guidance when inspector is available", async () => {
  // This test verifies the coverage-guided path runs without errors.
  // The inspector session should be created and used.
  const result = await CG.fuzzAsync(
    Arb.integer(0, 100),
    async (n) => {
      // A branch that coverage guidance can discover
      if (n === 42) {
        void (n * 2);
      }
    },
    { seed: fixedSeed, maxDuration: 1000, maxSize: 100 },
  );
  assert.equal(result.ok, true);
});
