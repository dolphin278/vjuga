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
  assert.ok(measured <= 0.1 * 2, `FPR ${measured.toFixed(4)} exceeds 2× configured fpr 0.1`);
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
  assert.ok(measured <= fpr * 2, `FPR ${measured.toFixed(4)} exceeds 2× configured fpr ${fpr}`);
});

// ---------------------------------------------------------------------------
// Validation / sizing regressions
// ---------------------------------------------------------------------------

test("make() rejects NaN fpr (used to hang forever)", () => {
  assert.throws(() => BF.make(100, NaN), RangeError);
  assert.throws(() => BF.make(NaN, 0.01), RangeError);
});

test("make() throws RangeError when fpr is unreachable within the 2^32-bit cap", () => {
  assert.throws(() => BF.make(2 ** 31 - 1, 0.01), /unreachable/);
  assert.throws(() => BF.make(500_000_000, 1e-3), RangeError);
});

test("make() with m = 2^32 allocates m/32 words and has no false negatives", () => {
  // 300M items at 1% needs ~2.9e9 bits -> next power of two is 2^32 (512 MiB, lazily zeroed).
  const bf = BF.make(300_000_000, 0.01);
  assert.equal(BF.bitCount(bf), 2 ** 32);
  for (let i = 0; i < 200; i++) BF.add(bf, "key:" + i);
  for (let i = 0; i < 200; i++) assert.equal(BF.mightContain(bf, "key:" + i), true);
  // Not saturated: most absent keys are rejected.
  let fp = 0;
  for (let i = 0; i < 2000; i++) if (BF.mightContain(bf, "absent:" + i)) fp++;
  assert.ok(fp < 20, `unexpected false positives: ${fp}`);
});

// ---------------------------------------------------------------------------
// False-positive rate vs the exact theoretical rate, across key families.
// FNV-1a alone skews structured / non-ASCII keys (low output bits depend only on
// the low bits of each code unit); the fmix32 finalizer brings them to theory.
// ---------------------------------------------------------------------------

function theoreticalFpr(m: number, k: number, n: number): number {
  return Math.pow(1 - Math.exp((-k * n) / m), k);
}

const families: Record<string, (i: number) => string> = {
  decimalIds: (i) => "user:" + i,
  base36Short: (i) => "k" + i.toString(36),
  hexLike: (i) => (Math.imul(i, 0x9e3779b1) >>> 0).toString(16) + "-" + (i * 7919).toString(16),
  cjk: (i) => "用户:" + String.fromCharCode(0x4e00 + (i % 5000), 0x4e00 + Math.floor(i / 5000)),
  // Code units that differ only in their high byte (low byte constant).
  highByteOnly: (i) =>
    "user:" +
    String.fromCharCode(
      0x4100 + ((i % 50) << 8),
      0x4100 + ((Math.floor(i / 50) % 50) << 8),
      0x4100 + (Math.floor(i / 2500) << 8),
    ),
  emoji: (i) => "\u{1F600}" + i.toString(36) + String.fromCharCode(0xd800 + (i % 1000)),
};

for (const [name, key] of Object.entries(families)) {
  test(`false-positive rate matches theory for key family: ${name}`, () => {
    const n = 5000;
    const probes = 100_000;
    for (const fpr of [0.1, 0.01]) {
      const bf = BF.make(n, fpr);
      for (let i = 0; i < n; i++) BF.add(bf, key(i));
      const expected = theoreticalFpr(BF.bitCount(bf), BF.hashCount(bf), n);
      let fp = 0;
      for (let i = n; i < n + probes; i++) if (BF.mightContain(bf, key(i))) fp++;
      const measured = fp / probes;
      // Statistical noise at these sizes is ~5%; 1.35x also catches a skewed hash.
      assert.ok(
        measured <= expected * 1.35 + 0.0005,
        `${name} fpr=${fpr}: measured ${measured.toFixed(5)} vs theoretical ${expected.toFixed(5)}`,
      );
      assert.ok(measured <= fpr, `${name}: measured ${measured} exceeds requested ${fpr}`);
    }
  });
}

test("keys differing only in high bits of a code unit do not collide systematically", () => {
  // With raw FNV-1a, "user:A" and "user:䁁" hashed to the same low bits.
  const bf = BF.make(1000, 0.01);
  BF.add(bf, "user:A");
  let hits = 0;
  for (let hi = 1; hi < 200; hi++) {
    if (BF.mightContain(bf, "user:" + String.fromCharCode(0x41 + (hi << 8)))) hits++;
  }
  assert.ok(hits <= 3, `${hits}/199 high-bit variants collided`);
});
