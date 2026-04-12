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
