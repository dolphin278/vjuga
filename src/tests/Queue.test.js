import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Queue } from "../Queue.js";

test("push/pop acts as LIFO", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  queue.push(1);
  queue.push(2);
  queue.push(3);

  assert.equal(queue.pop(), 3);
  assert.equal(queue.pop(), 2);
  assert.equal(queue.pop(), 1);
  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.equal(queue.pop(), void 0);
});

test("push/shift acts as FIFO", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  queue.push(1);
  queue.push(2);
  queue.push(3);

  assert.equal(queue.shift(), 1);
  assert.equal(queue.shift(), 2);
  assert.equal(queue.shift(), 3);
  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.equal(queue.shift(), void 0);
});

test("unshift/pop acts as FIFO", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  queue.unshift(1);
  queue.unshift(2);
  queue.unshift(3);

  assert.equal(queue.pop(), 1);
  assert.equal(queue.pop(), 2);
  assert.equal(queue.pop(), 3);
  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.equal(queue.pop(), void 0);
});

test("unshift/shift acts as LIFO", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  queue.unshift(1);
  queue.unshift(2);
  queue.unshift(3);

  assert.equal(queue.shift(), 3);
  assert.equal(queue.shift(), 2);
  assert.equal(queue.shift(), 1);
  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.equal(queue.shift(), void 0);
});

test("queue can handle more than 4 items", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  for (let i = 0; i < 10; i++) {
    queue.push(i);
  }

  for (let i = 9; i >= 0; i--) {
    assert.equal(queue.pop(), i);
  }

  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.equal(queue.pop(), void 0);
});

test("queue can be exported to array", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  for (let i = 0; i < 10; i++) {
    queue.push(i);
  }
  assert.deepEqual(queue.toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    queue.toArray(),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "toArray() should not change the queue",
  );
  assert.equal(queue.size, 10);
});

test("queue can be exported to array with emptying the queue", () => {
  /** @type {Queue<number>} */
  const queue = new Queue();
  for (let i = 0; i < 10; i++) {
    queue.push(i);
  }
  assert.deepEqual(queue.dumpToArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(queue.size, 0, "There should be no items in the queue");
  assert.deepEqual(queue.toArray(), [], "dumpToArray() should empty the queue");
});

test("queue can be created from array", () => {
  /** @type {Queue<number>} */
  const queue = new Queue([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(queue.toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("queue can be created from iterable", () => {
  const iterable = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const queue = Queue.from(iterable);
  assert.deepEqual(queue.toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("creation of array from iterable source recognized array as special case", () => {
  const array = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const queue = Queue.from(array);
  assert.deepEqual(queue.toArray(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
