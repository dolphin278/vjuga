import * as assert from "node:assert/strict";
import * as timers from "node:timers/promises";
import { make as makeBufferizedFn } from "../BufferizedFunction.js";
import { test } from "node:test";

test("macrotask mode: buffers several calls to same function", async () => {
  let callCount = 0;
  const batchedFunction = (args: number[]) => {
    callCount++;
    assert.deepEqual(args, [1, 2, 3]);
  };

  const fn = makeBufferizedFn(batchedFunction);
  fn(1);
  fn(2);
  fn(3);

  await timers.setTimeout(0);
  assert.equal(callCount, 1);
});

test("io mode: buffers calls and fires via setImmediate", async () => {
  let callCount = 0;
  let receivedArgs: number[] = [];
  const batchedFunction = (args: number[]) => {
    callCount++;
    receivedArgs = args;
  };

  const fn = makeBufferizedFn(batchedFunction, "io");
  fn(1);
  fn(2);
  fn(3);

  await timers.setImmediate();
  assert.equal(callCount, 1);
  assert.deepEqual(receivedArgs, [1, 2, 3]);
});

test("io mode: separate batches across setImmediate boundaries", async () => {
  const batches: number[][] = [];
  const fn = makeBufferizedFn((args: number[]) => {
    batches.push(args);
  }, "io");

  fn(1);
  fn(2);
  await timers.setImmediate();

  fn(3);
  fn(4);
  await timers.setImmediate();

  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], [1, 2]);
  assert.deepEqual(batches[1], [3, 4]);
});
