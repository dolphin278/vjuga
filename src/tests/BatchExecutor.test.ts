import * as assert from "node:assert";
import { test } from "node:test";
import {
  setTimeout as setTimeoutPromise,
  setImmediate as setImmediatePromise,
} from "node:timers/promises";
import { make } from "../BatchExecutor.js";

test("BatchExecutor batches function invocation and delivers corresponding results", async () => {
  let invocationArgs: number[][] = [];

  const fn = (args: number[]) => {
    invocationArgs.push(args);
    return Promise.resolve(
      args.map((arg) => ({
        status: "fulfilled" as const,
        value: arg * 2,
      })),
    );
  };

  const batchExecutor = make(fn);

  const result1 = Promise.all([batchExecutor(1), batchExecutor(2), batchExecutor(3)]);

  await setTimeoutPromise();
  const result2 = Promise.all([batchExecutor(4), batchExecutor(5)]);
  const result = [...(await result1), ...(await result2)];

  assert.deepEqual(result, [2, 4, 6, 8, 10], "Batched function returns correct results");

  assert.deepEqual(
    invocationArgs,
    [
      [1, 2, 3],
      [4, 5],
    ],
    "Batched function is invoked with correct arguments in two batches",
  );
});

test("When nested functions returns array of different length, we throw an error", async () => {
  const fn = async (args: number[]): Promise<PromiseSettledResult<number>[]> =>
    [...args, 1].map((x) => ({
      status: "fulfilled",
      value: x,
    }));
  let wasThrown = false;
  const batchExecutor = make(fn);
  /* node:coverage disable */
  try {
    await batchExecutor(1);
  } catch (err) {
    /* node:coverage enable */
    wasThrown = true;
    assert.ok(err instanceof Error, "Expected error to be an instance of Error");
    assert.equal(
      err.message,
      "BatchExecutor: fn returned 2 results, but expected 1",
      "Error message is correct",
    );
  }
  assert.ok(wasThrown, "Error was thrown");
});

test("batch function may trigger rejections on individual results", async () => {
  const fn = make(async (args: number[]) =>
    args.map((arg) =>
      arg === 1
        ? { status: "rejected" as const, reason: new Error("test") }
        : { status: "fulfilled" as const, value: arg },
    ),
  );

  const results = await Promise.allSettled([fn(2), fn(3), fn(1)]);

  assert.equal(results[0].status, "fulfilled", "First result is rejected");
  assert.equal(results[1].status, "fulfilled", "First result is rejected");
  assert.equal(results[2].status, "rejected", "First result is rejected");
});

test("io schedule mode: batches via setImmediate with lower latency", async () => {
  let invocationArgs: number[][] = [];

  const fn = (args: number[]) => {
    invocationArgs.push(args);
    return Promise.resolve(
      args.map((arg) => ({
        status: "fulfilled" as const,
        value: arg * 3,
      })),
    );
  };

  const batchExecutor = make(fn, "io");

  const result1 = Promise.all([batchExecutor(1), batchExecutor(2), batchExecutor(3)]);

  await setImmediatePromise();
  const result2 = Promise.all([batchExecutor(4), batchExecutor(5)]);
  const result = [...(await result1), ...(await result2)];

  assert.deepEqual(result, [3, 6, 9, 12, 15]);
  assert.deepEqual(invocationArgs, [
    [1, 2, 3],
    [4, 5],
  ]);
});

test("2000 concurrent calls in one batch all resolve (no in-flight limit, no sync throw)", async () => {
  const batches: number[] = [];
  const fn = make(async (args: number[]) => {
    batches.push(args.length);
    return args.map((v) => ({ status: "fulfilled" as const, value: v + 1 }));
  });
  const promises: Promise<number>[] = [];
  for (let i = 0; i < 2000; i++) promises.push(fn(i));
  const results = await Promise.all(promises);
  assert.equal(results.length, 2000);
  assert.equal(results[1999], 2000);
  assert.deepEqual(batches, [2000]);
});

test("batch function that rejects rejects every promise", async () => {
  const fn = make<number, number>(async () => {
    throw new Error("down");
  });
  const results = await Promise.allSettled([fn(1), fn(2)]);
  assert.ok(results.every((r) => r.status === "rejected"));
});

// ---------------------------------------------------------------------------
// Options: maxBatchSize / maxInFlight
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const echo = (args: number[]): PromiseSettledResult<number>[] =>
  args.map((v) => ({ status: "fulfilled" as const, value: v }));

test("maxInFlight: burst of N > K calls never exceeds K concurrent invocations", async () => {
  const N = 50;
  const K = 3;
  let active = 0;
  let maxActive = 0;
  let invocations = 0;
  const exec = make(
    async (args: number[]) => {
      invocations++;
      active++;
      maxActive = Math.max(maxActive, active);
      await setTimeoutPromise(1);
      active--;
      return args.map((v) => ({ status: "fulfilled" as const, value: v * 2 }));
    },
    { schedule: "io", maxBatchSize: 1, maxInFlight: K },
  );
  const order: number[] = [];
  const promises: Promise<number>[] = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      exec(i).then((v) => {
        order.push(i);
        return v;
      }),
    );
  }
  const results = await Promise.all(promises);
  assert.equal(maxActive, K);
  assert.equal(invocations, N);
  assert.deepEqual(
    results,
    Array.from({ length: N }, (_, i) => i * 2),
  );
  assert.deepEqual(
    order,
    Array.from({ length: N }, (_, i) => i),
  );
});

test("maxBatchSize splits a tick into chunks of at most that size", async () => {
  const sizes: number[][] = [];
  const exec = make(
    async (args: number[]) => {
      sizes.push(args);
      return echo(args);
    },
    { maxBatchSize: 3 },
  );
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((v) => exec(v)));
  assert.deepEqual(results, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sizes, [[1, 2, 3], [4, 5, 6], [7]]);
});

test("maxBatchSize: a tick at or below the limit is one chunk", async () => {
  const sizes: number[][] = [];
  const exec = make(
    async (args: number[]) => {
      sizes.push(args);
      return echo(args);
    },
    { schedule: "io", maxBatchSize: 3, maxInFlight: Infinity },
  );
  await Promise.all([exec(1), exec(2), exec(3)]);
  assert.deepEqual(sizes, [[1, 2, 3]]);
});

test("maxInFlight: queued items dispatch FIFO across ticks as invocations settle", async () => {
  const calls: { args: number[]; d: Deferred<PromiseSettledResult<number>[]> }[] = [];
  const exec = make(
    (args: number[]) => {
      const d = deferred<PromiseSettledResult<number>[]>();
      calls.push({ args, d });
      return d.promise;
    },
    { schedule: "io", maxBatchSize: 2, maxInFlight: 1 },
  );
  const tick1 = [exec(1), exec(2), exec(3)];
  await setImmediatePromise();
  const tick2 = [exec(4), exec(5)];
  await setImmediatePromise();
  // Only the first chunk is in flight; 3 (tick 1) and 4, 5 (tick 2) queue.
  assert.deepEqual(
    calls.map((c) => c.args),
    [[1, 2]],
  );
  calls[0].d.resolve(echo([1, 2]));
  await setImmediatePromise();
  // Queued items from two ticks coalesce into one full chunk, FIFO.
  assert.deepEqual(
    calls.map((c) => c.args),
    [
      [1, 2],
      [3, 4],
    ],
  );
  calls[1].d.resolve(echo([3, 4]));
  await setImmediatePromise();
  assert.deepEqual(
    calls.map((c) => c.args),
    [[1, 2], [3, 4], [5]],
  );
  calls[2].d.resolve(echo([5]));
  assert.deepEqual(await Promise.all([...tick1, ...tick2]), [1, 2, 3, 4, 5]);
});

test("maxInFlight: callers spread over many ticks still batch under backpressure", async () => {
  const sizes: number[] = [];
  const exec = make(
    async (args: number[]) => {
      sizes.push(args.length);
      await setTimeoutPromise(20);
      return echo(args);
    },
    { schedule: "io", maxBatchSize: 100, maxInFlight: 1 },
  );
  const promises: Promise<number>[] = [];
  for (let i = 0; i < 50; i++) {
    promises.push(exec(i));
    await setImmediatePromise();
  }
  assert.deepEqual(
    await Promise.all(promises),
    Array.from({ length: 50 }, (_, i) => i),
  );
  assert.equal(
    sizes.reduce((a, b) => a + b, 0),
    50,
  );
  assert.ok(sizes.length <= 5, `expected coalesced chunks, got sizes ${String(sizes)}`);
});

test("failure of one chunk rejects only that chunk's items", async () => {
  let call = 0;
  const exec = make(
    async (args: number[]): Promise<PromiseSettledResult<number>[]> => {
      call++;
      if (call === 1) throw new Error("chunk 1 down");
      if (call === 2) return [...echo(args), ...echo(args)]; // length mismatch
      return echo(args);
    },
    { maxBatchSize: 2, maxInFlight: 1 },
  );
  const results = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((v) => exec(v)));
  const reasons = results.map((r) =>
    r.status === "rejected" ? (r.reason as Error).message : r.value,
  );
  assert.deepEqual(reasons, [
    "chunk 1 down",
    "chunk 1 down",
    "BatchExecutor: fn returned 4 results, but expected 2",
    "BatchExecutor: fn returned 4 results, but expected 2",
    5,
    6,
  ]);
});

test("synchronous throw in fn rejects its chunk, frees the slot, queue continues", async () => {
  let call = 0;
  const exec = make(
    (args: number[]): Promise<PromiseSettledResult<number>[]> => {
      call++;
      if (call === 1) throw new Error("sync");
      return Promise.resolve(echo(args));
    },
    { schedule: "io", maxBatchSize: 1, maxInFlight: 1 },
  );
  const results = await Promise.allSettled([exec(1), exec(2), exec(3)]);
  assert.equal(results[0].status, "rejected");
  assert.equal(((results[0] as PromiseRejectedResult).reason as Error).message, "sync");
  assert.deepEqual(
    results.slice(1).map((r) => (r as PromiseFulfilledResult<number>).value),
    [2, 3],
  );
});

test("per-item rejections still route individually on the limited path", async () => {
  const exec = make(
    async (args: number[]) =>
      args.map((v) =>
        v % 2 === 0
          ? { status: "fulfilled" as const, value: v }
          : { status: "rejected" as const, reason: v },
      ),
    { maxInFlight: 2 },
  );
  const results = await Promise.allSettled([exec(1), exec(2)]);
  assert.deepEqual(results, [
    { status: "rejected", reason: 1 },
    { status: "fulfilled", value: 2 },
  ]);
});

test("object options without limits (and null) use the unlimited path", async () => {
  for (const opts of [{}, { schedule: "io" as const }, { maxInFlight: Infinity }, null]) {
    const batches: number[][] = [];
    const exec = make(async (args: number[]) => {
      batches.push(args);
      return echo(args);
    }, opts as never);
    assert.deepEqual(await Promise.all([exec(1), exec(2), exec(3)]), [1, 2, 3]);
    assert.deepEqual(batches, [[1, 2, 3]]);
  }
});

test("options validation: non-integer, < 1 or NaN limits throw RangeError at make()", () => {
  const bad = [0, -1, 1.5, NaN, -Infinity, "2" as unknown as number];
  for (const v of bad) {
    assert.throws(() => make(async (a: number[]) => echo(a), { maxBatchSize: v }), RangeError);
    assert.throws(() => make(async (a: number[]) => echo(a), { maxInFlight: v }), RangeError);
  }
  assert.throws(
    () => make(async (a: number[]) => echo(a), { maxInFlight: 0 }),
    /maxInFlight must be an integer >= 1 or Infinity, got 0/,
  );
});
