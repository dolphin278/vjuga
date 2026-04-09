import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Pool from "../MemoryPool.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
interface Obj { id: number }

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
    { numRuns: 500 },
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
    { numRuns: 500 },
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
    { numRuns: 500 },
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
        return Arb.map(
          Arb.integer(0, Math.max(0, model.acquired.length - 1)),
          (idx) => ({
            name: `release(idx=${idx})`,
            check: (m: Model) => m.acquired.length > 0,
            run: (m, r) => {
              const safeIdx = Math.min(idx, m.acquired.length - 1);
              const obj = m.acquired.splice(safeIdx, 1)[0]!;
              Pool.release(r.pool, obj);
            },
          }),
        );
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
    numRuns: 200,
    maxCommands: 50,
  });
});
