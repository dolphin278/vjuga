import { pool, props, propsMap } from "../PromiseUtils.js";
import { setTimeout as sleep, setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";
import * as assert from "node:assert";

test("PromiseUtils.props", async () => {
  const result = await props({
    a: Promise.resolve(1),
    b: Promise.resolve(2),
    c: "asdf",
  });

  assert.deepEqual(result, {
    a: 1,
    b: 2,
    c: "asdf",
  });
});

test("PromiseUtils.propsMap", async () => {
  const map: Map<string, string | Promise<number>> = new Map<string, string | Promise<number>>([
    ["a", Promise.resolve(1)],
    ["b", Promise.resolve(2)],
    ["c", "asdf"],
  ]);

  const result = await propsMap(map);

  assert.deepStrictEqual(
    result,
    new Map<string, string | number>([
      ["a", 1],
      ["b", 2],
      ["c", "asdf"],
    ]),
  );
});

test("PromiseUtils.props ignores inherited keys and includes own symbol keys", async () => {
  const sym = Symbol("s");
  const proto = { inherited: Promise.resolve(0) };
  const obj = Object.create(proto) as Record<string | symbol, unknown>;
  obj.a = Promise.resolve(1);
  obj[sym] = Promise.resolve(2);
  Object.defineProperty(obj, "hidden", { value: 3, enumerable: false });

  const result = (await props(obj)) as Record<string | symbol, unknown>;
  assert.equal(result.a, 1);
  assert.equal(result[sym], 2);
  assert.equal("inherited" in result, false);
  assert.equal("hidden" in result, false);
  assert.equal(Object.getPrototypeOf(result), null);
});

// ---------------------------------------------------------------------------
// pool
// ---------------------------------------------------------------------------

test("pool: burst of N > K calls never exceeds K in flight; results in input order", async () => {
  const N = 40;
  const K = 4;
  let active = 0;
  let maxActive = 0;
  const started: number[] = [];
  const results = await pool(
    Array.from({ length: N }, (_, i) => i),
    K,
    async (item, index) => {
      started.push(index);
      active++;
      maxActive = Math.max(maxActive, active);
      // Out-of-order completion: later items often finish first.
      await sleep((N - item) % 5);
      active--;
      return item * 10;
    },
  );
  assert.equal(maxActive, K);
  assert.deepEqual(
    started,
    Array.from({ length: N }, (_, i) => i),
  );
  assert.deepEqual(
    results,
    Array.from({ length: N }, (_, i) => ({ status: "fulfilled", value: i * 10 })),
  );
});

test("pool: rejections and synchronous throws mark only that item; pool continues", async () => {
  const results = await pool([0, 1, 2, 3], 2, (x) => {
    if (x === 1) throw new Error("sync");
    if (x === 2) return Promise.reject(new Error("async"));
    return x;
  });
  assert.deepEqual(results[0], { status: "fulfilled", value: 0 });
  assert.equal(results[1].status, "rejected");
  assert.equal(((results[1] as PromiseRejectedResult).reason as Error).message, "sync");
  assert.equal(((results[2] as PromiseRejectedResult).reason as Error).message, "async");
  assert.deepEqual(results[3], { status: "fulfilled", value: 3 });
});

test("pool: a long run of synchronous throws with limit 1 loops (no recursion)", async () => {
  const N = 200_000;
  const results = await pool(
    Array.from({ length: N }, () => 0),
    1,
    () => {
      throw 1;
    },
  );
  assert.equal(results.length, N);
  assert.ok(results.every((r) => r.status === "rejected" && r.reason === 1));
});

test("pool: empty input and arbitrary iterables", async () => {
  assert.deepEqual(await pool([], 3, (x: number) => x), []);
  function* gen() {
    yield "a";
    yield "b";
  }
  assert.deepEqual(await pool(gen(), Infinity, (s, i) => `${s}${i}`), [
    { status: "fulfilled", value: "a0" },
    { status: "fulfilled", value: "b1" },
  ]);
  assert.deepEqual(await pool(new Set([1, 2]), 1, (x) => Promise.resolve(x + 1)), [
    { status: "fulfilled", value: 2 },
    { status: "fulfilled", value: 3 },
  ]);
});

test("pool: already-aborted signal starts nothing", async () => {
  const ctrl = new AbortController();
  const reason = new Error("stop");
  ctrl.abort(reason);
  let calls = 0;
  const results = await pool([1, 2, 3], 2, () => ++calls, { signal: ctrl.signal });
  assert.equal(calls, 0);
  assert.deepEqual(results, [
    { status: "rejected", reason },
    { status: "rejected", reason },
    { status: "rejected", reason },
  ]);
});

test("pool: abort during the run stops new starts; in-flight results are recorded", async () => {
  const ctrl = new AbortController();
  const started: number[] = [];
  const results = await pool(
    [0, 1, 2, 3, 4, 5],
    2,
    async (x, _i, signal) => {
      assert.equal(signal, ctrl.signal);
      started.push(x);
      if (x === 2) ctrl.abort("budget");
      await tick();
      return x;
    },
    { signal: ctrl.signal },
  );
  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(results, [
    { status: "fulfilled", value: 0 },
    { status: "fulfilled", value: 1 },
    { status: "fulfilled", value: 2 },
    { status: "rejected", reason: "budget" },
    { status: "rejected", reason: "budget" },
    { status: "rejected", reason: "budget" },
  ]);
});

test("pool: abort from inside fn during the initial fill stops later starts", async () => {
  const ctrl = new AbortController();
  const started: number[] = [];
  const results = await pool(
    [0, 1, 2, 3],
    Infinity,
    (x) => {
      started.push(x);
      if (x === 1) ctrl.abort("now");
      return x;
    },
    { signal: ctrl.signal },
  );
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "fulfilled", "rejected", "rejected"],
  );
});

test("pool: fn receives undefined signal when none given", async () => {
  const results = await pool([1], 1, (_x, _i, signal) => signal);
  assert.deepEqual(results, [{ status: "fulfilled", value: undefined }]);
});

test("pool: invalid arguments reject, never throw synchronously", async () => {
  for (const limit of [0, -1, 1.5, NaN, -Infinity]) {
    const p = pool([1], limit, (x) => x);
    await assert.rejects(p, RangeError);
  }
  await assert.rejects(
    pool([1], 0, (x) => x),
    /limit must be an integer >= 1 or Infinity, got 0/,
  );
  await assert.rejects(pool([1], 1, "nope" as never), TypeError);
  await assert.rejects(
    pool(42 as never, 1, (x) => x),
    TypeError,
  );
  function* boom(): Generator<number> {
    yield 1;
    throw new Error("iter");
  }
  await assert.rejects(
    pool(boom(), 1, (x) => x),
    /iter/,
  );
});
