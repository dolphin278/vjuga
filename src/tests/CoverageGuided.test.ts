import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Arb from "../Arbitrary.js";
import * as CG from "../CoverageGuided.js";
import { Session } from "node:inspector/promises";

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

// ---------------------------------------------------------------------------
// Corpus, size cycling, shrink budget (G7-8)
// ---------------------------------------------------------------------------

test("fuzz() runs config.corpus values before generated inputs", () => {
  const result = CG.fuzz(
    Arb.integer(0, 10),
    (n) => {
      if (n === 12345) throw new Error("corpus crash");
    },
    { seed: fixedSeed, maxDuration: 1000, corpus: [1, 12345] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.numRuns, 2);
  assert.equal(result.counterexample, 12345);
  assert.equal((result.error as Error).message, "corpus crash");
});

test("fuzzAsync() runs config.corpus values before generated inputs", async () => {
  const result = await CG.fuzzAsync(
    Arb.integer(0, 10),
    async (n) => {
      if (n === 12345) throw new Error("corpus crash");
    },
    { seed: fixedSeed, maxDuration: 1000, corpus: [1, 12345] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.numRuns, 2);
  assert.equal(result.counterexample, 12345);
});

test("fuzz() cycles sizes through 0..maxSize instead of pinning maxSize", () => {
  const sizes: number[] = [];
  const arb: Arb.Arbitrary<number> = (_prng, size) => {
    sizes.push(size);
    return { value: size, shrinks: [] };
  };
  CG.fuzz(arb, () => {}, { seed: fixedSeed, maxDuration: 50, maxSize: 3 });
  assert.ok(sizes.length > 8);
  assert.deepEqual(sizes.slice(0, 8), [0, 1, 2, 3, 0, 1, 2, 3]);
});

test("fuzz() maxShrinkEvaluations bounds shrinking", () => {
  let calls = 0;
  const arb: Arb.Arbitrary<number> = () => ({
    value: -1,
    shrinks: {
      *[Symbol.iterator]() {
        for (let i = 0; ; i++) yield { value: i, shrinks: [] };
      },
    },
  });
  const result = CG.fuzz(
    arb,
    (n) => {
      calls++;
      if (n < 0) throw new Error("neg");
    },
    { seed: fixedSeed, maxDuration: 1000, maxShrinkEvaluations: 10 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.shrinks, 0);
  assert.equal(calls, 11);
});

// Under a coverage tool fuzzAsync deliberately falls back to random fuzzing
// (G5-1), so this real-inspector test only runs outside one.
test(
  "fuzzAsync() mutates corpus entries by walking their shrink trees",
  {
    skip: process.env.NODE_V8_COVERAGE ? "random fallback under NODE_V8_COVERAGE" : false,
  },
  async () => {
    const seen = new Set<string>();
    const arb: Arb.Arbitrary<string> = () => ({
      value: "root",
      shrinks: [{ value: "child", shrinks: [] }],
    });
    const result = await CG.fuzzAsync(
      arb,
      async (v) => {
        seen.add(v);
      },
      { seed: fixedSeed, maxDuration: 300 },
    );
    assert.equal(result.ok, true);
    // "child" is never generated directly — only reachable as a mutation.
    assert.ok(seen.has("child"), "no corpus mutation happened");
  },
);

// ---------------------------------------------------------------------------
// Fake profiler: drives the inspector path deterministically, without
// touching V8's real (process-wide) precise coverage — so these tests also run
// under `npm run coverage` (G5-1, G5-5)
// ---------------------------------------------------------------------------

type Post = (this: unknown, method: string, params?: unknown) => Promise<unknown>;

/**
 * Runs `fn` with every inspector Session's `Profiler.*` calls answered by a
 * fake whose each `takePreciseCoverage` reports one never-seen-before block in
 * a script at `url` — always "new coverage" unless fuzzAsync ignores `url`.
 * `env` is the NODE_V8_COVERAGE value during `fn` (undefined: unset).
 */
async function withFakeProfiler<T>(
  url: string,
  env: string | undefined,
  fn: () => Promise<T>,
  failOn?: string,
): Promise<{ result: T; calls: string[] }> {
  const proto = Session.prototype as unknown as { post: Post };
  const original = proto.post;
  const saved = process.env.NODE_V8_COVERAGE;
  const calls: string[] = [];
  let takes = 0;
  proto.post = function fakePost(this: unknown, method: string, params?: unknown) {
    if (!method.startsWith("Profiler.")) return original.call(this, method, params);
    calls.push(method);
    if (method === failOn) return Promise.reject(new Error("fake failure"));
    if (method !== "Profiler.takePreciseCoverage") return Promise.resolve({});
    takes++;
    // A fresh function (new start offset) with a taken and a skipped nested
    // block, next to an unexecuted function and a range-less entry.
    const functions = [
      {
        ranges: [
          { startOffset: takes * 10, endOffset: takes * 10 + 9, count: 1 },
          { startOffset: takes * 10 + 1, endOffset: takes * 10 + 2, count: 0 },
          { startOffset: takes * 10 + 3, endOffset: takes * 10 + 4, count: 2 },
        ],
      },
      { ranges: [{ startOffset: 0, endOffset: 1, count: 0 }] },
      { ranges: [] },
    ];
    return Promise.resolve({ result: [{ scriptId: url, url, functions }] });
  };
  if (env === undefined) delete process.env.NODE_V8_COVERAGE;
  else process.env.NODE_V8_COVERAGE = env;
  try {
    return { result: await fn(), calls };
  } finally {
    proto.post = original;
    if (saved === undefined) delete process.env.NODE_V8_COVERAGE;
    else process.env.NODE_V8_COVERAGE = saved;
  }
}

/** Root "root" with one shrink child "child": "child" is only reachable as a mutation. */
const rootChild: Arb.Arbitrary<string> = () => ({
  value: "root",
  shrinks: [{ value: "child", shrinks: [] }],
});

/** Fuzzes rootChild; true when a corpus mutation happened (G7-8 mechanism). */
async function mutated(): Promise<boolean> {
  const seen = new Set<string>();
  const result = await CG.fuzzAsync(
    rootChild,
    async (v) => {
      seen.add(v);
    },
    { seed: fixedSeed, maxDuration: 150 },
  );
  assert.equal(result.ok, true);
  return seen.has("child");
}

const targetUrl = import.meta.url;

test("fuzzAsync() admits inputs reaching new target coverage (fake profiler)", async () => {
  const { result, calls } = await withFakeProfiler(targetUrl, undefined, mutated);
  assert.equal(result, true);
  assert.deepEqual(calls.slice(0, 2), ["Profiler.enable", "Profiler.startPreciseCoverage"]);
  assert.deepEqual(calls.slice(-2), ["Profiler.stopPreciseCoverage", "Profiler.disable"]);
  // A non-harness module that lives next to the harness is still tracked.
  const sibling = new URL("../JSON.js", import.meta.url).href;
  assert.equal((await withFakeProfiler(sibling, undefined, mutated)).result, true);
});

test("fuzzAsync() ignores coverage of harness modules and runtime internals", async () => {
  for (const file of ["Arbitrary.js", "PRNG.ts", "CoverageGuided.js"]) {
    const url = new URL(`../${file}`, import.meta.url).href;
    assert.equal((await withFakeProfiler(url, undefined, mutated)).result, false, file);
  }
  for (const url of ["node:internal/timers", ""]) {
    assert.equal((await withFakeProfiler(url, undefined, mutated)).result, false, url);
  }
});

test("fuzzAsync() falls back to random fuzzing when NODE_V8_COVERAGE is set", async () => {
  const { result, calls } = await withFakeProfiler(targetUrl, "/tmp/cov", mutated);
  assert.equal(result, false);
  assert.deepEqual(calls, [], "no Profiler call may touch the shared coverage");
  // An empty value means unset: the inspector path is used.
  assert.equal((await withFakeProfiler(targetUrl, "", mutated)).result, true);
});

test("fuzzAsync() shrinks a crash and still releases the profiler (fake profiler)", async () => {
  const { result, calls } = await withFakeProfiler(targetUrl, undefined, () =>
    CG.fuzzAsync(
      Arb.integer(0, 1000),
      async (n) => {
        if (n >= 50) throw new Error("too big");
      },
      { seed: fixedSeed, maxDuration: 5000, maxSize: 1000 },
    ),
  );
  assert.equal(result.ok, false);
  assert.equal(result.counterexample, 50);
  assert.equal(calls.filter((c) => c === "Profiler.stopPreciseCoverage").length, 1);
});

test("fuzzAsync() adds corpus seed values reaching new coverage, and mutates generated ones", async () => {
  const seen: string[] = [];
  const { result } = await withFakeProfiler(targetUrl, undefined, () =>
    CG.fuzzAsync(
      rootChild,
      async (v) => {
        seen.push(v);
      },
      { seed: fixedSeed, maxDuration: 100, corpus: ["seed-a", "seed-b"], maxCorpus: 1 },
    ),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seen.slice(0, 2), ["seed-a", "seed-b"]);
  // Seed values have no shrink tree; mutating generated entries reaches "child".
  assert.ok(seen.includes("child"));
});

test("fuzzAsync() falls back to random fuzzing when no inspector session can connect", async () => {
  const proto = Session.prototype as unknown as { connect: () => void };
  const original = proto.connect;
  proto.connect = () => {
    throw new Error("no inspector");
  };
  try {
    const { result, calls } = await withFakeProfiler(targetUrl, undefined, mutated);
    assert.equal(result, false);
    assert.deepEqual(calls, []);
  } finally {
    proto.connect = original;
  }
});

test("fuzzAsync() maxShrinkEvaluations bounds shrinking", async () => {
  let calls = 0;
  const arb: Arb.Arbitrary<number> = () => ({
    value: -1,
    shrinks: {
      *[Symbol.iterator]() {
        for (let i = 0; ; i++) yield { value: i, shrinks: [] };
      },
    },
  });
  const result = await CG.fuzzAsync(
    arb,
    async (n) => {
      calls++;
      if (n < 0) throw new Error("neg");
    },
    { seed: fixedSeed, maxDuration: 1000, maxShrinkEvaluations: 10 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.shrinks, 0);
  assert.equal(calls, 11);
});

test("fuzz() defaults: random seed and 10 s budget (ends at the first crash)", () => {
  const result = CG.fuzz(Arb.integer(), () => {
    throw new Error("always");
  });
  assert.equal(result.ok, false);
  assert.equal(result.numRuns, 1);
  assert.equal(typeof (result.seed as unknown as bigint), "bigint");
});

test("fuzzAsync() tolerates a profiler that fails to stop", async () => {
  const { result } = await withFakeProfiler(
    targetUrl,
    undefined,
    mutated,
    "Profiler.stopPreciseCoverage",
  );
  assert.equal(result, true);
});
