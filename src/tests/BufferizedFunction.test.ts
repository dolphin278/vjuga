import * as assert from "node:assert/strict";
import * as timers from "node:timers/promises";
import { make as makeBufferizedFn } from "../BufferizedFunction.js";
import { test } from "node:test";

test("oncePerTick lets us buffer several calls to same function", async () => {
  let called = false;
  const batchedFunction = (args: number[]) => {
    called = true;
    assert.deepEqual(args, [1, 2, 3]);
  };

  const fn = makeBufferizedFn(batchedFunction);
  fn(1);
  fn(2);
  fn(3);

  await timers.setTimeout(0);
  assert.ok(called);
});
