import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  make,
  push,
  pop,
  size,
  shift,
  toArray,
  dumpToArray,
  unshift,
} from "../Queue.js";

/**
 * @template T
 * @typedef {import('../Queue.js').Queue<T>} Queue
 */

test("push/pop acts as LIFO", () => {
  /** @type {Queue<number>} */
  const queue = make();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);

  assert.equal(pop(queue), 3);
  assert.equal(pop(queue), 2);
  assert.equal(pop(queue), 1);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.equal(pop(queue), void 0);
});

test("push/shift acts as FIFO", () => {
  /** @type {Queue<number>} */
  const queue = make();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);

  assert.equal(shift(queue), 1);
  assert.equal(shift(queue), 2);
  assert.equal(shift(queue), 3);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.equal(shift(queue), void 0);
});

test("unshift/pop acts as FIFO", () => {
  /** @type {Queue<number>} */
  const queue = make();
  unshift(queue, 1);
  unshift(queue, 2);
  unshift(queue, 3);

  assert.equal(pop(queue), 1);
  assert.equal(pop(queue), 2);
  assert.equal(pop(queue), 3);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.equal(pop(queue), void 0);
});

test("unshift/shift acts as LIFO", () => {
  /** @type {Queue<number>} */
  const queue = make();
  unshift(queue, 1);
  unshift(queue, 2);
  unshift(queue, 3);

  assert.equal(shift(queue), 3);
  assert.equal(shift(queue), 2);
  assert.equal(shift(queue), 1);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.equal(shift(queue), void 0);
});

test("queue can handle more than 4 items", () => {
  /** @type {Queue<number>} */
  const queue = make();
  for (let i = 0; i < 10; i++) {
    push(queue, i);
  }

  for (let i = 9; i >= 0; i--) {
    assert.equal(pop(queue), i);
  }

  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.equal(pop(queue), void 0);
});

test("queue can be exported to array", () => {
  /** @type {Queue<number>} */
  const queue = make();
  for (let i = 0; i < 10; i++) {
    push(queue, i);
  }
  assert.deepEqual(toArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    toArray(queue),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "toArray() should not change the queue"
  );
  assert.equal(size(queue), 10);
});

test("queue can be exported to array with emptying the queue", () => {
  /** @type {Queue<number>} */
  const queue = make();
  for (let i = 0; i < 10; i++) {
    push(queue, i);
  }
  assert.deepEqual(dumpToArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.deepEqual(toArray(queue), [], "dumpToArray() should empty the queue");
});

test("queue can be created from array", () => {
  /** @type {Queue<number>} */
  const queue = make([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(toArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("queue can be created from iterable", () => {
  const iterable = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const queue = make(iterable);
  assert.deepEqual(toArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("creation of array from iterable source recognized array as special case", () => {
  const array = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const queue = make(array);
  assert.deepEqual(toArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
