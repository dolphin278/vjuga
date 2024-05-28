import * as assert from "node:assert";
import { test } from "node:test";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { make } from "../BatchExecutor.js";

test("BatchExecutor batches function invocation and delivers corresponding results", async (t) => {
  /**
   * @type {number[][]}
   */
  let invocationArgs = [];

  /**
   * @param {number[]} args
   */
  const fn = (args) => {
    invocationArgs.push(args);
    return Promise.resolve(
      args.map((arg) => ({
        status: /** @type {const} */ ("fulfilled"),
        value: arg * 2,
      }))
    );
  };

  const batchExecutor = make(fn);

  const result1 = Promise.all([
    batchExecutor(1),
    batchExecutor(2),
    batchExecutor(3),
  ]);

  await setTimeoutPromise();
  const result2 = Promise.all([batchExecutor(4), batchExecutor(5)]);
  const result = [...(await result1), ...(await result2)];

  assert.deepEqual(
    result,
    [2, 4, 6, 8, 10],
    "Batched function returns correct results"
  );

  assert.deepEqual(
    invocationArgs,
    [
      [1, 2, 3],
      [4, 5],
    ],
    "Batched function is invoked with correct arguments in two batches"
  );
});

test("When nested functions returns array of different length, we throw an error", async () => {
  /**
   *
   * @param {number[]} args
   * @returns {Promise<PromiseSettledResult<number>[]>}
   */
  const fn = async (args) =>
    [...args, 1].map((x) => ({
      status: "fulfilled",
      value: x,
    }));
  let wasThrown = false;
  const batchExecutor = make(fn);
  try {
    await batchExecutor(1);
  } catch (err) {
    wasThrown = true;
    if (!(err instanceof Error)) {
      throw new Error("Expected error to be an instance of Error");
    }
    assert.equal(
      err.message,
      "BatchExecutor: fn returned 2 results, but expected 1",
      "Error message is correct"
    );
  }
  assert.ok(wasThrown, "Error was thrown");
});

test("batch function may trigger rejections on individual results", async () => {
  const fn = make(async (args) =>
    args.map((arg) =>
      arg === 1
        ? { status: "rejected", reason: new Error("test") }
        : { status: "fulfilled", value: arg }
    )
  );

  const results = await Promise.allSettled([fn(2), fn(3), fn(1)]);

  assert.equal(results[0].status, "fulfilled", "First result is rejected");
  assert.equal(results[1].status, "fulfilled", "First result is rejected");
  assert.equal(results[2].status, "rejected", "First result is rejected");
});
