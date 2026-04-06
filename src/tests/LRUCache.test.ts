import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as LRUCache from "../LRUCache.js";

test("make() throws for invalid capacity", () => {
  assert.throws(() => LRUCache.make(0), RangeError);
  assert.throws(() => LRUCache.make(-1), RangeError);
  assert.throws(() => LRUCache.make(1.5), RangeError);
});

test("set/get basic round-trip", () => {
  const cache = LRUCache.make<string, number>(3);
  LRUCache.set(cache, "a", 1);
  assert.equal(LRUCache.get(cache, "a"), 1);
});

test("has() returns correct presence", () => {
  const cache = LRUCache.make<string, number>(2);
  LRUCache.set(cache, "x", 10);
  assert.equal(LRUCache.has(cache, "x"), true);
  assert.equal(LRUCache.has(cache, "y"), false);
});

test("get() returns undefined for missing key", () => {
  const cache = LRUCache.make<string, number>(2);
  assert.equal(LRUCache.get(cache, "missing"), void 0);
});

test("size() tracks the number of entries", () => {
  const cache = LRUCache.make<string, number>(5);
  assert.equal(LRUCache.size(cache), 0);
  LRUCache.set(cache, "a", 1);
  assert.equal(LRUCache.size(cache), 1);
  LRUCache.set(cache, "b", 2);
  assert.equal(LRUCache.size(cache), 2);
  LRUCache.del(cache, "a");
  assert.equal(LRUCache.size(cache), 1);
});

test("del() removes the entry and returns true", () => {
  const cache = LRUCache.make<string, number>(2);
  LRUCache.set(cache, "k", 42);
  assert.equal(LRUCache.del(cache, "k"), true);
  assert.equal(LRUCache.has(cache, "k"), false);
  assert.equal(LRUCache.size(cache), 0);
});

test("del() returns false for missing key", () => {
  const cache = LRUCache.make<string, number>(2);
  assert.equal(LRUCache.del(cache, "nope"), false);
});

test("evicts LRU entry when capacity is exceeded", () => {
  const cache = LRUCache.make<string, number>(3);
  LRUCache.set(cache, "a", 1);
  LRUCache.set(cache, "b", 2);
  LRUCache.set(cache, "c", 3);
  // "a" was inserted first and never accessed — it is the LRU entry.
  LRUCache.set(cache, "d", 4); // should evict "a"
  assert.equal(LRUCache.has(cache, "a"), false);
  assert.equal(LRUCache.get(cache, "b"), 2);
  assert.equal(LRUCache.get(cache, "c"), 3);
  assert.equal(LRUCache.get(cache, "d"), 4);
  assert.equal(LRUCache.size(cache), 3);
});

test("get() promotes entry to MRU, preventing its eviction", () => {
  const cache = LRUCache.make<string, number>(2);
  LRUCache.set(cache, "a", 1);
  LRUCache.set(cache, "b", 2);
  // Access "a" — it becomes MRU; "b" is now LRU.
  LRUCache.get(cache, "a");
  LRUCache.set(cache, "c", 3); // should evict "b", not "a"
  assert.equal(LRUCache.has(cache, "a"), true);
  assert.equal(LRUCache.has(cache, "b"), false);
  assert.equal(LRUCache.get(cache, "c"), 3);
});

test("set() on existing key updates value and promotes to MRU", () => {
  const cache = LRUCache.make<string, number>(2);
  LRUCache.set(cache, "a", 1);
  LRUCache.set(cache, "b", 2);
  LRUCache.set(cache, "a", 99); // update — "a" becomes MRU, "b" is LRU
  LRUCache.set(cache, "c", 3); // should evict "b"
  assert.equal(LRUCache.get(cache, "a"), 99);
  assert.equal(LRUCache.has(cache, "b"), false);
  assert.equal(LRUCache.get(cache, "c"), 3);
});

test("cache of capacity 1 always holds the last set entry", () => {
  const cache = LRUCache.make<string, number>(1);
  LRUCache.set(cache, "a", 1);
  assert.equal(LRUCache.get(cache, "a"), 1);
  LRUCache.set(cache, "b", 2);
  assert.equal(LRUCache.has(cache, "a"), false);
  assert.equal(LRUCache.get(cache, "b"), 2);
});

test("large sequence: size never exceeds capacity", () => {
  const capacity = 10;
  const cache = LRUCache.make<number, number>(capacity);
  for (let i = 0; i < 1000; i++) {
    LRUCache.set(cache, i, i * 2);
    assert.ok(LRUCache.size(cache) <= capacity);
  }
});
