import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PQ from "../PriorityQueue.js";

const numCmp: PQ.Comparator<number> = (a, b) => a - b;

test("make() creates an empty heap", () => {
  const pq = PQ.make(numCmp);
  assert.equal(PQ.size(pq), 0);
  assert.equal(PQ.peek(pq), void 0);
  assert.equal(PQ.pop(pq), void 0);
});

test("make() with initial items heapifies correctly", () => {
  const pq = PQ.make(numCmp, [5, 1, 3, 2, 4]);
  assert.equal(PQ.size(pq), 5);
  assert.equal(PQ.peek(pq), 1);
});

test("push + pop extracts elements in ascending order (min-heap)", () => {
  const pq = PQ.make(numCmp);
  PQ.push(pq, 5);
  PQ.push(pq, 1);
  PQ.push(pq, 3);
  PQ.push(pq, 2);
  PQ.push(pq, 4);

  assert.equal(PQ.pop(pq), 1);
  assert.equal(PQ.pop(pq), 2);
  assert.equal(PQ.pop(pq), 3);
  assert.equal(PQ.pop(pq), 4);
  assert.equal(PQ.pop(pq), 5);
  assert.equal(PQ.pop(pq), void 0);
});

test("peek returns minimum without removing it", () => {
  const pq = PQ.make(numCmp, [10, 3, 7]);
  assert.equal(PQ.peek(pq), 3);
  assert.equal(PQ.size(pq), 3, "peek must not mutate");
  assert.equal(PQ.peek(pq), 3);
});

test("size tracks element count correctly", () => {
  const pq = PQ.make(numCmp);
  assert.equal(PQ.size(pq), 0);
  PQ.push(pq, 1);
  assert.equal(PQ.size(pq), 1);
  PQ.push(pq, 2);
  assert.equal(PQ.size(pq), 2);
  PQ.pop(pq);
  assert.equal(PQ.size(pq), 1);
  PQ.pop(pq);
  assert.equal(PQ.size(pq), 0);
});

test("heapify replaces existing contents", () => {
  const pq = PQ.make(numCmp, [10, 20, 30]);
  PQ.heapify(pq, [5, 2, 8]);
  assert.equal(PQ.size(pq), 3);
  assert.equal(PQ.pop(pq), 2);
  assert.equal(PQ.pop(pq), 5);
  assert.equal(PQ.pop(pq), 8);
});

test("custom comparator — max-heap", () => {
  const maxCmp: PQ.Comparator<number> = (a, b) => b - a;
  const pq = PQ.make(maxCmp);
  PQ.push(pq, 1);
  PQ.push(pq, 5);
  PQ.push(pq, 3);
  assert.equal(PQ.pop(pq), 5);
  assert.equal(PQ.pop(pq), 3);
  assert.equal(PQ.pop(pq), 1);
});

test("custom comparator — string lexicographic", () => {
  const strCmp: PQ.Comparator<string> = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // Include a duplicate ("apple" twice) so strCmp returns 0, covering all three ternary branches.
  const pq = PQ.make(strCmp, ["banana", "apple", "cherry", "apple"]);
  assert.equal(PQ.pop(pq), "apple");
  assert.equal(PQ.pop(pq), "apple");
  assert.equal(PQ.pop(pq), "banana");
  assert.equal(PQ.pop(pq), "cherry");
});

test("heap of 1 element", () => {
  const pq = PQ.make(numCmp);
  PQ.push(pq, 42);
  assert.equal(PQ.peek(pq), 42);
  assert.equal(PQ.pop(pq), 42);
  assert.equal(PQ.size(pq), 0);
});

test("duplicate values are handled correctly", () => {
  const pq = PQ.make(numCmp);
  PQ.push(pq, 3);
  PQ.push(pq, 3);
  PQ.push(pq, 1);
  PQ.push(pq, 1);
  assert.equal(PQ.pop(pq), 1);
  assert.equal(PQ.pop(pq), 1);
  assert.equal(PQ.pop(pq), 3);
  assert.equal(PQ.pop(pq), 3);
});

test("sort correctness: heapify + pop n times equals sorted array", () => {
  const items = [9, 3, 7, 1, 5, 2, 8, 4, 6, 0];
  const pq = PQ.make(numCmp, items);
  const sorted: number[] = [];
  while (PQ.size(pq) > 0) {
    sorted.push(PQ.pop(pq) as number);
  }
  assert.deepEqual(sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
