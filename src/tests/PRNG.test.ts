import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";

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
