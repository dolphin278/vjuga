import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Pool from "../../MemoryPool.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
interface Obj {
  id: number;
}

function makePool(maxSize = 10): Pool.MemoryPool<Obj> {
  counter = 0;
  return Pool.make({ factory: () => ({ id: counter++ }), maxSize });
}

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

test("acquire/release cycle reuses objects without new allocations", () => {
  Prop.assert(
    Arb.integer(1, 10),
    (n) => {
      const pool = makePool(n);
      const objs: Obj[] = [];
      for (let i = 0; i < n; i++) objs.push(Pool.acquire(pool));
      for (const obj of objs) Pool.release(pool, obj);
      // Acquire again — should get the same objects (LIFO), no new allocations
      const before = counter;
      for (let i = 0; i < n; i++) Pool.acquire(pool);
      return counter === before;
    },
    { numRuns: 1_000_000 },
  );
});

test("withAcquire returns fn result and releases", () => {
  Prop.assert(
    Arb.integer(-1000, 1000),
    (val) => {
      const pool = makePool(10);
      const result = Pool.withAcquire(pool, (_obj) => val);
      if (result !== val) return false;
      // Object was released — acquiring again should reuse, not create new
      const before = counter;
      const obj2 = Pool.acquire(pool);
      Pool.release(pool, obj2);
      return counter === before;
    },
    { numRuns: 1_000_000 },
  );
});

test("exhaustion throws when acquiring beyond maxSize", () => {
  Prop.assert(
    Arb.integer(1, 10),
    (maxSize) => {
      const pool = makePool(maxSize);
      for (let i = 0; i < maxSize; i++) Pool.acquire(pool);
      try {
        Pool.acquire(pool);
        return false;
      } catch (e) {
        return e instanceof Pool.MemoryPoolExhaustedError;
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Stateful model-based fuzz test
// ---------------------------------------------------------------------------

interface Model {
  acquired: Obj[];
  maxSize: number;
}

interface Real {
  pool: Pool.MemoryPool<Obj>;
}

test("stateful: MemoryPool matches model under random operations", () => {
  const maxSize = 10;

  ST.assertStateful<Model, Real>({
    initialModel: () => ({ acquired: [], maxSize }),
    initialReal: () => {
      counter = 0;
      return { pool: Pool.make({ factory: () => ({ id: counter++ }), maxSize }) };
    },
    commands: [
      // Acquire
      (_model) =>
        Arb.constant({
          name: "acquire",
          check: (m: Model) => m.acquired.length < m.maxSize,
          run: (m, r) => {
            const obj = Pool.acquire(r.pool);
            m.acquired.push(obj);
          },
        }),

      // Release
      (model) => {
        if (model.acquired.length === 0) {
          return Arb.constant({
            name: "release(skip)",
            check: () => false,
            run: () => {},
          });
        }
        return Arb.map(Arb.integer(0, Math.max(0, model.acquired.length - 1)), (idx) => ({
          name: `release(idx=${idx})`,
          check: (m: Model) => m.acquired.length > 0,
          run: (m, r) => {
            const safeIdx = Math.min(idx, m.acquired.length - 1);
            const obj = m.acquired.splice(safeIdx, 1)[0]!;
            Pool.release(r.pool, obj);
          },
        }));
      },

      // withAcquire
      (_model) =>
        Arb.map(Arb.integer(0, 1000), (val) => ({
          name: `withAcquire(=> ${val})`,
          check: (m: Model) => m.acquired.length < m.maxSize,
          run: (_m, r) => {
            const result = Pool.withAcquire(r.pool, () => val);
            assert.equal(result, val, "withAcquire return value");
          },
        })),

      // Size consistency check
      (_model) =>
        Arb.constant({
          name: "sizeCheck",
          check: () => true,
          run: (m, r) => {
            // Acquiring the rest up to maxSize should succeed
            const remaining = m.maxSize - m.acquired.length;
            const temp: Obj[] = [];
            for (let i = 0; i < remaining; i++) {
              temp.push(Pool.acquire(r.pool));
            }
            // Now pool should be exhausted
            assert.throws(
              () => Pool.acquire(r.pool),
              Pool.MemoryPoolExhaustedError,
              "pool should be exhausted",
            );
            // Release temp objects back
            for (const obj of temp) Pool.release(r.pool, obj);
          },
        }),
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});

// ---------------------------------------------------------------------------
// Stateful: throwing factory/reset, minSize, reset calls, identity disjointness
// ---------------------------------------------------------------------------

const MAX = 6;
let runCounter = 0;

interface Env {
  failFactory: boolean;
  failReset: boolean;
  minSize: number;
  created: Obj[];
  resetCalls: Obj[];
}

interface FModel {
  init: boolean;
  held: Obj[]; // acquired and not yet released
  free: Obj[]; // expected free list (LIFO: pop from the end)
}

interface FReal {
  pool: Pool.MemoryPool<Obj>;
  env: Env;
}

/** Lazily seed the model's free list from the objects pre-allocated by minSize. */
function sync(m: FModel, r: FReal): void {
  if (!m.init) {
    m.init = true;
    m.free = r.env.created.slice();
  }
}

test("stateful: MemoryPool with throwing factory/reset, minSize and identity checks", () => {
  ST.assertStateful<FModel, FReal>({
    initialModel: () => ({ init: false, held: [], free: [] }),
    initialReal: () => {
      const env: Env = {
        failFactory: false,
        failReset: false,
        minSize: runCounter++ % 4,
        created: [],
        resetCalls: [],
      };
      const pool = Pool.make<Obj>({
        factory: () => {
          if (env.failFactory) throw new Error("factory");
          const o = { id: env.created.length };
          env.created.push(o);
          return o;
        },
        reset: (o) => {
          env.resetCalls.push(o);
          if (env.failReset) throw new Error("reset");
        },
        maxSize: MAX,
        minSize: env.minSize,
      });
      return { pool, env };
    },
    commands: [
      () =>
        Arb.constant({
          name: "acquire",
          run: (m, r) => {
            sync(m, r);
            if (m.free.length > 0) {
              const obj = Pool.acquire(r.pool);
              assert.equal(obj, m.free.pop(), "LIFO identity");
              m.held.push(obj);
            } else if (m.held.length >= MAX) {
              assert.throws(() => Pool.acquire(r.pool), Pool.MemoryPoolExhaustedError);
            } else if (r.env.failFactory) {
              // A failed factory must not consume a slot: later acquires (model
              // keeps held unchanged) must still succeed up to MAX.
              assert.throws(() => Pool.acquire(r.pool), /factory/);
            } else {
              const obj = Pool.acquire(r.pool);
              assert.ok(!m.held.includes(obj), "fresh object is disjoint from held");
              m.held.push(obj);
            }
          },
        }),
      (model) =>
        Arb.map(Arb.integer(0, Math.max(0, model.held.length - 1)), (idx) => ({
          name: `release(${idx})`,
          check: (m: FModel) => m.held.length > 0,
          run: (m, r) => {
            sync(m, r);
            const obj = m.held.splice(Math.min(idx, m.held.length - 1), 1)[0]!;
            const before = r.env.resetCalls.length;
            if (r.env.failReset) {
              // Dirty instance is dropped, not recycled; its slot is freed.
              assert.throws(() => Pool.release(r.pool, obj), /reset/);
            } else {
              Pool.release(r.pool, obj);
              m.free.push(obj);
            }
            assert.equal(r.env.resetCalls.length, before + 1, "reset called exactly once");
            assert.equal(r.env.resetCalls[before], obj, "reset received the released instance");
          },
        })),
      () =>
        Arb.map(Arb.boolean(), (value) => ({
          name: `failFactory=${value}`,
          run: (_m, r) => {
            r.env.failFactory = value;
          },
        })),
      () =>
        Arb.map(Arb.boolean(), (value) => ({
          name: `failReset=${value}`,
          run: (_m, r) => {
            r.env.failReset = value;
          },
        })),
      () =>
        Arb.map(Arb.boolean(), (userThrows) => ({
          name: `withAcquire(userThrows=${userThrows})`,
          run: (m, r) => {
            sync(m, r);
            if (m.free.length === 0 && (m.held.length >= MAX || r.env.failFactory)) return;
            const expectedObj = m.free.length > 0 ? m.free.pop() : undefined;
            let seen: Obj | undefined;
            const body = (o: Obj): number => {
              seen = o;
              if (userThrows) throw new Error("user");
              return 7;
            };
            if (userThrows) {
              // The user's error wins even when reset also throws.
              assert.throws(() => Pool.withAcquire(r.pool, body), /user/);
            } else if (r.env.failReset) {
              assert.throws(() => Pool.withAcquire(r.pool, body), /reset/);
            } else {
              assert.equal(Pool.withAcquire(r.pool, body), 7);
            }
            if (expectedObj !== undefined) assert.equal(seen, expectedObj);
            // Recycled unless reset threw.
            if (!r.env.failReset) m.free.push(seen!);
          },
        })),
      () =>
        Arb.constant({
          name: "invariants",
          run: (m, r) => {
            sync(m, r);
            const all = [...m.held, ...m.free];
            assert.equal(new Set(all).size, all.length, "held and free are disjoint");
            assert.ok(all.length <= MAX, "never more live objects than maxSize");
          },
        }),
    ],
    numRuns: 1_000_000,
    maxCommands: 40,
    timeoutMs: 300_000,
  });
});
