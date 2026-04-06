import { test } from "node:test";
import * as assert from "node:assert/strict";
import { throttle, debounce } from "../TimedFunction.js";

// Node's built-in test runner supports fake timers via MockTimers.
// We use it to avoid real wall-clock delays.

test("throttle: first call fires immediately", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), 100);

  fn(1);
  assert.deepEqual(calls, [1]);
  t.mock.timers.reset();
});

test("throttle: second call within window is dropped", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), 100);

  fn(1);
  fn(2); // within the 100ms window — dropped
  assert.deepEqual(calls, [1]);
  t.mock.timers.reset();
});

test("throttle: call after window fires again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), 100);

  fn(1);
  t.mock.timers.tick(100); // window expires
  fn(2);
  assert.deepEqual(calls, [1, 2]);
  t.mock.timers.reset();
});

test("debounce: call is deferred until quiet period expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), 100);

  fn(1);
  assert.deepEqual(calls, [], "should not fire immediately");
  t.mock.timers.tick(100);
  assert.deepEqual(calls, [1]);
  t.mock.timers.reset();
});

test("debounce: rapid calls collapse to one invocation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), 100);

  fn(1);
  t.mock.timers.tick(50);
  fn(2);
  t.mock.timers.tick(50);
  fn(3);
  // 100ms quiet period hasn't elapsed yet from last call
  assert.deepEqual(calls, []);
  t.mock.timers.tick(100);
  // Only the last call's argument should be used
  assert.deepEqual(calls, [3]);
  t.mock.timers.reset();
});

test("debounce: fires again after a second quiet period", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), 100);

  fn(1);
  t.mock.timers.tick(100);
  fn(2);
  t.mock.timers.tick(100);
  assert.deepEqual(calls, [1, 2]);
  t.mock.timers.reset();
});
