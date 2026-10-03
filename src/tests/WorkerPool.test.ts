import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { getEventListeners } from "node:events";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as WP from "../WorkerPool.js";
import { WorkerPoolDestroyedError, WorkerExitError } from "../WorkerPool.js";

// ---------------------------------------------------------------------------
// fixture file URLs (avoids data: URLs which break in Bun worker_threads)
// ---------------------------------------------------------------------------

const echoUrl = new URL("./fixtures/echo.mjs", import.meta.url).href;
const doubleUrl = new URL("./fixtures/double.mjs", import.meta.url).href;
const throwUrl = new URL("./fixtures/throw.mjs", import.meta.url).href;
const slowUrl = new URL("./fixtures/slow.mjs", import.meta.url).href;
const transferUrl = new URL("./fixtures/transfer.mjs", import.meta.url).href;

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
    // Bun worker_threads flakes when spawning multiple workers rapidly
    /* node:coverage ignore next 2 */
    if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") return;
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
    const nonErrorCauseUrl = new URL("./fixtures/throw-non-error-cause.mjs", import.meta.url).href;
    const pool = WP.make({ filename: nonErrorCauseUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "oops");
    assert.equal(err.cause, "string cause");
    await WP.destroy(pool);
  });

  test("error without cause is deserialized correctly", async () => {
    const noCauseUrl = new URL("./fixtures/throw-no-cause.mjs", import.meta.url).href;
    const pool = WP.make({ filename: noCauseUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "no cause");
    assert.equal(err.cause, undefined);
    await WP.destroy(pool);
  });

  test("non-Error thrown rejects with the (cloned) value itself", async () => {
    const throwStringUrl = new URL("./fixtures/throw-string.mjs", import.meta.url).href;
    const pool = WP.make({ filename: throwStringUrl, maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.equal(err, "string error");
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
    const throwOnceUrl = new URL("./fixtures/throw-once.mjs", import.meta.url).href;
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
    // Bun worker_threads does not fire 'exit' on process.exit()
    /* node:coverage ignore next 2 */
    if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") return;
    const crashUrl = new URL("./fixtures/crash.mjs", import.meta.url).href;
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
    const badUrl = new URL("./fixtures/bad-init.mjs", import.meta.url).href;
    const pool = WP.make({ filename: badUrl, maxThreads: 1, minThreads: 0 });
    await assert.rejects(() => WP.run(pool, "test"), /init failed/);
    await WP.destroy(pool);
  });

  test("worker exit while idle timer is running clears timer", async () => {
    const selfExitUrl = new URL("./fixtures/self-exit.mjs", import.meta.url).href;
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

// ---------------------------------------------------------------------------
// Review findings (G5-1 .. G5-11)
// ---------------------------------------------------------------------------

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).href;
const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

describe("G5-1/G5-5: robust error forwarding", () => {
  test("plain-object cause does not crash the process; worker stays usable", async () => {
    const pool = WP.make({ filename: fixture("throw-cause-obj.mjs"), maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "x");
    assert.deepEqual(err.cause, { message: "m" });
    // Worker returned to idle: a second task on the same single worker settles.
    const err2 = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err2 instanceof Error);
    await WP.destroy(pool);
  });

  test("Error with an uncloneable property is forwarded without it", async () => {
    const pool = WP.make({ filename: fixture("throw-uncloneable.mjs"), maxThreads: 1 });
    const err = (await WP.run(pool, null).catch((e: unknown) => e)) as Error & { ok?: number };
    assert.ok(err instanceof Error);
    assert.equal(err.message, "fn prop");
    assert.equal(err.ok, 7);
    assert.equal("fn" in err, false);
    // Worker survived (no DataCloneError crash).
    const again = (await WP.run(pool, null).catch((e: unknown) => e)) as Error;
    assert.equal(again.message, "fn prop");
    await WP.destroy(pool);
  });

  test("uncloneable result rejects with DataCloneError; worker stays usable", async () => {
    const pool = WP.make<string, string>({ filename: fixture("return-fn.mjs"), maxThreads: 1 });
    const err = await WP.run(pool, "bad").catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof WorkerExitError));
    assert.equal(await WP.run(pool, "ok"), "ok");
    await WP.destroy(pool);
  });

  test("cause cycle is cut, not infinite", async () => {
    const pool = WP.make({ filename: fixture("throw-cycle.mjs"), maxThreads: 1 });
    const err = await WP.run(pool, null).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.message, "loop");
    await WP.destroy(pool);
  });

  test("thrown plain objects are cloned; uncloneable ones fall back to a string", async () => {
    const pool = WP.make<string, never>({ filename: fixture("throw-object.mjs"), maxThreads: 1 });
    assert.deepEqual(await WP.run(pool, "x").catch((e: unknown) => e), {
      code: 7,
      nested: { a: [1, 2] },
    });
    assert.equal(await WP.run(pool, "fn").catch((e: unknown) => e), "[object Object]");
    await WP.destroy(pool);
  });

  test("uncloneable task data rejects the task and frees the worker", async () => {
    const pool = WP.make<unknown, unknown>({ filename: echoUrl, maxThreads: 1 });
    const err = await WP.run(pool, () => 1).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(WP.activeCount(pool), 0);
    // Queued behind a spawning worker (READY path) and via the idle path.
    const [a, b] = await Promise.allSettled([WP.run(pool, () => 1), WP.run(pool, "fine")]);
    assert.equal(a.status, "rejected");
    assert.equal(b.status, "fulfilled");
    assert.equal(await WP.run(pool, "after"), "after");
    await WP.destroy(pool);
  });
});

describe("G5-2: crash recovery dispatches queued work", () => {
  test("minThreads=0: task queued behind a crashing task still runs", async () => {
    if (isBun) return; // Bun does not fire 'exit' on process.exit() in a worker
    const pool = WP.make<string, string>({
      filename: new URL("./fixtures/crash.mjs", import.meta.url).href,
      minThreads: 0,
      maxThreads: 1,
    });
    const crash = WP.run(pool, "crash").catch((e: unknown) => e);
    const next = WP.run(pool, "alive");
    assert.ok((await crash) instanceof WorkerExitError);
    assert.equal(await next, "alive");
    await WP.drain(pool);
    await WP.destroy(pool);
  });
});

describe("uncaught exception in a ready worker", () => {
  test("rejects the in-flight task, queued task runs on a replacement", async () => {
    const pool = WP.make<string, string>({ filename: fixture("uncaught.mjs"), maxThreads: 1 });
    const boom = WP.run(pool, "boom").catch((e: unknown) => e);
    const next = WP.run(pool, "alive");
    const err = await boom;
    assert.ok(err instanceof Error);
    assert.match(err.message, /uncaught in worker/);
    assert.equal(await next, "alive");
    await WP.destroy(pool);
  });
});

describe("G5-3: startup failure", () => {
  test("rejects queued tasks with the startup error and does not respawn", async () => {
    const counter = new SharedArrayBuffer(4);
    const pool = WP.make<number, number>({
      filename: fixture("bad-init-count.mjs"),
      minThreads: 1,
      maxThreads: 1,
      workerData: counter,
    });
    const results = await Promise.allSettled([WP.run(pool, 1), WP.run(pool, 2), WP.run(pool, 3)]);
    for (const r of results) {
      assert.equal(r.status, "rejected");
      assert.match(String((r as PromiseRejectedResult).reason), /init failed/);
    }
    await sleep(400);
    // minThreads=1 pre-spawn (1) + one on-demand spawn at most; never a loop.
    assert.ok(Atomics.load(new Int32Array(counter), 0) <= 2);
    await WP.drain(pool);
    await WP.destroy(pool);
  });

  test("exit before READY without an error event rejects with WorkerExitError", async () => {
    if (isBun) return;
    const pool = WP.make({ filename: fixture("exit-on-import.mjs"), maxThreads: 1 });
    const err = await WP.run(pool, 1).catch((e: unknown) => e);
    assert.ok(err instanceof WorkerExitError);
    await WP.destroy(pool);
  });
});

describe("G5-6: equal priorities run in submission order", () => {
  test("30 equal-priority tasks complete FIFO on a single worker", async () => {
    const pool = WP.make<number, number>({ filename: slowUrl, maxThreads: 1 });
    const blocker = WP.run(pool as unknown as WP.WorkerPool<number, string>, 50);
    const order: number[] = [];
    const ps: Promise<unknown>[] = [];
    for (let i = 0; i < 30; i++) {
      ps.push(WP.run(pool, 0, { priority: 1 }).then(() => order.push(i)));
    }
    await blocker;
    await Promise.all(ps);
    assert.deepEqual(
      order,
      Array.from({ length: 30 }, (_, i) => i),
    );
    await WP.destroy(pool);
  });
});

describe("G5-7: abort listener cleanup", () => {
  test("listener removed after completion and after error", async () => {
    const pool = WP.make<string, string>({ filename: echoUrl, maxThreads: 2 });
    const throwing = WP.make({ filename: throwUrl, maxThreads: 1 });
    const controller = new AbortController();
    for (let i = 0; i < 5; i++) await WP.run(pool, "x", { signal: controller.signal });
    await WP.run(throwing, null, { signal: controller.signal }).catch(() => {});
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    await WP.destroy(pool);
    await WP.destroy(throwing);
  });

  test("listener removed when the pool is destroyed under a pending task", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const controller = new AbortController();
    const p = WP.run(pool, 5000, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(30);
    await WP.destroy(pool);
    assert.ok((await p) instanceof WorkerPoolDestroyedError);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});

describe("G5-8: abort of an in-flight task", () => {
  test("rejects at once but stays active until the worker replies", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const controller = new AbortController();
    const p = WP.run(pool, 300, { signal: controller.signal });
    await sleep(50);
    controller.abort();
    await assert.rejects(() => p, { name: "AbortError" });
    assert.equal(WP.activeCount(pool), 1);
    await WP.drain(pool); // must wait for the worker, not resolve early
    assert.equal(WP.activeCount(pool), 0);
    // Worker is free again.
    assert.equal(await WP.run(pool, 10), "done");
    await WP.destroy(pool);
  });
});

describe("G5-11: filename and workerData", () => {
  test("relative string path resolves against cwd", async () => {
    const abs = fileURLToPath(fixture("echo.mjs"));
    const pool = WP.make<string, string>({ filename: relative(process.cwd(), abs), maxThreads: 1 });
    assert.equal(await WP.run(pool, "rel"), "rel");
    await WP.destroy(pool);
  });

  test("absolute string path works", async () => {
    const pool = WP.make<string, string>({
      filename: fileURLToPath(fixture("echo.mjs")),
      maxThreads: 1,
    });
    assert.equal(await WP.run(pool, "abs"), "abs");
    await WP.destroy(pool);
  });

  test("user data arrives as workerData.userData", async () => {
    const pool = WP.make<null, { filename: string; userData: unknown }>({
      filename: fixture("worker-data.mjs"),
      maxThreads: 1,
      workerData: { answer: 42 },
    });
    const wd = await WP.run(pool, null);
    assert.deepEqual(wd.userData, { answer: 42 });
    assert.equal(typeof wd.filename, "string");
    await WP.destroy(pool);
  });
});

// Fails the test instead of hanging the runner if `p` never settles.
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

describe("G7-1: task submitted from a startup-failure rejection handler", () => {
  test("is dispatched to a fresh worker (no hang), drain() settles", async () => {
    const counter = new SharedArrayBuffer(4);
    const pool = WP.make<number, number>({
      filename: fixture("bad-init-first.mjs"),
      maxThreads: 1,
      workerData: counter,
    });
    let retry: Promise<number> | undefined;
    // Retry inside the handler: runs between the worker's 'error' and 'exit'.
    const first = await WP.run(pool, 1).catch((e: unknown) => {
      retry = WP.run(pool, 2);
      return e;
    });
    assert.match(String(first), /init failed/);
    assert.equal(await within(retry!, 5000, "retry"), 2);
    await within(WP.drain(pool), 5000, "drain");
    assert.equal(Atomics.load(new Int32Array(counter), 0), 2);
    await WP.destroy(pool);
  });

  test("always-broken module: retry rejects, one extra spawn, no respawn loop", async () => {
    const counter = new SharedArrayBuffer(4);
    const pool = WP.make<number, number>({
      filename: fixture("bad-init-count.mjs"),
      maxThreads: 1,
      workerData: counter,
    });
    let retry: Promise<unknown> | undefined;
    await WP.run(pool, 1).catch(() => {
      retry = WP.run(pool, 2).catch((e: unknown) => e);
    });
    assert.match(String(await within(retry!, 5000, "retry")), /init failed/);
    await within(WP.drain(pool), 5000, "drain");
    await sleep(300);
    assert.equal(Atomics.load(new Int32Array(counter), 0), 2);
    assert.equal(WP.activeCount(pool), 0);
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
  });
});

describe("G7-3: idleTimeout validation", () => {
  test("NaN, negative, -Infinity and > 2^31-1 throw RangeError (before spawning)", () => {
    for (const idleTimeout of [NaN, -1, -Infinity, 2 ** 31, 1e12]) {
      assert.throws(
        () => WP.make({ filename: echoUrl, minThreads: 1, maxThreads: 1, idleTimeout }),
        RangeError,
      );
    }
  });

  test("boundaries 0 and 2^31-1 are accepted", async () => {
    for (const idleTimeout of [0, 2 ** 31 - 1, 0.5]) {
      await WP.destroy(WP.make({ filename: echoUrl, maxThreads: 1, idleTimeout }));
    }
  });

  test("Infinity means no timeout: the idle worker is kept and reused", async () => {
    const pool = WP.make<null, number>({
      filename: fixture("thread-id.mjs"),
      maxThreads: 1,
      idleTimeout: Infinity,
    });
    const a = await WP.run(pool, null);
    await sleep(100);
    assert.equal(await WP.run(pool, null), a);
    await WP.destroy(pool);
  });
});

describe("G7-4: NaN priority", () => {
  test("run() rejects with RangeError and queues nothing", async () => {
    const pool = WP.make<number, number>({ filename: echoUrl, maxThreads: 1 });
    await assert.rejects(() => WP.run(pool, 1, { priority: NaN }), RangeError);
    assert.equal(WP.pendingCount(pool), 0);
    assert.equal(WP.activeCount(pool), 0);
    assert.equal(await WP.run(pool, 3), 3);
    await WP.destroy(pool);
  });

  test("±Infinity priorities keep a consistent order", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const blocker = WP.run(pool, 50);
    const order: number[] = [];
    const prios = [Infinity, 1, -Infinity, Infinity, -Infinity, 0];
    const ps = prios.map((priority, i) => WP.run(pool, 0, { priority }).then(() => order.push(i)));
    await blocker;
    await Promise.all(ps);
    assert.deepEqual(order, [2, 4, 5, 1, 0, 3]);
    await WP.destroy(pool);
  });
});

describe("G7-6: worker module without a default function", () => {
  test("fails at startup with a TypeError naming the module", async () => {
    const pool = WP.make({ filename: fixture("no-default.mjs"), maxThreads: 1 });
    const err = await WP.run(pool, 1).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.name, "TypeError");
    assert.match(err.message, /no-default\.mjs must export a default function, got undefined/);
    await within(WP.drain(pool), 5000, "drain");
    await WP.destroy(pool);
  });
});

describe("G7-7: pendingCount excludes aborted queued tasks", () => {
  test("queued aborts are excluded at once; in-flight aborts do not touch it", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const inflight = new AbortController();
    const running = WP.run(pool, 100, { signal: inflight.signal }).catch((e: unknown) => e);
    const c = [new AbortController(), new AbortController(), new AbortController()];
    const queued = c.map((ac) => WP.run(pool, 10, { signal: ac.signal }).catch((e: unknown) => e));
    assert.equal(WP.pendingCount(pool), 3);
    c[0]!.abort();
    c[2]!.abort();
    assert.equal(WP.pendingCount(pool), 1);
    c[2]!.abort(); // repeat abort is a no-op
    assert.equal(WP.pendingCount(pool), 1);
    await sleep(50);
    inflight.abort();
    assert.equal(WP.pendingCount(pool), 1);
    await running;
    await Promise.all(queued);
    await WP.drain(pool);
    assert.equal(WP.pendingCount(pool), 0);
    // Queue is reused after lazily discarding aborted tasks: counts stay exact.
    const blocker = WP.run(pool, 50);
    const ac = new AbortController();
    const later = WP.run(pool, 10, { signal: ac.signal }).catch((e: unknown) => e);
    const kept = WP.run(pool, 10);
    ac.abort();
    assert.equal(WP.pendingCount(pool), 1);
    await Promise.all([blocker, later, kept]);
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
  });

  test("destroy() and startup failure reset the count with the queue", async () => {
    const pool = WP.make<number, string>({ filename: slowUrl, maxThreads: 1 });
    const busy = WP.run(pool, 200).catch((e: unknown) => e);
    const ac = new AbortController();
    const p = WP.run(pool, 10, { signal: ac.signal }).catch((e: unknown) => e);
    ac.abort();
    await p;
    assert.equal(WP.pendingCount(pool), 0);
    await WP.destroy(pool);
    await busy;
    assert.equal(WP.pendingCount(pool), 0);

    const bad = WP.make<number, number>({ filename: fixture("bad-init.mjs"), maxThreads: 1 });
    const first = WP.run(bad, 1).catch((e: unknown) => e);
    const ac2 = new AbortController();
    const q = WP.run(bad, 2, { signal: ac2.signal }).catch((e: unknown) => e);
    const q2 = WP.run(bad, 3).catch((e: unknown) => e);
    ac2.abort();
    assert.equal(WP.pendingCount(bad), 1);
    await Promise.all([first, q, q2]);
    assert.equal(WP.pendingCount(bad), 0);
    await within(WP.drain(bad), 5000, "drain");
    await WP.destroy(bad);
  });
});
