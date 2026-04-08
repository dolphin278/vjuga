import { test } from "node:test";
import * as SOA from "../SOA.js";
import * as assert from "node:assert/strict";

test("SOA-push", () => {
  const soa: { x: number[]; y: number[] } = {
    x: [],
    y: [],
  };

  SOA.push(soa, { x: 1, y: 2 });
  SOA.push(soa, { x: 3, y: 4 });
  SOA.push(soa, { x: 5, y: 6 });

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });
});

test("SOA-pop", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const { x, y } = SOA.pop(soa);

  assert.deepEqual(soa, {
    x: [1, 3],
    y: [2, 4],
  });

  assert.deepEqual({ x, y }, { x: 5, y: 6 });
});

test("SOA-get", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const { x, y } = SOA.get(soa, 1);

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.deepEqual({ x, y }, { x: 3, y: 4 });
});

test("SOA-set", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  SOA.set(soa, 1, { x: 7, y: 8 });

  assert.deepEqual(soa, {
    x: [1, 7, 5],
    y: [2, 8, 6],
  });
});

test("SOA-getSlice", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const x = SOA.getSlice(soa, "x");

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.deepEqual(x, [1, 3, 5]);
});

test("SOA-createView", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const view = SOA.createView(soa, 1);

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.equal(view.x, 3);
  assert.equal(view.y, 4);
  assert.equal(view.index, 1);

  view.x = 7;
  view.y = 8;

  assert.deepEqual(soa, {
    x: [1, 7, 5],
    y: [2, 8, 6],
  });

  view.index = 2;

  assert.equal(view.x, 5);
  assert.equal(view.y, 6);
});

test("SOA-length", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  assert.equal(SOA.length(soa), 3);

  SOA.push(soa, { x: 7, y: 8 });
  assert.equal(SOA.length(soa), 4);
});

test("SOA-length on empty SOA", () => {
  const soa = { x: [] as number[], y: [] as number[] };
  assert.equal(SOA.length(soa), 0);
});

test("SOA-length on SOA with no keys", () => {
  const soa = {} as SOA.SOA<Record<never, never>>;
  assert.equal(SOA.length(soa), 0);
});

test("SOA-swapRemove removes middle element with O(1) swap", () => {
  const soa = { x: [1, 2, 3, 4], y: [10, 20, 30, 40] };
  SOA.swapRemove(soa, 1); // remove index 1; last element (index 3) moves to index 1
  assert.equal(SOA.length(soa), 3);
  assert.deepEqual(soa.x, [1, 4, 3]);
  assert.deepEqual(soa.y, [10, 40, 30]);
});

test("SOA-swapRemove removes last element without swapping", () => {
  const soa = { x: [1, 2, 3], y: [10, 20, 30] };
  SOA.swapRemove(soa, 2);
  assert.equal(SOA.length(soa), 2);
  assert.deepEqual(soa.x, [1, 2]);
  assert.deepEqual(soa.y, [10, 20]);
});

test("SOA-swapRemove removes single element", () => {
  const soa = { x: [99], y: [42] };
  SOA.swapRemove(soa, 0);
  assert.equal(SOA.length(soa), 0);
});

test("SOA-swapRemove throws RangeError for out-of-bounds index", () => {
  const soa = { x: [1, 2], y: [3, 4] };
  assert.throws(() => SOA.swapRemove(soa, 5), RangeError);
  assert.throws(() => SOA.swapRemove(soa, -1), RangeError);
});

test("SOA-createView descriptor cache hit (second view reuses cached descriptors)", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  const view1 = SOA.createView(soa, 0);
  const view2 = SOA.createView(soa, 2); // second call → descriptor cache is hit
  assert.equal(view1.x, 1);
  assert.equal(view2.x, 3);
  view2.y = 99;
  assert.equal(soa.y[2], 99);
});

test("SOA-clear empties all slices", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  SOA.clear(soa);
  assert.equal(SOA.length(soa), 0);
  assert.deepEqual(soa.x, []);
  assert.deepEqual(soa.y, []);
});
