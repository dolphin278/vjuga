import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Ref from "./fixtures/PRNGReference.js";

// --- seed / make ---

test("seed() wraps bigint as branded Seed", () => {
  const s = PRNG.seed(42n);
  assert.equal(s as unknown as bigint, 42n);
});

test("seed() masks to 64 bits", () => {
  const large = (1n << 65n) + 7n;
  const s = PRNG.seed(large);
  // Only lower 64 bits should survive
  assert.equal(s as unknown as bigint, 7n);
});

test("make() creates a PRNG from a seed", () => {
  const rng = PRNG.make(PRNG.seed(0n));
  // Should be able to draw from it
  const v = PRNG.next(rng);
  assert.equal(typeof v, "number");
});

// --- determinism ---

test("same seed produces identical sequence", () => {
  const a = PRNG.make(PRNG.seed(123n));
  const b = PRNG.make(PRNG.seed(123n));
  for (let i = 0; i < 100; i++) {
    assert.equal(PRNG.next(a), PRNG.next(b));
  }
});

test("different seeds produce different sequences", () => {
  const a = PRNG.make(PRNG.seed(1n));
  const b = PRNG.make(PRNG.seed(2n));
  let same = 0;
  for (let i = 0; i < 100; i++) {
    /* c8 ignore next 3 -- statistically never true */
    if (PRNG.next(a) === PRNG.next(b)) same++;
  }
  // Extremely unlikely all 100 match
  assert.ok(same < 100);
});

// --- next() ---

test("next() returns values in [0, 1)", () => {
  const rng = PRNG.make(PRNG.seed(999n));
  for (let i = 0; i < 1000; i++) {
    const v = PRNG.next(rng);
    assert.ok(v >= 0, `expected >= 0, got ${v}`);
    assert.ok(v < 1, `expected < 1, got ${v}`);
  }
});

// --- nextInt() ---

test("nextInt() returns values in [min, max] inclusive", () => {
  const rng = PRNG.make(PRNG.seed(42n));
  for (let i = 0; i < 1000; i++) {
    const v = PRNG.nextInt(rng, 3, 7);
    assert.ok(v >= 3, `expected >= 3, got ${v}`);
    assert.ok(v <= 7, `expected <= 7, got ${v}`);
    assert.equal(v, Math.floor(v), "expected integer");
  }
});

test("nextInt() returns min when min === max", () => {
  const rng = PRNG.make(PRNG.seed(42n));
  for (let i = 0; i < 10; i++) {
    assert.equal(PRNG.nextInt(rng, 5, 5), 5);
  }
});

test("nextInt() handles negative ranges", () => {
  const rng = PRNG.make(PRNG.seed(77n));
  for (let i = 0; i < 100; i++) {
    const v = PRNG.nextInt(rng, -10, -5);
    assert.ok(v >= -10 && v <= -5, `out of range: ${v}`);
  }
});

// --- nextBigInt() ---

test("nextBigInt() returns a bigint", () => {
  const rng = PRNG.make(PRNG.seed(42n));
  const v = PRNG.nextBigInt(rng);
  assert.equal(typeof v, "bigint");
});

test("nextBigInt() returns values in unsigned 64-bit range", () => {
  const rng = PRNG.make(PRNG.seed(42n));
  for (let i = 0; i < 100; i++) {
    const v = PRNG.nextBigInt(rng);
    assert.ok(v >= 0n, `expected >= 0n, got ${v}`);
    assert.ok(v <= 0xffff_ffff_ffff_ffffn, `expected <= 2^64-1, got ${v}`);
  }
});

// --- split() ---

test("split() creates an independent sub-stream", () => {
  const rng = PRNG.make(PRNG.seed(42n));
  const fork = PRNG.split(rng);
  // The fork and original should produce different sequences
  let same = 0;
  for (let i = 0; i < 100; i++) {
    /* c8 ignore next 3 -- statistically never true */
    if (PRNG.next(rng) === PRNG.next(fork)) same++;
  }
  assert.ok(same < 100, "split streams should diverge");
});

test("split() is deterministic — same seed produces same fork", () => {
  const a = PRNG.make(PRNG.seed(42n));
  const b = PRNG.make(PRNG.seed(42n));
  const forkA = PRNG.split(a);
  const forkB = PRNG.split(b);
  for (let i = 0; i < 50; i++) {
    assert.equal(PRNG.next(forkA), PRNG.next(forkB));
  }
  // Original streams should also remain in sync
  for (let i = 0; i < 50; i++) {
    assert.equal(PRNG.next(a), PRNG.next(b));
  }
});

// --- randomSeed() ---

test("randomSeed() returns a Seed (branded bigint)", () => {
  const s = PRNG.randomSeed();
  assert.equal(typeof (s as unknown as bigint), "bigint");
});

test("randomSeed() produces different values on successive calls", () => {
  const a = PRNG.randomSeed();
  const b = PRNG.randomSeed();
  // Could theoretically collide, but 2^-64 probability
  assert.notEqual(a, b);
});

// --- zero seed edge case ---

test("seed(0n) produces a usable PRNG", () => {
  const rng = PRNG.make(PRNG.seed(0n));
  // Should not get stuck — all zeros doesn't deadlock SplitMix64
  const values = new Set<number>();
  for (let i = 0; i < 100; i++) {
    values.add(PRNG.next(rng));
  }
  assert.ok(values.size > 90, "zero-seed PRNG should not collapse");
});

// --- bit-identity with the reference BigInt SplitMix64 (G5-8) ---

/** Integer ranges (max - min + 1) at every reduction-path boundary. */
const ORACLE_RANGES = [
  2,
  3,
  95,
  2 ** 16,
  2 ** 21 - 1,
  2 ** 21,
  2 ** 21 + 1,
  2 ** 31,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  2 ** 37 - 1,
  2 ** 37,
  2 ** 37 + 1,
  2 ** 40,
  2 ** 52 + 3,
  2 ** 53 - 1,
  2 ** 53,
];

/** Runs one interleaved op chain on both implementations and compares. */
function compareChain(s: bigint, ops: number): void {
  let a = PRNG.make(PRNG.seed(s));
  let b = Ref.make(s & 0xffff_ffff_ffff_ffffn);
  const forksA: PRNG.PRNG[] = [];
  const forksB: Ref.RefPRNG[] = [];
  for (let i = 0; i < ops; i++) {
    const op = i % 9;
    if (op === 0) {
      forksA.push(PRNG.split(a));
      forksB.push(Ref.split(b));
    } else if (op === 1 && forksA.length > 0 && i % 2 === 1) {
      // Continue in a fork, so split children are exercised further.
      a = forksA.pop()!;
      b = forksB.pop()!;
    } else if (op === 2) {
      assert.equal(PRNG.nextBigInt(a), Ref.nextBigInt(b), `nextBigInt seed=${s} op=${i}`);
    } else if (op === 3) {
      assert.equal(PRNG.next(a), Ref.next(b), `next seed=${s} op=${i}`);
    } else {
      const range = ORACLE_RANGES[i % ORACLE_RANGES.length]!;
      const min = i % 2 === 0 ? -7 : 0;
      const max = min + range - 1;
      assert.equal(PRNG.nextInt(a, min, max), Ref.nextInt(b, min, max), `nextInt r=${range}`);
    }
  }
}

test("uint32 PRNG is bit-identical to the BigInt reference across seeds and op chains", () => {
  const seeds = [0n, 1n, 42n, 0xffff_ffff_ffff_ffffn, 0x8000_0000_0000_0000n, 0xffff_ffffn];
  const gen = Ref.make(12345n);
  for (let i = 0; i < 200; i++) seeds.push(Ref.nextBigInt(gen));
  for (const s of seeds) compareChain(s, 2000);
});

test("make() masks an unmasked or negative bigint cast to Seed like the reference", () => {
  for (const raw of [-1n, -12345n, (1n << 70n) + 99n]) {
    const a = PRNG.make(raw as PRNG.Seed);
    const b = Ref.make(raw);
    for (let i = 0; i < 20; i++) assert.equal(PRNG.nextBigInt(a), Ref.nextBigInt(b));
    assert.equal(PRNG.next(PRNG.split(a)), Ref.next(Ref.split(b)));
  }
});

test("nextInt() at every reduction boundary matches BigInt modulo on extreme outputs", () => {
  const outputs = [0n, 1n, 0xffff_ffff_ffff_ffffn, 0xffff_ffff_0000_0000n, 0x0000_0000_ffff_ffffn];
  for (const out of outputs) {
    for (const range of ORACLE_RANGES) {
      const s = Ref.seedForOutput(out);
      const got = PRNG.nextInt(PRNG.make(PRNG.seed(s)), 0, range - 1);
      assert.equal(got, Number(out % BigInt(range)), `out=${out} range=${range}`);
    }
  }
});

// --- nextInt() preconditions (G5-9) ---

test("nextInt() reaches an inclusive max of 2^53 (ranges above 2^53 reduce exactly)", () => {
  const s = Ref.seedForOutput(2n ** 53n);
  assert.equal(PRNG.nextInt(PRNG.make(PRNG.seed(s)), 0, 2 ** 53), 2 ** 53);
  const rng = PRNG.make(PRNG.seed(3n));
  for (let i = 0; i < 100; i++) {
    const v = PRNG.nextInt(rng, -(2 ** 60), 2 ** 60);
    assert.ok(v >= -(2 ** 60) && v <= 2 ** 60);
  }
});

test("nextInt() throws RangeError for fractional or non-finite bounds", () => {
  const rng = PRNG.make(PRNG.seed(1n));
  assert.throws(() => PRNG.nextInt(rng, 0, 2.5), {
    name: "RangeError",
    message: /nextInt: bounds must be integers/,
  });
  assert.throws(() => PRNG.nextInt(rng, 0, Infinity), RangeError);
  assert.throws(() => PRNG.nextInt(rng, NaN, 3), RangeError);
});

test("nextInt() returns min without drawing when max < min", () => {
  const a = PRNG.make(PRNG.seed(9n));
  const b = PRNG.make(PRNG.seed(9n));
  assert.equal(PRNG.nextInt(a, 5, 1), 5);
  assert.equal(PRNG.next(a), PRNG.next(b));
});
