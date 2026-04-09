import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import * as WP from "../WorkerPool.js";
import { WorkerPoolDestroyedError, WorkerExitError } from "../WorkerPool.js";

// ---------------------------------------------------------------------------
// data: URL handlers (no fixture files needed)
// ---------------------------------------------------------------------------

const echoUrl = "data:text/javascript," + encodeURIComponent("export default (x) => x;");
const doubleUrl = "data:text/javascript," + encodeURIComponent("export default (x) => x * 2;");
const throwUrl =
  "data:text/javascript," +
  encodeURIComponent(
    'export default () => { const cause = new TypeError("root"); cause.code = 42; throw new Error("boom", { cause }); };',
  );
const slowUrl =
  "data:text/javascript," +
  encodeURIComponent('export default (ms) => new Promise(r => setTimeout(r, ms, "done"));');

// ---------------------------------------------------------------------------
// make()
// ---------------------------------------------------------------------------

describe("make()", () => {
  test("defaults — minThreads=0, maxThreads=availableParallelism", async () => {
    const pool = WP.make({ filename: echoUrl });
    assert.equal(WP.activeCount(pool), 0);
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
  });

  test("with explicit config — minThreads=2 pre-spawns workers", async () => {
    const pool = WP.make({ filename: echoUrl, minThreads: 2, maxThreads: 4 });
    // Give workers time to spawn and send READY.
    await sleep(200);
    // Run two tasks — they should use pre-spawned workers, not spawn new ones.
    const [a, b] = await Promise.all([WP.run(pool, 1), WP.run(pool, 2)]);
    assert.equal(a, 1);
    assert.equal(b, 2);
    await WP.destroy(pool);
  });

  test("validation — minThreads > maxThreads throws RangeError", () => {
    assert.throws(() => WP.make({ filename: echoUrl, minThreads: 5, maxThreads: 2 }), RangeError);
  });

  test("validation — maxThreads=0 throws RangeError", () => {
    assert.throws(() => WP.make({ filename: echoUrl, maxThreads: 0 }), RangeError);
  });

  test("validation — non-integer maxThreads throws RangeError", () => {
    assert.throws(() => WP.make({ filename: echoUrl, maxThreads: 1.5 }), RangeError);
  });

  test("validation — negative minThreads throws RangeError", () => {
    assert.throws(() => WP.make({ filename: echoUrl, minThreads: -1 }), RangeError);
  });

  test("accepts URL object for filename", async () => {
    const pool = WP.make({
      filename: new URL(echoUrl),
      maxThreads: 1,
    });
    const result = await WP.run(pool, "url-test");
    assert.equal(result, "url-test");
    await WP.destroy(pool);
  });
});

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

describe("run()", () => {
  test("basic echo", async () => {
    const pool = WP.make<string, string>({ filename: echoUrl, maxThreads: 1 });
    const result = await WP.run(pool, "hello");
    assert.equal(result, "hello");
    await WP.destroy(pool);
  });

  test("doubles a number", async () => {
    const pool = WP.make<number, number>({ filename: doubleUrl, maxThreads: 1 });
    const result = await WP.run(pool, 21);
    assert.equal(result, 42);
    await WP.destroy(pool);
  });

  test("multiple parallel tasks dispatched across workers", async () => {
    const pool = WP.make<number, number>({ filename: echoUrl, maxThreads: 4 });
    const results = await Promise.all([
      WP.run(pool, 1),
      WP.run(pool, 2),
      WP.run(pool, 3),
      WP.run(pool, 4),
    ]);
    assert.deepEqual(results.sort(), [1, 2, 3, 4]);
    await WP.destroy(pool);
  });

  test("queuing — maxThreads=1, tasks execute sequentially", async () => {
    const pool = WP.make<number, number>({ filename: echoUrl, maxThreads: 1 });
    const results = await Promise.all([WP.run(pool, 1), WP.run(pool, 2), WP.run(pool, 3)]);
    assert.deepEqual(results, [1, 2, 3]);
    await WP.destroy(pool);
  });

  test("priority ordering — lower priority number dispatched first", async () => {
    const pool = WP.make<number, number>({ filename: echoUrl, maxThreads: 1 });
    // Submit first task to occupy the worker.
    const first = WP.run(pool, 0);
    // While first is running, submit tasks with varying priorities.
    const low = WP.run(pool, 3, { priority: 10 });
    const high = WP.run(pool, 1, { priority: 1 });
    const mid = WP.run(pool, 2, { priority: 5 });
    await first;
    // Now the queued tasks execute in priority order.
    const results: number[] = [];
    results.push(await high);
    results.push(await mid);
    results.push(await low);
    assert.deepEqual(results, [1, 2, 3]);
    await WP.destroy(pool);
  });

  test("non-zero priority goes through PQ and tryDispatch idle path", async () => {
    const pool = WP.make<number, number>({ filename: echoUrl, minThreads: 1, maxThreads: 2 });
    await sleep(200); // Let minThreads worker become ready+idle.
    // Non-zero priority forces the PQ path. Idle worker is found by tryDispatch.
    const result = await WP.run(pool, 42, { priority: 5 });
    assert.equal(result, 42);
    await WP.destroy(pool);
  });

  test("non-zero priority spawns new worker via tryDispatch", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, minThreads: 0, maxThreads: 2 });
    // Submit a default-priority task to occupy the first worker (fast path).
    const p1 = WP.run(pool, 200);
    // Submit a non-zero priority task — no idle workers, so tryDispatch spawns a new one.
    const p2 = WP.run(pool, 50, { priority: 3 });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, "done");
    assert.equal(r2, "done");
    await WP.destroy(pool);
  });

  test("on destroyed pool — rejects with WorkerPoolDestroyedError", async () => {
    const pool = WP.make({ filename: echoUrl, maxThreads: 1 });
    await WP.destroy(pool);
    const err = await WP.run(pool, "test").catch((e: unknown) => e);
    assert.ok(err instanceof WorkerPoolDestroyedError);
    assert.equal((err as Error).message, "WorkerPool is destroyed");
  });

  test("with transferList — ArrayBuffer transferred", async () => {
    const transferUrl =
      "data:text/javascript," +
      encodeURIComponent("export default (buf) => { return buf.byteLength; };");
    const pool = WP.make<ArrayBuffer, number>({
      filename: transferUrl,
      maxThreads: 1,
    });
    const buf = new ArrayBuffer(1024);
    const result = await WP.run(pool, buf, { transferList: [buf] });
    assert.equal(result, 1024);
    // After transfer, the original buffer should be detached (byteLength = 0).
    assert.equal(buf.byteLength, 0);
    await WP.destroy(pool);
  });

  test("with pre-aborted AbortSignal — rejects immediately", async () => {
    const pool = WP.make({ filename: echoUrl, maxThreads: 1 });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => WP.run(pool, "test", { signal: controller.signal }), {
      name: "AbortError",
    });
    await WP.destroy(pool);
  });

  test("all queued tasks aborted — dequeueNextValid returns undefined", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    // Occupy the worker.
    const firstPromise = WP.run(pool, 100);
    // Queue multiple tasks, then abort them all before worker finishes.
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = WP.run(pool, 100, { signal: c1.signal }).catch((e: Error) => e);
    const p2 = WP.run(pool, 100, { signal: c2.signal }).catch((e: Error) => e);
    c1.abort();
    c2.abort();
    await p1;
    await p2;
    await firstPromise;
    // When firstPromise finishes, markWorkerIdle calls dequeueNextValid,
    // which skips the aborted tasks and returns undefined.
    await WP.destroy(pool);
  });

  test("with AbortSignal aborted while queued — task skipped", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    // Occupy the worker.
    const firstPromise = WP.run(pool, 100);
    // Queue a task with an abort signal.
    const controller = new AbortController();
    const abortedPromise = WP.run(pool, 100, { signal: controller.signal });
    // Abort while queued.
    controller.abort();
    await assert.rejects(() => abortedPromise, { name: "AbortError" });
    await firstPromise;
    await WP.destroy(pool);
  });

  test("with AbortSignal aborted while in-flight — promise rejected", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const controller = new AbortController();
    const promise = WP.run(pool, 500, { signal: controller.signal });
    // Give the task time to start.
    await sleep(50);
    controller.abort();
    await assert.rejects(() => promise, { name: "AbortError" });
    await WP.destroy(pool);
  });
});

// ---------------------------------------------------------------------------
// Error forwarding
// ---------------------------------------------------------------------------

describe("error forwarding", () => {
  test("cause chain preserved, custom properties preserved", async () => {
    const pool = WP.make({ filename: throwUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "boom");
    assert.ok(err.cause instanceof Error);
    assert.equal(err.cause.message, "root");
    assert.equal(err.cause.name, "TypeError");
    // Custom property on the cause.
    assert.equal((err.cause as unknown as Record<string, unknown>)["code"], 42);
    await WP.destroy(pool);
  });

  test("error with non-Error cause is preserved", async () => {
    const nonErrorCauseUrl =
      "data:text/javascript," +
      encodeURIComponent(
        'export default () => { throw new Error("oops", { cause: "string cause" }); };',
      );
    const pool = WP.make({ filename: nonErrorCauseUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "oops");
    assert.equal(err.cause, "string cause");
    await WP.destroy(pool);
  });

  test("error without cause is deserialized correctly", async () => {
    const noCauseUrl =
      "data:text/javascript," +
      encodeURIComponent('export default () => { throw new Error("no cause"); };');
    const pool = WP.make({ filename: noCauseUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "no cause");
    assert.equal(err.cause, undefined);
    await WP.destroy(pool);
  });

  test("non-Error thrown is serialized", async () => {
    const throwStringUrl =
      "data:text/javascript," +
      encodeURIComponent('export default () => { throw "string error"; };');
    const pool = WP.make({ filename: throwStringUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "string error");
    await WP.destroy(pool);
  });
});

// ---------------------------------------------------------------------------
// activeCount / pendingCount
// ---------------------------------------------------------------------------

describe("activeCount / pendingCount", () => {
  test("correct during execution", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const p1 = WP.run(pool, 200);
    const p2 = WP.run(pool, 200);
    // Give first task time to start.
    await sleep(50);
    // One active (running), one pending (queued).
    assert.equal(WP.activeCount(pool), 1);
    assert.equal(WP.pendingCount(pool), 1);
    await Promise.all([p1, p2]);
    assert.equal(WP.activeCount(pool), 0);
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
  });
});

// ---------------------------------------------------------------------------
// drain()
// ---------------------------------------------------------------------------

describe("drain()", () => {
  test("on empty pool — resolves immediately", async () => {
    const pool = WP.make({ filename: echoUrl, maxThreads: 1 });
    await WP.drain(pool);
    await WP.destroy(pool);
  });

  test("waits for completion", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    WP.run(pool, 100);
    WP.run(pool, 100);
    await WP.drain(pool);
    assert.equal(WP.activeCount(pool), 0);
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
  });

  test("drain resolves after error task completes", async () => {
    const throwOnceUrl =
      "data:text/javascript," +
      encodeURIComponent('export default () => { throw new Error("fail"); };');
    const pool = WP.make({ filename: throwOnceUrl, maxThreads: 1 });
    const errPromise = WP.run(pool, null).catch((e: Error) => e);
    const drainPromise = WP.drain(pool);
    const err = await errPromise;
    assert.ok(err instanceof Error);
    await drainPromise;
    await WP.destroy(pool);
  });

  test("called multiple times — both promises resolve", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    WP.run(pool, 100);
    const d1 = WP.drain(pool);
    const d2 = WP.drain(pool);
    await Promise.all([d1, d2]);
    await WP.destroy(pool);
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe("destroy()", () => {
  test("destroy resolves pending drain", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const task = WP.run(pool, 5000).catch((e: Error) => e);
    await sleep(50);
    // Call drain while task is in-flight.
    const drainPromise = WP.drain(pool);
    // Destroy should resolve the drain.
    await WP.destroy(pool);
    await drainPromise;
    const err = await task;
    assert.ok(err instanceof Error);
  });

  test("rejects queued and in-flight tasks, terminates workers", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const p1 = WP.run(pool, 5000); // in-flight
    const p2 = WP.run(pool, 5000); // queued
    // Attach catch handlers before destroy to avoid unhandled rejection warnings.
    const c1 = p1.catch((e: Error) => e);
    const c2 = p2.catch((e: Error) => e);
    await sleep(50); // Let p1 start.
    await WP.destroy(pool);
    const e1 = await c1;
    const e2 = await c2;
    assert.ok(e1 instanceof WorkerPoolDestroyedError);
    assert.ok(e2 instanceof WorkerPoolDestroyedError);
    assert.match(e1.message, /destroyed/);
    assert.match(e2.message, /destroyed/);
  });
});

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

describe("worker lifecycle", () => {
  test("worker crash recovery — replacement spawned when below minThreads", async () => {
    const crashUrl =
      "data:text/javascript," +
      encodeURIComponent(
        "export default (x) => { if (x === 'crash') process.exit(1); return x; };",
      );
    const pool = WP.make<string, string>({
      filename: crashUrl,
      minThreads: 1,
      maxThreads: 2,
    });
    // Let the initial worker spawn.
    await sleep(200);
    // Crash the worker.
    const crashErr = await WP.run(pool, "crash").catch((e: unknown) => e);
    assert.ok(crashErr instanceof WorkerExitError);
    assert.equal((crashErr as Error).message, "Worker exited unexpectedly");
    // Wait for replacement.
    await sleep(300);
    // Pool should still work with the replacement worker.
    const result = await WP.run(pool, "alive");
    assert.equal(result, "alive");
    await WP.destroy(pool);
  });

  test("idle timeout — worker terminated after idle period when above minThreads", async () => {
    const pool = WP.make<string, string>({
      filename: echoUrl,
      minThreads: 0,
      maxThreads: 2,
      idleTimeout: 100,
    });
    // Run a task to spawn a worker.
    await WP.run(pool, "test");
    // Wait for idle timeout.
    await sleep(300);
    // The worker should have been terminated. Running a new task spawns a fresh one.
    const result = await WP.run(pool, "test2");
    assert.equal(result, "test2");
    await WP.destroy(pool);
  });

  test("dynamic scaling — up to maxThreads under load, down on idle", async () => {
    const pool = WP.make<number, string>({
      filename: slowUrl,
      minThreads: 0,
      maxThreads: 3,
      idleTimeout: 100,
    });
    // Submit 3 slow tasks — should scale to 3 workers.
    const promises = [WP.run(pool, 200), WP.run(pool, 200), WP.run(pool, 200)];
    await sleep(100);
    assert.equal(WP.activeCount(pool), 3);
    await Promise.all(promises);
    // Wait for idle timeout to trim workers.
    await sleep(300);
    await WP.destroy(pool);
  });

  test("idle worker with timer is reused for new task (clears timer)", async () => {
    const pool = WP.make<string, string>({
      filename: echoUrl,
      minThreads: 0,
      maxThreads: 1,
      idleTimeout: 5000, // Long timeout so timer is still running when we submit.
    });
    // Run a task to spawn and idle a worker.
    await WP.run(pool, "first");
    // Worker is now idle with a timer. Submit another task — should reuse idle worker and clear timer.
    const result = await WP.run(pool, "second");
    assert.equal(result, "second");
    await WP.destroy(pool);
  });

  test("transferList via idle worker dispatch path", async () => {
    const transferUrl =
      "data:text/javascript," + encodeURIComponent("export default (buf) => buf.byteLength;");
    const pool = WP.make<ArrayBuffer, number>({
      filename: transferUrl,
      minThreads: 0,
      maxThreads: 1,
    });
    // Run a task first so the worker spawns and becomes idle.
    const buf1 = new ArrayBuffer(64);
    await WP.run(pool, buf1, { transferList: [buf1] });
    // Now the worker is idle — dispatch a transfer task through the idle path.
    const buf2 = new ArrayBuffer(128);
    const result = await WP.run(pool, buf2, { transferList: [buf2] });
    assert.equal(result, 128);
    assert.equal(buf2.byteLength, 0);
    await WP.destroy(pool);
  });

  test("task aborted while worker is spawning (before READY)", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1, minThreads: 0 });
    const controller = new AbortController();
    const promise = WP.run(pool, 500, { signal: controller.signal });
    // Abort immediately — before the newly spawned worker sends READY.
    controller.abort();
    await assert.rejects(() => promise, { name: "AbortError" });
    // Give time for the READY message to arrive and be handled.
    await sleep(200);
    // Pool should still work.
    const result = await WP.run(pool, 50);
    assert.equal(result, "done");
    await WP.destroy(pool);
  });

  test("worker error event during initialization", async () => {
    const badUrl = "data:text/javascript," + encodeURIComponent("throw new Error('init failed');");
    const pool = WP.make({ filename: badUrl, maxThreads: 1, minThreads: 0 });
    await assert.rejects(() => WP.run(pool, "test"), /init failed/);
    await WP.destroy(pool);
  });

  test("worker exit while idle timer is running clears timer", async () => {
    // Worker that self-exits 100ms after completing a task.
    const selfExitUrl =
      "data:text/javascript," +
      encodeURIComponent(
        "export default (x) => { setTimeout(() => process.exit(0), 100); return x; };",
      );
    const pool = WP.make<string, string>({
      filename: selfExitUrl,
      minThreads: 0,
      maxThreads: 1,
      idleTimeout: 5000, // Long timeout — timer will be set when worker goes idle.
    });
    const result = await WP.run(pool, "test");
    assert.equal(result, "test");
    // Worker completes task, goes idle (timer set), then self-exits after 100ms.
    await sleep(300);
    // Pool should handle this gracefully.
    await WP.destroy(pool);
  });

  test("idleTimeout=0 means no timeout", async () => {
    const pool = WP.make<string, string>({
      filename: echoUrl,
      minThreads: 0,
      maxThreads: 1,
      idleTimeout: 0,
    });
    await WP.run(pool, "test");
    // Even after waiting, the worker should still be alive.
    await sleep(200);
    const result = await WP.run(pool, "test2");
    assert.equal(result, "test2");
    await WP.destroy(pool);
  });
});
