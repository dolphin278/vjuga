import { test } from "node:test";
import * as assert from "node:assert/strict";
import { throttle, debounce } from "../TimedFunction.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Use a short window so tests complete quickly without fake timers.
const W = 30; // ms — quiet window
const TICK = W + 10; // ms — enough to expire the window

test("throttle: first call fires immediately", async () => {
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), W);

  fn(1);
  assert.deepEqual(calls, [1]);
  await sleep(TICK); // let timer expire so next test starts clean
});

test("throttle: second call within window is dropped", async () => {
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), W);

  fn(1);
  fn(2); // within the window — dropped
  assert.deepEqual(calls, [1]);
  await sleep(TICK);
});

test("throttle: call after window fires again", async () => {
  const calls: number[] = [];
  const fn = throttle((x: number) => calls.push(x), W);

  fn(1);
  await sleep(TICK); // window expires
  fn(2);
  assert.deepEqual(calls, [1, 2]);
  await sleep(TICK);
});

test("debounce: call is deferred until quiet period expires", async () => {
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), W);

  fn(1);
  assert.deepEqual(calls, [], "should not fire immediately");
  await sleep(TICK);
  assert.deepEqual(calls, [1]);
});

test("debounce: rapid calls collapse to one invocation", async () => {
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), W);

  fn(1);
  await sleep(W / 2);
  fn(2);
  await sleep(W / 2);
  fn(3);
  // quiet period hasn't elapsed yet from last call
  assert.deepEqual(calls, []);
  await sleep(TICK);
  // only the last call's argument should be used
  assert.deepEqual(calls, [3]);
});

test("debounce: fires again after a second quiet period", async () => {
  const calls: number[] = [];
  const fn = debounce((x: number) => calls.push(x), W);

  fn(1);
  await sleep(TICK);
  fn(2);
  await sleep(TICK);
  assert.deepEqual(calls, [1, 2]);
});

test("throttle: re-entrant call from fn is dropped", async () => {
  let calls = 0;
  const fn: () => void = throttle(() => {
    calls++;
    if (calls < 10) fn();
  }, W);
  fn();
  assert.equal(calls, 1);
  await sleep(TICK);
});

test("throttle: throwing fn still starts the window", async () => {
  let calls = 0;
  const fn = throttle(() => {
    calls++;
    throw new Error("boom");
  }, W);
  assert.throws(() => fn(), /boom/);
  fn(); // within window - dropped, not re-invoked
  assert.equal(calls, 1);
  await sleep(TICK);
  assert.throws(() => fn(), /boom/);
  assert.equal(calls, 2);
  await sleep(TICK);
});

test("G7-3: ms outside [0, 2^31-1] (or NaN) throws RangeError at construction", () => {
  const bad = [NaN, -1, -Infinity, Infinity, 2 ** 31, 1e12];
  for (const ms of bad) {
    assert.throws(() => throttle(() => {}, ms), RangeError);
    assert.throws(() => debounce(() => {}, ms), RangeError);
  }
});

test("G7-3: boundary delays 0, fractional and 2^31-1 are accepted", () => {
  // Construction only: calling would arm a timer that keeps the process alive.
  for (const ms of [0, 0.5, 2 ** 31 - 1]) {
    assert.equal(typeof throttle(() => {}, ms), "function");
    assert.equal(typeof debounce(() => {}, ms), "function");
  }
});
