/**
 * BatchExecutor stateful fuzz — model-based oracle for the
 * maxBatchSize / maxInFlight queueing behaviour.
 *
 * Commands: init(B, K) (first), call(poison?), tick (one "io" schedule turn),
 * settle(invocation, ok | err | mismatch). After each command the microtask
 * queue is drained until quiescent, then the real executor's invocations
 * (argument chunks, in order), per-item outcomes and in-flight set must match
 * the oracle exactly.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { setImmediate as setImmediatePromise } from "node:timers/promises";
import * as Arb from "../../Arbitrary.js";
import * as ST from "../../StatefulTest.js";
import { make } from "../../BatchExecutor.js";

interface Item {
  readonly id: number;
  readonly poison: boolean;
}

interface ModelInvocation {
  readonly inv: number;
  readonly items: Item[];
}

interface Model {
  cfg: { B: number; K: number } | undefined;
  nextId: number;
  /** Calls made since the last tick (not yet collected). */
  buffer: Item[];
  /** Chunks waiting for a free slot, FIFO. */
  queue: Item[][];
  /** Invocations started and not yet settled (poisoned ones never count). */
  inflight: ModelInvocation[];
  /** Argument ids of every fn invocation, in start order. */
  invocations: number[][];
  outcomes: Map<number, string>;
}

interface RealInvocation {
  readonly ids: number[];
  readonly resolve: (v: PromiseSettledResult<number>[]) => void;
  readonly reject: (e: unknown) => void;
  settled: boolean;
}

interface Real {
  exec: ((item: Item) => Promise<number>) | undefined;
  invocations: RealInvocation[];
  outcomes: Map<number, string>;
  /** Bumped on every observable event; drives the quiescence flush. */
  events: number;
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

function dispatch(m: Model): void {
  const K = m.cfg!.K;
  while (m.inflight.length < K && m.queue.length > 0) {
    const items = m.queue.shift()!;
    const inv = m.invocations.length;
    m.invocations.push(items.map((x) => x.id));
    if (items.some((x) => x.poison)) {
      // fn throws synchronously: the chunk rejects, the slot frees at once.
      for (const x of items) m.outcomes.set(x.id, "rej:poison");
    } else {
      m.inflight.push({ inv, items });
    }
  }
}

function tickModel(m: Model): void {
  const B = m.cfg!.B;
  const items = m.buffer;
  m.buffer = [];
  for (let start = 0; start < items.length; start += B) {
    m.queue.push(items.slice(start, start + B));
  }
  dispatch(m);
}

type SettleKind = "ok" | "err" | "mismatch";

function itemResult(id: number): PromiseSettledResult<number> {
  return id % 3 === 0
    ? { status: "rejected", reason: `r${id}` }
    : { status: "fulfilled", value: id * 2 };
}

function settleModel(m: Model, pos: number, kind: SettleKind): ModelInvocation {
  const [entry] = m.inflight.splice(pos, 1);
  const n = entry.items.length;
  for (const x of entry.items) {
    if (kind === "ok") {
      const r = itemResult(x.id);
      m.outcomes.set(x.id, r.status === "fulfilled" ? `ok:${r.value}` : `rej:${r.reason}`);
    } else if (kind === "err") {
      m.outcomes.set(x.id, `rej:e${entry.inv}`);
    } else {
      m.outcomes.set(x.id, `rej:BatchExecutor: fn returned ${n + 1} results, but expected ${n}`);
    }
  }
  dispatch(m);
  return entry;
}

// ---------------------------------------------------------------------------
// Real system helpers
// ---------------------------------------------------------------------------

async function flush(r: Real): Promise<void> {
  let last = -1;
  for (let stable = 0; stable < 64; ) {
    await Promise.resolve();
    if (r.events === last) {
      stable++;
    } else {
      last = r.events;
      stable = 0;
    }
  }
}

function compare(m: Model, r: Real): void {
  assert.deepEqual(
    r.invocations.map((i) => i.ids),
    m.invocations,
    "invocation chunks",
  );
  assert.deepEqual(r.outcomes, m.outcomes, "per-item outcomes");
  const realInflight: number[] = [];
  for (let i = 0; i < r.invocations.length; i++) {
    const inv = r.invocations[i];
    if (!inv.settled) realInflight.push(i);
  }
  assert.deepEqual(
    realInflight,
    m.inflight.map((e) => e.inv).sort((a, b) => a - b),
    "in-flight invocations",
  );
  assert.ok(realInflight.length <= m.cfg!.K, "maxInFlight exceeded");
}

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const LIMITS = [1, 2, 3, Infinity] as const;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const initCmd = Arb.map(
  Arb.tuple(Arb.constantFrom(...LIMITS), Arb.constantFrom(...LIMITS)),
  ([B, K]): ST.AsyncCommand<Model, Real> => ({
    name: `init(B=${B},K=${K})`,
    check: (m) => m.cfg === undefined,
    run: async (m, r) => {
      m.cfg = { B, K };
      r.exec = make<Item, number>(
        (args) => {
          r.events++;
          let resolve!: RealInvocation["resolve"];
          let reject!: RealInvocation["reject"];
          const promise = new Promise<PromiseSettledResult<number>[]>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          const ids = args.map((x) => x.id);
          const poison = args.some((x) => x.poison);
          r.invocations.push({ ids, resolve, reject, settled: poison });
          if (poison) throw new Error("poison");
          return promise;
        },
        { schedule: "io", maxBatchSize: B, maxInFlight: K },
      );
    },
  }),
);

const callCmd = Arb.map(
  Arb.integer(0, 9),
  (p): ST.AsyncCommand<Model, Real> => ({
    name: p === 0 ? "call(poison)" : "call",
    check: (m) => m.cfg !== undefined,
    run: async (m, r) => {
      const item: Item = { id: m.nextId++, poison: p === 0 };
      m.buffer.push(item);
      r.exec!(item).then(
        (v) => {
          r.events++;
          r.outcomes.set(item.id, `ok:${v}`);
        },
        (e: unknown) => {
          r.events++;
          r.outcomes.set(item.id, `rej:${reasonText(e)}`);
        },
      );
      await flush(r);
      compare(m, r);
    },
  }),
);

const tickCmd = Arb.constant<ST.AsyncCommand<Model, Real>>({
  name: "tick",
  check: (m) => m.cfg !== undefined,
  run: async (m, r) => {
    tickModel(m);
    await setImmediatePromise();
    await flush(r);
    compare(m, r);
  },
});

const settleCmd = (model: Model) =>
  Arb.map(
    Arb.tuple(
      Arb.integer(0, Math.max(0, model.inflight.length - 1)),
      Arb.constantFrom<SettleKind>("ok", "ok", "err", "mismatch"),
    ),
    ([pos, kind]): ST.AsyncCommand<Model, Real> => ({
      name: `settle(#${pos},${kind})`,
      check: (m) => m.cfg !== undefined && pos < m.inflight.length,
      run: async (m, r) => {
        const entry = settleModel(m, pos, kind);
        const inv = r.invocations[entry.inv];
        inv.settled = true;
        if (kind === "ok") {
          inv.resolve(inv.ids.map(itemResult));
        } else if (kind === "err") {
          inv.reject(new Error(`e${entry.inv}`));
        } else {
          inv.resolve([...inv.ids, -1].map(itemResult));
        }
        await flush(r);
        compare(m, r);
      },
    }),
  );

test("stateful: BatchExecutor maxBatchSize/maxInFlight queueing matches oracle", async () => {
  await ST.assertStatefulAsync<Model, Real>({
    initialModel: () => ({
      cfg: undefined,
      nextId: 0,
      buffer: [],
      queue: [],
      inflight: [],
      invocations: [],
      outcomes: new Map(),
    }),
    initialReal: () => ({ exec: undefined, invocations: [], outcomes: new Map(), events: 0 }),
    commands: [
      (model) =>
        model.cfg === undefined
          ? initCmd
          : Arb.frequency(
              { weight: 4, arb: callCmd },
              { weight: 2, arb: tickCmd },
              { weight: 3, arb: settleCmd(model) },
            ),
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
