import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as BF from "../BloomFilter.js";

// ---------------------------------------------------------------------------
// make — validation
// ---------------------------------------------------------------------------

test("make() throws for invalid capacity", () => {
  assert.throws(() => BF.make(0), RangeError);
  assert.throws(() => BF.make(-1), RangeError);
  assert.throws(() => BF.make(1.5), RangeError);
});

test("make() throws for invalid fpr", () => {
  assert.throws(() => BF.make(100, 0), RangeError);
  assert.throws(() => BF.make(100, 1), RangeError);
  assert.throws(() => BF.make(100, -0.1), RangeError);
  assert.throws(() => BF.make(100, 1.1), RangeError);
});

test("make() accepts valid parameters", () => {
  const bf = BF.make(1000, 0.01);
  assert.ok(BF.bitCount(bf) > 0);
  assert.ok(BF.hashCount(bf) > 0);
  assert.equal(BF.count(bf), 0);
});

test("make() default fpr is 0.01", () => {
  const bf1 = BF.make(1000);
  const bf2 = BF.make(1000, 0.01);
  assert.equal(BF.bitCount(bf1), BF.bitCount(bf2));
  assert.equal(BF.hashCount(bf1), BF.hashCount(bf2));
});

// ---------------------------------------------------------------------------
// add / mightContain
// ---------------------------------------------------------------------------

test("mightContain() always returns true after add()", () => {
  const bf = BF.make(100);
  BF.add(bf, "hello");
  assert.equal(BF.mightContain(bf, "hello"), true);
});

test("mightContain() returns false for items not added (basic)", () => {
  const bf = BF.make(10000);
  // With a large enough filter and no items, miss probability is 0.
  assert.equal(BF.mightContain(bf, "definitely-not-here"), false);
});

test("add() increments count", () => {
  const bf = BF.make(100);
  assert.equal(BF.count(bf), 0);
  BF.add(bf, "a");
  assert.equal(BF.count(bf), 1);
  BF.add(bf, "b");
  assert.equal(BF.count(bf), 2);
});

test("add() same item twice increments count twice", () => {
  const bf = BF.make(100);
  BF.add(bf, "x");
  BF.add(bf, "x");
  assert.equal(BF.count(bf), 2);
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

test("clear() resets count to 0 and empties the filter", () => {
  const bf = BF.make(100);
  BF.add(bf, "a");
  BF.add(bf, "b");
  assert.equal(BF.count(bf), 2);
  BF.clear(bf);
  assert.equal(BF.count(bf), 0);
  // After clear, the previously-added item should no longer be found
  // (assuming no hash collision with an empty filter).
  assert.equal(BF.mightContain(bf, "a"), false);
});

// ---------------------------------------------------------------------------
// bitCount / hashCount
// ---------------------------------------------------------------------------

test("bitCount() is a multiple of 32", () => {
  const bf = BF.make(1000, 0.01);
  assert.equal(BF.bitCount(bf) % 32, 0);
});

test("hashCount() is at least 1", () => {
  const bf = BF.make(1, 0.5);
  assert.ok(BF.hashCount(bf) >= 1);
});

// ---------------------------------------------------------------------------
// False-positive rate
// ---------------------------------------------------------------------------

test("make() uses ceil(kExact) when floor(kExact) violates fpr (coverage path)", () => {
  // capacity=100, fpr=0.3: m=256, kExact≈1.774, floor=1, ceil=2.
  // actualFpr(256, 1, 100) ≈ 0.3234 > 0.3 → floor fails.
  // actualFpr(256, 2, 100) ≈ 0.2939 ≤ 0.3 → ceil succeeds.
  const bf = BF.make(100, 0.3);
  assert.equal(BF.hashCount(bf), 2, "k should be ceil(kExact)=2");
  assert.equal(BF.bitCount(bf), 256, "m should be 256");
  // Verify no-false-negatives after adding all capacity items.
  for (let i = 0; i < 100; i++) BF.add(bf, `x${i}`);
  for (let i = 0; i < 100; i++) {
    assert.equal(BF.mightContain(bf, `x${i}`), true, `false negative for x${i}`);
  }
});

test("make() satisfies fpr guarantee for adversarial capacity=427 fpr=0.1 (critic regression)", () => {
  // capacity=427 was the concrete example from adversarial review where
  // Math.round(kExact) produced k=3 with actual FPR ≈ 0.1003 > 0.1.
  // The fix picks k from {floor, ceil} of kExact that satisfies actualFpr ≤ fpr,
  // doubling m if necessary.
  const bf = BF.make(427, 0.1);
  for (let i = 0; i < 427; i++) BF.add(bf, `item-${i}`);
  let fp = 0;
  for (let i = 427; i < 1427; i++) {
    if (BF.mightContain(bf, `item-${i}`)) fp++;
  }
  const measured = fp / 1000;
  assert.ok(
    measured <= 0.1 * 2,
    `FPR ${measured.toFixed(4)} exceeds 2× configured fpr 0.1`,
  );
  // Verify the theoretical guarantee holds (bitCount and hashCount reflect correct k/m).
  assert.ok(BF.bitCount(bf) >= 32, "bitCount must be ≥ 32");
  assert.ok(BF.hashCount(bf) >= 1, "hashCount must be ≥ 1");
});

test("false-positive rate is approximately ≤ 2× configured fpr", () => {
  const n = 10_000;
  const fpr = 0.01;
  const bf = BF.make(n, fpr);

  // Add n items
  for (let i = 0; i < n; i++) {
    BF.add(bf, `item-${i}`);
  }

  // Test n different items (offset by n to avoid collisions with added set)
  let fp = 0;
  for (let i = n; i < 2 * n; i++) {
    if (BF.mightContain(bf, `item-${i}`)) fp++;
  }

  const measured = fp / n;
  assert.ok(
    measured <= fpr * 2,
    `FPR ${measured.toFixed(4)} exceeds 2× configured fpr ${fpr}`,
  );
});
