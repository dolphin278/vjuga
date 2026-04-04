import { test } from "node:test";
import * as assert from "node:assert/strict";
import { memoize, once } from "../Memoization.js";

test("function memoization caches results of given function", () => {
  let calls: number[] = [];
  const fn = (a: number) => (calls.push(a), a + 1);
  const memoized = memoize(fn);

  assert.equal(memoized(1), 2);
  assert.equal(memoized(1), 2);
  assert.equal(memoized(2), 3);
  assert.equal(memoized(2), 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [1, 2]);
});

test("default cache key function is JSON.stringify", () => {
  let calls: { a: number }[] = [];
  const fn = (a: { a: number }) => (calls.push(a), a.a + 1);
  const memoized = memoize(fn);
  assert.equal(memoized({ a: 1 }), 2);
  assert.equal(memoized({ a: 1 }), 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [{ a: 1 }]);
});

test("once returns function that calls original function only once", () => {
  let counter = 0;
  const fn = () => (counter++, counter);
  const memoized = once(fn);
  assert.equal(memoized(), 1);
  assert.equal(memoized(), 1);
  assert.equal(counter, 1);
});
