import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as BitSet from "../BitSet.js";

// ---------------------------------------------------------------------------
// make
// ---------------------------------------------------------------------------

test("make() throws for invalid capacity", () => {
  assert.throws(() => BitSet.make(0), RangeError);
  assert.throws(() => BitSet.make(-1), RangeError);
  assert.throws(() => BitSet.make(1.5), RangeError);
  assert.throws(() => BitSet.make(-0.5), RangeError);
});

test("make() creates a BitSet with all bits 0", () => {
  const bs = BitSet.make(64);
  assert.equal(BitSet.popcount(bs), 0);
  assert.deepEqual(BitSet.toArray(bs), []);
});

test("make() capacity() returns correct capacity", () => {
  const bs = BitSet.make(100);
  assert.equal(BitSet.capacity(bs), 100);
});

// ---------------------------------------------------------------------------
// set / get / clear / toggle
// ---------------------------------------------------------------------------

test("set() sets bit; get() reads it", () => {
  const bs = BitSet.make(64);
  BitSet.set(bs, 0);
  assert.equal(BitSet.get(bs, 0), true);
  assert.equal(BitSet.get(bs, 1), false);
  BitSet.set(bs, 63);
  assert.equal(BitSet.get(bs, 63), true);
});

test("clear() clears a set bit", () => {
  const bs = BitSet.make(32);
  BitSet.set(bs, 10);
  assert.equal(BitSet.get(bs, 10), true);
  BitSet.clear(bs, 10);
  assert.equal(BitSet.get(bs, 10), false);
});

test("toggle() flips a bit", () => {
  const bs = BitSet.make(32);
  assert.equal(BitSet.get(bs, 7), false);
  BitSet.toggle(bs, 7);
  assert.equal(BitSet.get(bs, 7), true);
  BitSet.toggle(bs, 7);
  assert.equal(BitSet.get(bs, 7), false);
});

test("set/clear/toggle/get throw RangeError for out-of-bounds index", () => {
  const bs = BitSet.make(32);
  assert.throws(() => BitSet.set(bs, -1), RangeError);
  assert.throws(() => BitSet.set(bs, 32), RangeError);
  assert.throws(() => BitSet.set(bs, 1.5), RangeError);
  assert.throws(() => BitSet.clear(bs, -1), RangeError);
  assert.throws(() => BitSet.clear(bs, 32), RangeError);
  assert.throws(() => BitSet.toggle(bs, -1), RangeError);
  assert.throws(() => BitSet.toggle(bs, 32), RangeError);
  assert.throws(() => BitSet.get(bs, -1), RangeError);
  assert.throws(() => BitSet.get(bs, 32), RangeError);
});

// ---------------------------------------------------------------------------
// popcount
// ---------------------------------------------------------------------------

test("popcount() on empty BitSet returns 0", () => {
  const bs = BitSet.make(100);
  assert.equal(BitSet.popcount(bs), 0);
});

test("popcount() on single-word BitSet with a few bits set", () => {
  const bs = BitSet.make(32);
  BitSet.set(bs, 0);
  BitSet.set(bs, 1);
  BitSet.set(bs, 31);
  assert.equal(BitSet.popcount(bs), 3);
});

test("popcount() across multiple words", () => {
  const bs = BitSet.make(64);
  for (let i = 0; i < 64; i++) BitSet.set(bs, i);
  assert.equal(BitSet.popcount(bs), 64);
});

test("popcount() on BitSet with non-multiple-of-32 capacity masks last word", () => {
  // capacity=33: two words; only bits 0..32 are valid
  const bs = BitSet.make(33);
  for (let i = 0; i < 33; i++) BitSet.set(bs, i);
  assert.equal(BitSet.popcount(bs), 33);
});

test("popcount() equals toArray().length", () => {
  const bs = BitSet.make(65);
  BitSet.set(bs, 0);
  BitSet.set(bs, 32);
  BitSet.set(bs, 64);
  assert.equal(BitSet.popcount(bs), BitSet.toArray(bs).length);
});

// ---------------------------------------------------------------------------
// toArray
// ---------------------------------------------------------------------------

test("toArray() returns empty array when no bits are set", () => {
  const bs = BitSet.make(64);
  assert.deepEqual(BitSet.toArray(bs), []);
});

test("toArray() returns indices in ascending order", () => {
  const bs = BitSet.make(100);
  BitSet.set(bs, 99);
  BitSet.set(bs, 0);
  BitSet.set(bs, 50);
  assert.deepEqual(BitSet.toArray(bs), [0, 50, 99]);
});

test("toArray() respects capacity boundary (last-word masking)", () => {
  // capacity=5: only indices 0..4 are valid; internal Uint32Array has 1 word
  const bs = BitSet.make(5);
  for (let i = 0; i < 5; i++) BitSet.set(bs, i);
  assert.deepEqual(BitSet.toArray(bs), [0, 1, 2, 3, 4]);
});

// ---------------------------------------------------------------------------
// and / or / xor / not
// ---------------------------------------------------------------------------

test("and() produces correct result", () => {
  const a = BitSet.make(8);
  const b = BitSet.make(8);
  BitSet.set(a, 0);
  BitSet.set(a, 1);
  BitSet.set(b, 1);
  BitSet.set(b, 2);
  const c = BitSet.and(a, b);
  assert.deepEqual(BitSet.toArray(c), [1]);
});

test("or() produces correct result", () => {
  const a = BitSet.make(8);
  const b = BitSet.make(8);
  BitSet.set(a, 0);
  BitSet.set(b, 2);
  const c = BitSet.or(a, b);
  assert.deepEqual(BitSet.toArray(c), [0, 2]);
});

test("xor() produces correct result", () => {
  const a = BitSet.make(8);
  const b = BitSet.make(8);
  BitSet.set(a, 0);
  BitSet.set(a, 1);
  BitSet.set(b, 1);
  BitSet.set(b, 2);
  const c = BitSet.xor(a, b);
  assert.deepEqual(BitSet.toArray(c), [0, 2]);
});

test("not() flips all bits within capacity", () => {
  const a = BitSet.make(8);
  BitSet.set(a, 3);
  const b = BitSet.not(a);
  assert.equal(BitSet.popcount(b), 7);
  assert.equal(BitSet.get(b, 3), false);
  assert.equal(BitSet.get(b, 0), true);
  assert.equal(BitSet.get(b, 7), true);
});

test("not() masks excess bits in last word (capacity not multiple of 32)", () => {
  const a = BitSet.make(3);
  // a has bits 0,1,2; not(a) should have no bits set
  BitSet.set(a, 0);
  BitSet.set(a, 1);
  BitSet.set(a, 2);
  const b = BitSet.not(a);
  assert.equal(BitSet.popcount(b), 0);
});

test("not() exact-multiple-of-32 capacity", () => {
  const a = BitSet.make(32);
  // All bits 0..31 set; not(a) = all clear
  for (let i = 0; i < 32; i++) BitSet.set(a, i);
  const b = BitSet.not(a);
  assert.equal(BitSet.popcount(b), 0);
});

test("double-not identity: not(not(a)) deepEquals a", () => {
  const a = BitSet.make(65);
  BitSet.set(a, 0);
  BitSet.set(a, 32);
  BitSet.set(a, 64);
  const b = BitSet.not(BitSet.not(a));
  assert.deepEqual(BitSet.toArray(b), BitSet.toArray(a));
});

test("and/or/xor/not throw RangeError when capacities differ", () => {
  const a = BitSet.make(32);
  const b = BitSet.make(64);
  assert.throws(() => BitSet.and(a, b), RangeError);
  assert.throws(() => BitSet.or(a, b), RangeError);
  assert.throws(() => BitSet.xor(a, b), RangeError);
});
