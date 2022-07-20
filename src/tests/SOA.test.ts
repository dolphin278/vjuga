import { test } from "node:test";
import * as SOA from "../SOA.js";
import * as assert from "node:assert/strict";

test("SOA-push", () => {
  const soa = {
    x: [] as number[],
    y: [] as number[],
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
