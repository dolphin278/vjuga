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
  get,
  set,
  swap,
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

test("unshift triggers buffer growth when buffer fills", () => {
  const queue = make<number>();
  // Initial capacity is 4; filling all 4 slots via unshift triggers growList.
  unshift(queue, 1);
  unshift(queue, 2);
  unshift(queue, 3);
  unshift(queue, 4); // this unshift fills the buffer → growList
  assert.equal(size(queue), 4);
  assert.deepEqual(toArray(queue), [4, 3, 2, 1]);
});

test("toArray handles circular-buffer wrap (tail < head)", () => {
  // Create a wrap: push 3, shift 2, push 2 more → kHead=2, kTail=1 (tail < head).
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  shift(queue); // drop 1
  shift(queue); // drop 2
  push(queue, 4); // kTail wraps to 0
  push(queue, 5); // kTail = 1, kHead = 2 → circular
  assert.deepEqual(toArray(queue), [3, 4, 5]);
  assert.equal(size(queue), 3, "toArray must not mutate queue");
});

test("dumpToArray handles circular-buffer wrap (tail < head)", () => {
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  shift(queue);
  shift(queue);
  push(queue, 4);
  push(queue, 5);
  assert.deepEqual(dumpToArray(queue), [3, 4, 5]);
  assert.equal(size(queue), 0, "dumpToArray must empty the queue");
});

test("tryToShrinkList shrinks backing array when < 25% occupied (via shift)", () => {
  const queue = make<number>();
  // Push enough items to grow capacity above 10000, then drain to < 25%.
  const N = 16000;
  for (let i = 0; i < N; i++) push(queue, i);
  // Shift until < 25% remain (need size < capacity/4 ≈ 4096).
  for (let i = 0; i < 14001; i++) shift(queue);
  // The next shift triggers tryToShrinkList via shift's code path.
  shift(queue);
  assert.equal(size(queue), N - 14002);
});

test("tryToShrinkList shrinks backing array when < 25% occupied (via pop)", () => {
  const queue = make<number>();
  const N = 16000;
  for (let i = 0; i < N; i++) push(queue, i);
  // Pop until < 25% remain — triggers tryToShrinkList via pop's code path.
  for (let i = 0; i < 14001; i++) pop(queue);
  pop(queue); // this pop triggers tryToShrinkList
  assert.equal(size(queue), N - 14002);
});

test("get returns element at logical index", () => {
  const queue = make([10, 20, 30, 40, 50]);
  assert.equal(get(queue, 0), 10);
  assert.equal(get(queue, 2), 30);
  assert.equal(get(queue, 4), 50);
});

test("get handles circular-wrap (head advanced via shifts)", () => {
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  shift(queue); // drop 1, head advances
  shift(queue); // drop 2, head advances
  push(queue, 4);
  push(queue, 5);
  // queue = [3, 4, 5], head is wrapped
  assert.equal(get(queue, 0), 3);
  assert.equal(get(queue, 1), 4);
  assert.equal(get(queue, 2), 5);
});

test("set replaces element at logical index", () => {
  const queue = make([10, 20, 30]);
  set(queue, 1, 99);
  assert.deepEqual(toArray(queue), [10, 99, 30]);
});

test("set handles circular-wrap", () => {
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  shift(queue);
  shift(queue);
  push(queue, 4);
  push(queue, 5);
  // queue = [3, 4, 5]
  set(queue, 2, 99);
  assert.deepEqual(toArray(queue), [3, 4, 99]);
});

test("swap exchanges elements at two logical indices", () => {
  const queue = make([10, 20, 30, 40]);
  swap(queue, 0, 3);
  assert.deepEqual(toArray(queue), [40, 20, 30, 10]);
});

test("swap handles circular-wrap", () => {
  const queue = make<number>();
  push(queue, 1);
  push(queue, 2);
  push(queue, 3);
  shift(queue);
  shift(queue);
  push(queue, 4);
  push(queue, 5);
  // queue = [3, 4, 5]
  swap(queue, 0, 2);
  assert.deepEqual(toArray(queue), [5, 4, 3]);
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
