import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as WP from "../../WorkerPool.js";
import { WorkerExitError, WorkerPoolDestroyedError } from "../../WorkerPool.js";
import { serializeThrown, deserializeThrown, SER_ERROR } from "../../WorkerPool.protocol.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

const opsUrl = new URL("../fixtures/ops.mjs", import.meta.url).href;
const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";

// ---------------------------------------------------------------------------
// Property tests: error (de)serialization (pure)
// ---------------------------------------------------------------------------

test("property: Error round-trips message, name, cloneable props and cause", () => {
  Prop.assert(
    Arb.tuple(Arb.string(), Arb.string({ minLength: 1 }), Arb.integer(), Arb.string()),
    ([message, name, code, causeMsg]) => {
      const src = new Error(message, { cause: new TypeError(causeMsg) });
      src.name = name;
      Object.assign(src, { code, fn: () => 0 });
      // Must survive the structured clone the real channel applies.
      const wire = structuredClone(serializeThrown(src));
      const out = deserializeThrown(wire) as Error & { code?: number };
      return (
        out instanceof Error &&
        out.message === message &&
        out.name === name &&
        out.code === code &&
        !("fn" in out) &&
        (out.cause as Error).message === causeMsg
      );
    },
    { numRuns: 1_000_000 },
  );
});

test("property: non-Error throwables round-trip as values", () => {
  Prop.assert(
    Arb.oneOf<unknown>(
      Arb.integer(),
      Arb.string(),
      Arb.boolean(),
      Arb.constant(null),
      Arb.constant(undefined),
    ),
    (v) => {
      const out = deserializeThrown(structuredClone(serializeThrown(v)));
      return Object.is(out, v);
    },
    { numRuns: 1_000_000 },
  );
});

test("property: deserializeThrown never throws on arbitrary input", () => {
  Prop.assert(
    Arb.oneOf<unknown>(
      Arb.integer(),
      Arb.string(),
      Arb.boolean(),
      Arb.constant(null),
      Arb.constant(undefined),
      Arb.record({
        kind: Arb.oneOf<unknown>(Arb.integer(0, 2), Arb.string(), Arb.constant(undefined)),
        message: Arb.oneOf<unknown>(Arb.string(), Arb.integer(), Arb.constant(null)),
        name: Arb.oneOf<unknown>(Arb.string(), Arb.integer()),
        cause: Arb.oneOf<unknown>(Arb.constant(undefined), Arb.string(), Arb.integer()),
        properties: Arb.oneOf<unknown>(
          Arb.constant(null),
          Arb.dictionary(Arb.string({ maxLength: 6 }), Arb.integer()),
        ),
      }),
    ),
    (v) => {
      const out = deserializeThrown(v);
      // Either a decoded Error or (for value payloads) the value itself.
      return (
        out instanceof Error ||
        (typeof v === "object" && v !== null && (v as { kind?: unknown }).kind !== SER_ERROR)
      );
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// G7-3: idleTimeout validation (no workers spawned: minThreads defaults to 0)
// ---------------------------------------------------------------------------

test("property: make() accepts idleTimeout iff Infinity or in [0, 2^31-1]", () => {
  Prop.assert(
    Arb.oneOf<number>(
      Arb.float(-1e10, 1e10),
      Arb.integer(2 ** 31 - 3, 2 ** 31 + 3),
      Arb.integer(-3, 3),
      Arb.constantFrom(NaN, Infinity, -Infinity, -0),
    ),
    (idleTimeout) => {
      const valid = idleTimeout === Infinity || (idleTimeout >= 0 && idleTimeout <= 2 ** 31 - 1);
      try {
        WP.make({ filename: opsUrl, maxThreads: 1, idleTimeout });
        return valid;
      } catch (e) {
        return !valid && e instanceof RangeError;
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// G7-1: retries issued from a startup-failure rejection handler never hang
// ---------------------------------------------------------------------------

const badInitCountUrl = new URL("../fixtures/bad-init-count.mjs", import.meta.url).href;
// G7-6: a module without a default function is a startup failure too.
const noDefaultCountUrl = new URL("../fixtures/no-default-count.mjs", import.meta.url).href;

test("property: startup-failure retries all settle, drain() settles, no respawn loop", async () => {
  await Prop.assertAsync(
    Arb.tuple(
      Arb.integer(1, 3),
      Arb.integer(0, 4),
      Arb.constantFrom(badInitCountUrl, noDefaultCountUrl),
    ),
    async ([maxThreads, retries, filename]) => {
      const noDefault = filename === noDefaultCountUrl;
      const ok = (e: unknown): boolean =>
        noDefault
          ? e instanceof Error &&
            e.name === "TypeError" &&
            /must export a default function/.test(e.message)
          : /init failed/.test(String(e));
      const counter = new SharedArrayBuffer(4);
      const pool = WP.make<number, number>({
        filename,
        maxThreads,
        workerData: counter,
      });
      const outcomes: Promise<unknown>[] = [];
      // Retries are submitted between the failed worker's 'error' and 'exit'.
      let firstOk = false;
      const first = WP.run(pool, 0).catch((e: unknown) => {
        firstOk = ok(e);
        for (let i = 0; i < retries; i++) outcomes.push(WP.run(pool, i).catch((e: unknown) => e));
      });
      try {
        await withTimeout(first, 10_000, "first run");
        const errs = await withTimeout(Promise.all(outcomes), 10_000, "retries");
        await withTimeout(WP.drain(pool), 10_000, "drain()");
        const spawns = Atomics.load(new Int32Array(counter), 0);
        return (
          firstOk &&
          errs.every(ok) &&
          spawns <= 1 + retries &&
          WP.activeCount(pool) === 0 &&
          WP.pendingCount(pool) === 0
        );
      } finally {
        await WP.destroy(pool);
      }
    },
    // Each run spawns real threads: bounded by wall clock, not 1M runs.
    { numRuns: 1_000_000, timeoutMs: 60_000 },
  );
});

// ---------------------------------------------------------------------------
// Stateful: WorkerPool vs. oracle (run / abort / crash / drain / destroy)
// ---------------------------------------------------------------------------

type Kind = "echo" | "slow" | "throw" | "crash";
const KINDS: [Kind, ...Kind[]] = ["echo", "slow", "throw", "crash"];

interface TaskModel {
  readonly id: number;
  readonly kind: Kind;
  readonly hasSignal: boolean;
  aborted: boolean;
  /** Submitted after destroy(): the only legal outcome is WorkerPoolDestroyedError. */
  readonly afterDestroy: boolean;
  /** Submitted with priority NaN: must reject with RangeError (G7-4). */
  readonly nanPriority: boolean;
}

interface Model {
  nextId: number;
  tasks: TaskModel[];
  destroyed: boolean;
}

interface Handle {
  readonly promise: Promise<PromiseSettledResult<unknown>>;
  readonly ctrl: AbortController | undefined;
}

interface Real {
  pool: WP.WorkerPool<unknown, unknown>;
  handles: Map<number, Handle>;
  maxThreads: number;
  /** Ids of tasks whose promise has settled. */
  settled: Set<number>;
}

const MAX_THREADS = 3;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout (${ms}ms): ${what}`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * G7-7 oracle: pendingCount never counts aborted or settled tasks, so it is
 * bounded by the live, non-aborted tasks the model knows about.
 */
function checkCounts(m: Model, r: Real): void {
  const pending = WP.pendingCount(r.pool);
  let live = 0;
  for (const t of m.tasks) if (!t.aborted && !r.settled.has(t.id)) live++;
  assert.ok(pending >= 0, `pendingCount ${pending} < 0`);
  assert.ok(pending <= live, `pendingCount ${pending} > live non-aborted tasks ${live}`);
}

/** Oracle: legal outcomes of a task given the model. */
function checkOutcome(t: TaskModel, model: Model, r: PromiseSettledResult<unknown>): void {
  const tag = `task ${t.id} (${t.kind}${t.aborted ? ", aborted" : ""})`;
  if (r.status === "rejected") {
    const reason = r.reason as Error;
    if (t.afterDestroy) {
      assert.ok(reason instanceof WorkerPoolDestroyedError, `${tag}: expected destroyed error`);
      return;
    }
    if (reason instanceof WorkerPoolDestroyedError) {
      assert.ok(model.destroyed, `${tag}: destroyed error but pool never destroyed`);
      return;
    }
    if (t.nanPriority) {
      assert.ok(reason instanceof RangeError, `${tag}: expected RangeError for NaN priority`);
      return;
    }
    if (t.aborted && reason?.name === "AbortError") return;
    if (t.kind === "throw") {
      assert.ok(reason instanceof Error && reason.message === `t${t.id}`, `${tag}: wrong error`);
      return;
    }
    if (t.kind === "crash") {
      assert.ok(reason instanceof WorkerExitError, `${tag}: expected WorkerExitError`);
      return;
    }
    assert.fail(`${tag}: unexpected rejection ${String(reason)}`);
  }
  assert.ok(!t.afterDestroy, `${tag}: resolved on a destroyed pool`);
  assert.ok(!t.nanPriority, `${tag}: resolved despite NaN priority`);
  assert.ok(t.kind === "echo" || t.kind === "slow", `${tag}: resolved but should not`);
  assert.equal(r.value, t.id, `${tag}: wrong value`);
}

async function settleAll(model: Model, real: Real): Promise<void> {
  await withTimeout(WP.drain(real.pool), 20_000, "drain()");
  // Everything dispatched is done: nothing may remain counted.
  assert.equal(WP.activeCount(real.pool), 0, "activeCount after drain");
  assert.equal(WP.pendingCount(real.pool), 0, "pendingCount after drain");
  for (const t of model.tasks) {
    const h = real.handles.get(t.id)!;
    const r = await withTimeout(h.promise, 20_000, `task ${t.id} to settle`);
    checkOutcome(t, model, r);
  }
}

test("stateful: WorkerPool matches oracle under run/abort/crash/drain/destroy", async () => {
  // Bun worker_threads does not fire 'exit' on process.exit(): crashes can't be observed.
  /* node:coverage ignore next 2 */
  if (isBun) return;

  await ST.assertStatefulAsync<Model, Real>({
    initialModel: () => ({ nextId: 0, tasks: [], destroyed: false }),
    initialReal: () => ({
      pool: WP.make<unknown, unknown>({
        filename: opsUrl,
        minThreads: 0,
        maxThreads: MAX_THREADS,
        idleTimeout: 15, // exercise idle-terminate racing with new submissions
      }),
      handles: new Map(),
      maxThreads: MAX_THREADS,
      settled: new Set(),
    }),
    commands: [
      // submit
      (_model) =>
        Arb.map(
          Arb.tuple(
            Arb.constantFrom(...KINDS),
            Arb.frequency<number>(
              { weight: 8, arb: Arb.integer(0, 2) },
              { weight: 1, arb: Arb.constantFrom(NaN, Infinity, -Infinity) },
            ),
            Arb.boolean(),
            Arb.integer(0, 25),
          ),
          ([kind, priority, withSignal, ms]) => ({
            name: `submit(${kind},p=${priority}${withSignal ? ",signal" : ""})`,
            run: async (m: Model, r: Real): Promise<void> => {
              const id = m.nextId++;
              const ctrl = withSignal ? new AbortController() : undefined;
              const pendingBefore = WP.pendingCount(r.pool);
              const activeBefore = WP.activeCount(r.pool);
              const promise = WP.run(
                r.pool,
                { op: kind, v: id, ms },
                { priority, signal: ctrl?.signal },
              ).then(
                (value): PromiseSettledResult<unknown> => ({ status: "fulfilled", value }),
                (reason): PromiseSettledResult<unknown> => ({ status: "rejected", reason }),
              );
              void promise.then(() => r.settled.add(id));
              r.handles.set(id, { promise, ctrl });
              const nanPriority = priority !== priority;
              if (nanPriority) {
                // Rejected up front: nothing queued, nothing dispatched.
                assert.equal(WP.pendingCount(r.pool), pendingBefore, "NaN priority queued");
                assert.equal(WP.activeCount(r.pool), activeBefore, "NaN priority dispatched");
              }
              m.tasks.push({
                id,
                kind,
                hasSignal: withSignal,
                aborted: false,
                afterDestroy: m.destroyed,
                nanPriority,
              });
              checkCounts(m, r);
              assert.ok(
                WP.activeCount(r.pool) <= r.maxThreads,
                `activeCount ${WP.activeCount(r.pool)} > maxThreads`,
              );
            },
          }),
        ),

      // abort a random abortable task
      (model) =>
        Arb.map(Arb.integer(0, Math.max(0, model.tasks.length - 1)), (idx) => ({
          name: `abort(#${idx})`,
          check: (m: Model) => m.tasks.some((t) => t.hasSignal),
          run: async (m: Model, r: Real): Promise<void> => {
            const abortable = m.tasks.filter((t) => t.hasSignal);
            const t = abortable[idx % abortable.length]!;
            const before = WP.pendingCount(r.pool);
            t.aborted = true;
            r.handles.get(t.id)!.ctrl!.abort();
            // An abort removes at most this one task from the pending count.
            const after = WP.pendingCount(r.pool);
            assert.ok(after === before || after === before - 1, `pendingCount ${before}→${after}`);
            checkCounts(m, r);
          },
        })),

      // wait a little (lets idle timeouts and exits interleave)
      (_model) =>
        Arb.map(Arb.integer(0, 30), (ms) => ({
          name: `sleep(${ms})`,
          run: async (): Promise<void> => {
            await new Promise((resolve) => setTimeout(resolve, ms));
          },
        })),

      // drain + verify every task against the oracle
      (_model) =>
        Arb.constant({
          name: "settleAll",
          run: (m: Model, r: Real): Promise<void> => settleAll(m, r),
        }),

      // destroy (terminal; later submits must reject with WorkerPoolDestroyedError)
      (_model) =>
        Arb.constant({
          name: "destroy",
          check: (m: Model) => !m.destroyed,
          run: async (m: Model, r: Real): Promise<void> => {
            await withTimeout(WP.destroy(r.pool), 20_000, "destroy()");
            m.destroyed = true;
            assert.equal(WP.activeCount(r.pool), 0, "activeCount after destroy");
            assert.equal(WP.pendingCount(r.pool), 0, "pendingCount after destroy");
          },
        }),
    ],
    teardown: async (real) => {
      await WP.destroy(real.pool);
    },
    numRuns: 1_000_000,
    maxCommands: 50,
    // Each run spawns real worker threads (~tens of ms each), so 1M runs are
    // unreachable: the wall-clock deadline (120s) bounds the test instead.
    timeoutMs: 120_000,
  });
});
