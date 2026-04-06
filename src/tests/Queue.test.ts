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
  peekFront,
  peekBack,
} from "../Queue.js";

test("push/pop acts as LIFO", () => {
  const queue = make<number>();
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
  const queue = make<number>();
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
  const queue = make<number>();
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
  const queue = make<number>();
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
  const queue = make<number>();
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
  const queue = make<number>();
  for (let i = 0; i < 10; i++) {
    push(queue, i);
  }
  assert.deepEqual(toArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    toArray(queue),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "toArray() should not change the queue",
  );
  assert.equal(size(queue), 10);
});

test("queue can be exported to array with emptying the queue", () => {
  const queue = make<number>();
  for (let i = 0; i < 10; i++) {
    push(queue, i);
  }
  assert.deepEqual(dumpToArray(queue), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(size(queue), 0, "There should be no items in the queue");
  assert.deepEqual(toArray(queue), [], "dumpToArray() should empty the queue");
});

test("queue can be created from array", () => {
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

test("peekFront returns front element without removing it", () => {
  const queue = make([1, 2, 3]);
  assert.equal(peekFront(queue), 1);
  assert.equal(size(queue), 3, "peekFront must not mutate the queue");
  assert.equal(peekFront(queue), 1, "repeated peekFront returns same value");
});

test("peekBack returns back element without removing it", () => {
  const queue = make([1, 2, 3]);
  assert.equal(peekBack(queue), 3);
  assert.equal(size(queue), 3, "peekBack must not mutate the queue");
  assert.equal(peekBack(queue), 3, "repeated peekBack returns same value");
});

test("peekFront and peekBack return undefined for empty queue", () => {
  const queue = make<number>();
  assert.equal(peekFront(queue), void 0);
  assert.equal(peekBack(queue), void 0);
});

test("peekFront agrees with shift", () => {
  const queue = make([10, 20, 30]);
  assert.equal(peekFront(queue), shift(queue));
  assert.equal(peekFront(queue), shift(queue));
  assert.equal(peekFront(queue), shift(queue));
  assert.equal(peekFront(queue), void 0);
});

test("peekBack agrees with pop", () => {
  const queue = make([10, 20, 30]);
  assert.equal(peekBack(queue), pop(queue));
  assert.equal(peekBack(queue), pop(queue));
  assert.equal(peekBack(queue), pop(queue));
  assert.equal(peekBack(queue), void 0);
});

test("peekBack is correct after ring buffer wraps", () => {
  // Initial capacity is 4. Fill it, drain two from the front to advance kHead,
  // then push two more so kTail wraps past the original end of the backing array.
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  push(queue, 4);
  shift(queue); // kHead advances
  shift(queue); // kHead advances again
  push(queue, 5); // kTail wraps around
  push(queue, 6);
  // queue now holds [3, 4, 5, 6]; back element is 6
  assert.equal(peekBack(queue), 6);
  assert.equal(size(queue), 4, "peekBack must not mutate");
});
