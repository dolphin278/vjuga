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

test("get() traverses left and right subtrees correctly", () => {
  const m = OM.make<string, number>();
  OM.set(m, "c", 3);
  OM.set(m, "a", 1);
  OM.set(m, "e", 5);
  OM.set(m, "b", 2);
  OM.set(m, "d", 4);
  // Requires going left from root to find "a" and "b"
  assert.equal(OM.get(m, "a"), 1);
  assert.equal(OM.get(m, "b"), 2);
  // Requires going right from root to find "d" and "e"
  assert.equal(OM.get(m, "d"), 4);
  assert.equal(OM.get(m, "e"), 5);
  // Missing key that requires traversal
  assert.equal(OM.get(m, "z"), undefined);
});

test("has() returns correct presence", () => {
  const m = OM.make<string, number>();
  OM.set(m, "x", 10);
  assert.equal(OM.has(m, "x"), true);
  assert.equal(OM.has(m, "y"), false);
});

test("has() traverses left subtree correctly", () => {
  const m = OM.make<string, number>();
  OM.set(m, "m", 1);
  OM.set(m, "e", 2);
  OM.set(m, "z", 3);
  // "b" < "e" < "m": requires traversing left from root and then left again
  assert.equal(OM.has(m, "e"), true);
  assert.equal(OM.has(m, "b"), false); // goes left, not found
});

test("has() returns true when value is undefined", () => {
  const m = OM.make<string, number | undefined>();
  OM.set(m, "k", undefined);
  assert.equal(OM.has(m, "k"), true);
  assert.equal(OM.size(m), 1);
  assert.equal(OM.get(m, "k"), undefined);
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

test("del() returns false for missing key requiring left traversal", () => {
  const m = OM.make<string, number>();
  OM.set(m, "m", 1);
  OM.set(m, "e", 2);
  OM.set(m, "z", 3);
  // "b" < "e" — traverses left, key not found
  assert.equal(OM.del(m, "b"), false);
  assert.equal(OM.size(m), 3);
});

test("del() returns false for missing key requiring right traversal", () => {
  const m = OM.make<string, number>();
  OM.set(m, "m", 1);
  OM.set(m, "e", 2);
  OM.set(m, "z", 3);
  // "p" > "m" — traverses right, key not found between "m" and "z"
  assert.equal(OM.del(m, "p"), false);
  assert.equal(OM.size(m), 3);
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
  assert.deepEqual(
    [...OM.range(m, 1, 10)],
    [
      [2, "two"],
      [5, "five"],
      [8, "eight"],
    ],
  );
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
  assert.deepEqual(
    [...OM.entries(m)],
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
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

// ---------------------------------------------------------------------------
// Default comparator: NaN is a proper key (sorts last); -0 == 0
// ---------------------------------------------------------------------------

test("default comparator: NaN is its own key, sorts last, and does not clobber others", () => {
  const m = OM.make<number, string>();
  OM.set(m, 1, "one");
  OM.set(m, 3, "three");
  OM.set(m, NaN, "nan");
  OM.set(m, 2, "two");
  assert.equal(OM.size(m), 4);
  assert.equal(OM.get(m, 2), "two");
  assert.equal(OM.get(m, 1), "one");
  assert.equal(OM.get(m, NaN), "nan");
  assert.equal(OM.has(m, NaN), true);
  assert.deepEqual([...OM.keys(m)].map(String), ["1", "2", "3", "NaN"]);
  assert.deepEqual(OM.max(m), [NaN, "nan"]);
  OM.set(m, NaN, "nan2"); // overwrites the NaN entry only
  assert.equal(OM.size(m), 4);
  assert.equal(OM.get(m, NaN), "nan2");
  assert.equal(OM.del(m, NaN), true);
  assert.equal(OM.del(m, NaN), false);
  assert.deepEqual([...OM.keys(m)], [1, 2, 3]);
  assert.equal(OM.get(m, 2), "two");
  // NaN before/after other keys and NaN-only maps
  const only = OM.make<number, number>();
  OM.set(only, NaN, 1);
  OM.set(only, NaN, 2);
  OM.set(only, -Infinity, 3);
  assert.equal(OM.size(only), 2);
  assert.deepEqual([...OM.keys(only)].map(String), ["-Infinity", "NaN"]);
});

test("default comparator: -0 and 0 are the same key", () => {
  const m = OM.make<number, string>();
  OM.set(m, -0, "neg");
  OM.set(m, 0, "pos");
  assert.equal(OM.size(m), 1);
  assert.equal(OM.get(m, -0), "pos");
});

test("default comparator: mixed number/string keys collide (documented; pass compare)", () => {
  // G6-1: the default orders keys that compare consistently with </> (numbers,
  // bigints, or strings — not strings mixed with numbers). Incomparable pairs
  // (10 vs "a", 10 vs "10") compare equal and overwrite each other.
  const m = OM.make<number | string, string>();
  OM.set(m, 10, "number 10");
  OM.set(m, "10", "string 10");
  OM.set(m, "a", "string a");
  assert.equal(OM.size(m), 1);
  assert.equal(OM.get(m, 10), "string a");
  // A type-aware comparator restores a total order.
  const typed = OM.make<number | string, string>((a, b) => {
    if (typeof a !== typeof b) return typeof a === "number" ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  OM.set(typed, 10, "number 10");
  OM.set(typed, "10", "string 10");
  OM.set(typed, "a", "string a");
  assert.deepEqual([...OM.keys(typed)], [10, "10", "a"]);
});

test("default comparator: bigint and number/bigint mixes are totally ordered", () => {
  const m = OM.make<number | bigint, string>();
  for (const k of [3n, 1, 2n, 2.5, 0n, -1n]) OM.set(m, k, String(k));
  assert.equal(OM.size(m), 6);
  assert.deepEqual([...OM.keys(m)], [-1n, 0n, 1, 2n, 2.5, 3n]);
  assert.equal(OM.get(m, 2n), "2");
  // 0n and 0 (and -0) are the same key, like -0 and 0.
  OM.set(m, 0, "zero");
  assert.equal(OM.size(m), 6);
  assert.equal(OM.get(m, 0n), "zero");
});

// ---------------------------------------------------------------------------
// AVL balance: bounded comparator calls per lookup (an unbalanced BST would
// need O(n) calls for sorted inserts)
// ---------------------------------------------------------------------------

function maxLookupCalls(keys: number[], present: number[]): number {
  let calls = 0;
  const m = OM.make<number, number>((a, b) => {
    calls++;
    return a - b;
  });
  for (const k of present) OM.set(m, k, k);
  let worst = 0;
  for (const k of keys) {
    calls = 0;
    OM.get(m, k);
    if (calls > worst) worst = calls;
  }
  return worst;
}

// AVL height < 1.4405 * log2(n + 2); a lookup makes at most `height` comparisons.
const avlBound = (n: number): number => Math.ceil(1.4405 * Math.log2(n + 2));

test("AVL stays balanced for ascending, descending and interleaved inserts", () => {
  const n = 4095;
  const asc = Array.from({ length: n }, (_, i) => i);
  const desc = asc.slice().reverse();
  const zig: number[] = [];
  for (let i = 0, j = n - 1; i <= j; i++, j--) zig.push(i, j);
  for (const order of [asc, desc, zig]) {
    assert.ok(maxLookupCalls(asc, order) <= avlBound(n));
  }
});

test("AVL stays balanced after heavy deletion", () => {
  const n = 4096;
  const calls: number[] = [];
  let count = 0;
  const m = OM.make<number, number>((a, b) => {
    count++;
    return a - b;
  });
  for (let i = 0; i < n; i++) OM.set(m, i, i);
  // Delete the lower 3/4 in ascending order, the worst case for an unbalanced tree.
  for (let i = 0; i < (n * 3) / 4; i++) OM.del(m, i);
  const remaining = n / 4;
  for (let i = (n * 3) / 4; i < n; i++) {
    count = 0;
    OM.get(m, i);
    calls.push(count);
  }
  assert.equal(OM.size(m), remaining);
  assert.ok(Math.max(...calls) <= avlBound(remaining));
});
