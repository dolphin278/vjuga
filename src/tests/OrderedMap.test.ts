import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as OM from "../OrderedMap.js";

// ---------------------------------------------------------------------------
// make
// ---------------------------------------------------------------------------

test("make() creates an empty map with default comparator", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.size(m), 0);
  assert.equal(OM.min(m), undefined);
  assert.equal(OM.max(m), undefined);
});

test("make() accepts a custom comparator", () => {
  // Reverse order
  const m = OM.make<number, string>((a, b) => b - a);
  OM.set(m, 1, "one");
  OM.set(m, 2, "two");
  OM.set(m, 3, "three");
  assert.deepEqual([...OM.keys(m)], [3, 2, 1]);
});

// ---------------------------------------------------------------------------
// set / get / has
// ---------------------------------------------------------------------------

test("set/get basic round-trip", () => {
  const m = OM.make<string, number>();
  OM.set(m, "a", 1);
  assert.equal(OM.get(m, "a"), 1);
});

test("get() returns undefined for missing key", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.get(m, "missing"), undefined);
});

test("has() returns correct presence", () => {
  const m = OM.make<string, number>();
  OM.set(m, "x", 10);
  assert.equal(OM.has(m, "x"), true);
  assert.equal(OM.has(m, "y"), false);
});

test("set() on existing key updates value without changing size", () => {
  const m = OM.make<string, number>();
  OM.set(m, "a", 1);
  OM.set(m, "a", 99);
  assert.equal(OM.get(m, "a"), 99);
  assert.equal(OM.size(m), 1);
});

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

test("size() tracks entries correctly", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.size(m), 0);
  OM.set(m, "a", 1);
  assert.equal(OM.size(m), 1);
  OM.set(m, "b", 2);
  assert.equal(OM.size(m), 2);
  OM.del(m, "a");
  assert.equal(OM.size(m), 1);
});

// ---------------------------------------------------------------------------
// del
// ---------------------------------------------------------------------------

test("del() removes the entry and returns true", () => {
  const m = OM.make<string, number>();
  OM.set(m, "k", 42);
  assert.equal(OM.del(m, "k"), true);
  assert.equal(OM.has(m, "k"), false);
  assert.equal(OM.size(m), 0);
});

test("del() returns false for missing key", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.del(m, "nope"), false);
});

test("del() on empty map returns false", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.del(m, "x"), false);
});

// ---------------------------------------------------------------------------
// min / max
// ---------------------------------------------------------------------------

test("min/max return undefined on empty map", () => {
  const m = OM.make<string, number>();
  assert.equal(OM.min(m), undefined);
  assert.equal(OM.max(m), undefined);
});

test("min/max return correct entries after inserts", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  OM.set(m, 2, "two");
  OM.set(m, 8, "eight");
  assert.deepEqual(OM.min(m), [2, "two"]);
  assert.deepEqual(OM.max(m), [8, "eight"]);
});

test("min/max update after deleting the extremes", () => {
  const m = OM.make<number, string>();
  OM.set(m, 1, "one");
  OM.set(m, 2, "two");
  OM.set(m, 3, "three");
  OM.del(m, 1);
  assert.deepEqual(OM.min(m), [2, "two"]);
  OM.del(m, 3);
  assert.deepEqual(OM.max(m), [2, "two"]);
});

// ---------------------------------------------------------------------------
// floor / ceiling
// ---------------------------------------------------------------------------

test("floor() returns undefined when key is below all entries", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  assert.equal(OM.floor(m, 3), undefined);
});

test("ceiling() returns undefined when key is above all entries", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  assert.equal(OM.ceiling(m, 7), undefined);
});

test("floor() on empty map returns undefined", () => {
  const m = OM.make<number, string>();
  assert.equal(OM.floor(m, 5), undefined);
});

test("ceiling() on empty map returns undefined", () => {
  const m = OM.make<number, string>();
  assert.equal(OM.ceiling(m, 5), undefined);
});

test("floor() returns exact match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  OM.set(m, 10, "ten");
  assert.deepEqual(OM.floor(m, 5), [5, "five"]);
});

test("ceiling() returns exact match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  OM.set(m, 10, "ten");
  assert.deepEqual(OM.ceiling(m, 10), [10, "ten"]);
});

test("floor() returns largest key < query when no exact match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 2, "two");
  OM.set(m, 5, "five");
  OM.set(m, 8, "eight");
  assert.deepEqual(OM.floor(m, 6), [5, "five"]);
});

test("ceiling() returns smallest key > query when no exact match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 2, "two");
  OM.set(m, 5, "five");
  OM.set(m, 8, "eight");
  assert.deepEqual(OM.ceiling(m, 6), [8, "eight"]);
});

// ---------------------------------------------------------------------------
// range
// ---------------------------------------------------------------------------

test("range() returns empty for empty map", () => {
  const m = OM.make<number, string>();
  assert.deepEqual([...OM.range(m, 1, 10)], []);
});

test("range() returns all entries when lo <= min and hi >= max", () => {
  const m = OM.make<number, string>();
  OM.set(m, 2, "two");
  OM.set(m, 5, "five");
  OM.set(m, 8, "eight");
  assert.deepEqual([...OM.range(m, 1, 10)], [
    [2, "two"],
    [5, "five"],
    [8, "eight"],
  ]);
});

test("range() returns partial range (inclusive bounds)", () => {
  const m = OM.make<number, string>();
  for (let i = 1; i <= 10; i++) OM.set(m, i, String(i));
  const result = [...OM.range(m, 3, 7)];
  assert.deepEqual(
    result.map(([k]) => k),
    [3, 4, 5, 6, 7],
  );
});

test("range() returns empty when lo > hi (no entries in range)", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  // lo > hi: nothing satisfies 10 <= k <= 2
  assert.deepEqual([...OM.range(m, 10, 2)], []);
});

test("range() with exact single match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  assert.deepEqual([...OM.range(m, 5, 5)], [[5, "five"]]);
});

// ---------------------------------------------------------------------------
// keys / values / entries — sorted order
// ---------------------------------------------------------------------------

test("keys() yields in ascending order", () => {
  const m = OM.make<string, number>();
  OM.set(m, "c", 3);
  OM.set(m, "a", 1);
  OM.set(m, "b", 2);
  assert.deepEqual([...OM.keys(m)], ["a", "b", "c"]);
});

test("values() yields in key-ascending order", () => {
  const m = OM.make<string, number>();
  OM.set(m, "c", 3);
  OM.set(m, "a", 1);
  OM.set(m, "b", 2);
  assert.deepEqual([...OM.values(m)], [1, 2, 3]);
});

test("entries() yields in key-ascending order", () => {
  const m = OM.make<string, number>();
  OM.set(m, "c", 3);
  OM.set(m, "a", 1);
  OM.set(m, "b", 2);
  assert.deepEqual([...OM.entries(m)], [
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
});

test("keys/values/entries on empty map yield nothing", () => {
  const m = OM.make<string, number>();
  assert.deepEqual([...OM.keys(m)], []);
  assert.deepEqual([...OM.values(m)], []);
  assert.deepEqual([...OM.entries(m)], []);
});

// ---------------------------------------------------------------------------
// forRange — callback-based range scan
// ---------------------------------------------------------------------------

test("forRange() visits entries in [lo, hi] inclusive", () => {
  const m = OM.make<number, string>();
  for (let i = 1; i <= 10; i++) OM.set(m, i, String(i));
  const keys: number[] = [];
  const count = OM.forRange(m, 3, 7, (k) => keys.push(k));
  assert.equal(count, 5);
  assert.deepEqual(keys, [3, 4, 5, 6, 7]);
});

test("forRange() returns 0 and calls fn 0 times when no entries in range", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  let called = 0;
  const count = OM.forRange(m, 10, 2, () => called++);
  assert.equal(count, 0);
  assert.equal(called, 0);
});

test("forRange() on empty map returns 0", () => {
  const m = OM.make<number, string>();
  const count = OM.forRange(m, 0, 100, () => {});
  assert.equal(count, 0);
});

test("forRange() exact single match", () => {
  const m = OM.make<number, string>();
  OM.set(m, 5, "five");
  const pairs: [number, string][] = [];
  const count = OM.forRange(m, 5, 5, (k, v) => pairs.push([k, v]));
  assert.equal(count, 1);
  assert.deepEqual(pairs, [[5, "five"]]);
});

test("forRange() lo === hi but key not present returns 0", () => {
  const m = OM.make<number, string>();
  OM.set(m, 3, "three");
  OM.set(m, 7, "seven");
  let called = 0;
  const count = OM.forRange(m, 5, 5, () => called++);
  assert.equal(count, 0);
  assert.equal(called, 0);
});

test("forRange() lo below minimum visits all entries in map", () => {
  const m = OM.make<number, string>();
  OM.set(m, 3, "three");
  OM.set(m, 5, "five");
  OM.set(m, 7, "seven");
  const keys: number[] = [];
  // lo=0 is below min(3), hi=10 is above max(7) — should visit all 3
  const count = OM.forRange(m, 0, 10, (k) => keys.push(k));
  assert.equal(count, 3);
  assert.deepEqual(keys, [3, 5, 7]);
});

// ---------------------------------------------------------------------------
// Large sequential insert — verify sorted order and size
// ---------------------------------------------------------------------------

test("sequential insert 1000 keys — correct sorted order and size", () => {
  const m = OM.make<number, number>();
  for (let i = 999; i >= 0; i--) OM.set(m, i, i * 2);
  assert.equal(OM.size(m), 1000);
  const ks = [...OM.keys(m)];
  for (let i = 0; i < 1000; i++) {
    assert.equal(ks[i], i);
  }
});

// ---------------------------------------------------------------------------
// Large random insert + delete
// ---------------------------------------------------------------------------

test("random insert and delete maintain invariants", () => {
  const m = OM.make<number, number>();
  const ref = new Map<number, number>();
  // Insert 200 random keys
  for (let i = 0; i < 200; i++) {
    const k = (i * 1337 + 42) % 100;
    OM.set(m, k, i);
    ref.set(k, i);
  }
  assert.equal(OM.size(m), ref.size);
  // Delete half
  let j = 0;
  for (const [k] of ref) {
    if (j++ % 2 === 0) {
      OM.del(m, k);
      ref.delete(k);
    }
  }
  assert.equal(OM.size(m), ref.size);
  // Verify sorted order
  const sortedRef = [...ref.keys()].sort((a, b) => a - b);
  assert.deepEqual([...OM.keys(m)], sortedRef);
});
