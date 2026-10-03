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

const capacityOf = (q: object): number => {
  const sym = Object.getOwnPropertySymbols(q).find((s) => s.description === "list")!;
  return ((q as Record<symbol, unknown[]>)[sym] as unknown[]).length;
};

test("shrinks while wrapped (tail < head), preserving order", () => {
  const queue = make<number>();
  const L = 1 << 16;
  let next = 0;
  const model: number[] = [];
  for (let i = 0; i < L / 2; i++) {
    push(queue, next);
    model.push(next++);
  }
  // FIFO steady state wraps the buffer.
  for (let i = 0; i < L - 50; i++) {
    push(queue, next);
    model.push(next++);
    assert.equal(shift(queue), model.shift());
  }
  assert.equal(capacityOf(queue), L);
  // Drain from the back; the buffer stays wrapped yet must shrink.
  while (size(queue) > 100) {
    assert.equal(pop(queue), model.pop());
  }
  assert.ok(capacityOf(queue) <= 8192, `capacity ${capacityOf(queue)} should have shrunk`);
  assert.deepEqual(toArray(queue), model);
  // Still fully functional afterwards.
  unshift(queue, -1);
  push(queue, -2);
  assert.deepEqual(toArray(queue), [-1, ...model, -2]);
});

test("random walks across the shrink threshold (wrapped and unwrapped) match a model", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let s = seed * 2654435761;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return s >>> 0;
    };
    const queue = make<number>();
    // Model: array plus a head offset, so shift is O(1).
    const model: number[] = [];
    let head = 0;
    let next = 0;
    const peak = 10_500 + (rnd() % 20_000);
    while (model.length - head < peak) {
      push(queue, next);
      model.push(next++);
    }
    // Rotate so head sits mid-buffer and the live range wraps.
    for (let i = 0; i < peak; i++) {
      push(queue, next);
      model.push(next++);
      assert.equal(shift(queue), model[head++]);
    }
    while (model.length - head > 20) {
      if ((rnd() & 7) === 0) assert.equal(shift(queue), model[head++]);
      else assert.equal(pop(queue), model.pop());
    }
    assert.deepEqual(toArray(queue), model.slice(head));
    assert.ok(capacityOf(queue) <= 16384);
  }
});

test("shrinks when emptied", () => {
  const queue = make<number>();
  for (let i = 0; i < 40000; i++) push(queue, i);
  for (let i = 0; i < 40000; i++) shift(queue);
  assert.equal(size(queue), 0);
  assert.ok(capacityOf(queue) <= 10000);
  push(queue, 7);
  assert.equal(shift(queue), 7);
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

test("dumpToArray releases a large backing array (G6-3 regression)", () => {
  const queue = make<number>();
  for (let i = 0; i < 1 << 16; i++) push(queue, i);
  assert.ok(capacityOf(queue) > 10000);
  const out = dumpToArray(queue);
  assert.equal(out.length, 1 << 16);
  assert.equal(out[12345], 12345);
  assert.equal(size(queue), 0);
  assert.equal(capacityOf(queue), 4, "backing array reset to initial capacity");
  // Still fully usable after the reset: grow past the reset capacity, wrap.
  for (let i = 0; i < 10; i++) push(queue, i);
  assert.equal(shift(queue), 0);
  unshift(queue, -1);
  assert.equal(pop(queue), 9);
  assert.deepEqual(toArray(queue), [-1, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("dumpToArray keeps a small backing array for reuse", () => {
  const queue = make<number>();
  for (let i = 0; i < 100; i++) push(queue, i);
  const cap = capacityOf(queue);
  dumpToArray(queue);
  assert.equal(capacityOf(queue), cap);
});

test("draining a large queue to empty via shift releases memory", () => {
  const queue = make<number>();
  for (let i = 0; i < 1 << 20; i++) push(queue, i);
  while (size(queue) > 0) shift(queue);
  assert.ok(capacityOf(queue) <= 1 << 14, `capacity ${capacityOf(queue)}`);
});
