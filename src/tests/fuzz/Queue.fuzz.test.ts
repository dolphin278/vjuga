import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Queue from "../../Queue.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

test("push N items then toArray returns them in order", () => {
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { minLength: 0, maxLength: 50 }),
    (items) => {
      const q = Queue.make<number>();
      for (const v of items) Queue.push(q, v);
      const arr = Queue.toArray(q);
      if (arr.length !== items.length) return false;
      return arr.every((v, i) => v === items[i]);
    },
    { numRuns: 1_000_000 },
  );
});

test("push N then shift N returns FIFO order", () => {
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { minLength: 0, maxLength: 50 }),
    (items) => {
      const q = Queue.make<number>();
      for (const v of items) Queue.push(q, v);
      for (let i = 0; i < items.length; i++) {
        if (Queue.shift(q) !== items[i]) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("size equals pushes minus pops and shifts", () => {
  const arb = Arb.array(Arb.constantFrom<"push" | "pop" | "shift">("push", "pop", "shift"), {
    minLength: 0,
    maxLength: 100,
  });

  Prop.assert(
    arb,
    (ops) => {
      const q = Queue.make<number>();
      let expected = 0;
      let counter = 0;
      for (const op of ops) {
        if (op === "push") {
          Queue.push(q, counter++);
          expected++;
        } else if (op === "pop") {
          if (expected > 0) {
            Queue.pop(q);
            expected--;
          }
        } else {
          if (expected > 0) {
            Queue.shift(q);
            expected--;
          }
        }
      }
      return Queue.size(q) === expected;
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// dumpToArray on large queues (G6-3): returns the contents in order, releases
// oversized buffers with hysteresis (room for the larger of the two previous
// dumps is kept, so steady batches never regrow) and stays fully usable.
// numRuns is intentionally
// below 1M: each run pushes up to 4 × 40k items (~1 ms per run).
// ---------------------------------------------------------------------------

const capacityOf = (q: object): number => {
  const sym = Object.getOwnPropertySymbols(q).find((s) => s.description === "list")!;
  return ((q as Record<symbol, unknown[]>)[sym] as unknown[]).length;
};

test("dumpToArray on large (possibly wrapped) queues releases with hysteresis and stays usable", () => {
  Prop.assert(
    Arb.tuple(
      Arb.array(Arb.tuple(Arb.integer(0, 40_000), Arb.integer(0, 40_000)), {
        minLength: 1,
        maxLength: 4,
      }),
      Arb.array(Arb.tuple(Arb.integer(0, 3), Arb.integer(0, 10000)), { maxLength: 40 }),
    ),
    ([rounds, ops]) => {
      const q = Queue.make<number>();
      let last = 0;
      let prev = 0;
      for (const [n, rot] of rounds) {
        for (let i = 0; i < n; i++) Queue.push(q, i);
        // Rotate so head/tail wrap around the ring before the dump. The model
        // is the contiguous range [rotate, n + rotate).
        const rotate = n > 0 ? rot : 0;
        for (let i = 0; i < rotate; i++) Queue.push(q, Queue.shift(q)! + n);
        const before = capacityOf(q);
        const out = Queue.dumpToArray(q);
        if (out.length !== n) return false;
        for (let i = 0; i < n; i++) if (out[i] !== i + rotate) return false;
        if (Queue.size(q) !== 0) return false;
        const after = capacityOf(q);
        const keep = Math.max(last, prev);
        prev = last;
        last = n;
        if (after > before || (after & (after - 1)) !== 0) return false;
        // Never shrinks below what the two previous dumps needed (no regrowth)...
        if (after !== before && after <= keep) return false;
        // ...and a large buffer never keeps more than 2× that.
        if (before > 10_000 && after > Math.max(4, 2 * keep)) return false;
      }
      const m: number[] = [];
      for (const [op, v] of ops) {
        if (op === 0) {
          Queue.push(q, v);
          m.push(v);
        } else if (op === 1) {
          Queue.unshift(q, v);
          m.unshift(v);
        } else if (op === 2) {
          if (Queue.shift(q) !== m.shift()) return false;
        } else if (Queue.pop(q) !== m.pop()) return false;
      }
      assert.deepEqual(Queue.toArray(q), m);
      // Once the history holds only small dumps, a large buffer is released.
      for (let i = 0; i < 3; i++) Queue.dumpToArray(q);
      return capacityOf(q) <= 10_000;
    },
    { numRuns: 2000 },
  );
});

// ---------------------------------------------------------------------------
// Stateful model-based fuzz test
// ---------------------------------------------------------------------------

interface Model {
  arr: number[];
}

type Real = Queue.Queue<number>;

/** Placeholder command skipped via `check: () => false` when the queue is empty. */
const skipCmd = (tag: string) =>
  Arb.constant<ST.Command<Model, Real>>({
    name: `${tag}(skip)`,
    check: () => false,
    run: () => {},
  });

test("stateful: Queue matches array model under random operations", () => {
  ST.assertStateful<Model, Real>({
    initialModel: () => ({ arr: [] }),
    initialReal: () => Queue.make(),
    commands: [
      // push
      (_model) =>
        Arb.map(Arb.integer(0, 10000), (v) => ({
          name: `push(${v})`,
          check: () => true,
          run: (m, r) => {
            m.arr.push(v);
            Queue.push(r, v);
          },
        })),

      // pop
      (_model) =>
        Arb.constant({
          name: "pop",
          check: (m: Model) => m.arr.length > 0,
          run: (m: Model, r: Real) => {
            const expected = m.arr.pop();
            const actual = Queue.pop(r);
            assert.equal(actual, expected, "pop mismatch");
          },
        }),

      // shift
      (_model) =>
        Arb.constant({
          name: "shift",
          check: (m: Model) => m.arr.length > 0,
          run: (m: Model, r: Real) => {
            const expected = m.arr.shift();
            const actual = Queue.shift(r);
            assert.equal(actual, expected, "shift mismatch");
          },
        }),

      // unshift
      (_model) =>
        Arb.map(Arb.integer(0, 10000), (v) => ({
          name: `unshift(${v})`,
          check: () => true,
          run: (m, r) => {
            m.arr.unshift(v);
            Queue.unshift(r, v);
          },
        })),

      // peekFront
      (_model) =>
        Arb.constant({
          name: "peekFront",
          check: (m: Model) => m.arr.length > 0,
          run: (m: Model, r: Real) => {
            assert.equal(Queue.peekFront(r), m.arr[0], "peekFront mismatch");
          },
        }),

      // peekBack
      (_model) =>
        Arb.constant({
          name: "peekBack",
          check: (m: Model) => m.arr.length > 0,
          run: (m: Model, r: Real) => {
            assert.equal(Queue.peekBack(r), m.arr[m.arr.length - 1], "peekBack mismatch");
          },
        }),

      // size
      (_model) =>
        Arb.constant({
          name: "size",
          check: () => true,
          run: (m: Model, r: Real) => {
            assert.equal(Queue.size(r), m.arr.length, "size mismatch");
          },
        }),

      // get(i)
      (model) => {
        const len = model.arr.length;
        if (len === 0) return skipCmd("get");
        return Arb.map(Arb.integer(0, len - 1), (i) => ({
          name: `get(${i})`,
          check: (m: Model) => i < m.arr.length,
          run: (m: Model, r: Real) => {
            assert.equal(Queue.get(r, i), m.arr[i], `get(${i}) mismatch`);
          },
        }));
      },

      // set(i, v)
      (model) => {
        const len = model.arr.length;
        if (len === 0) return skipCmd("set");
        return Arb.map(Arb.tuple(Arb.integer(0, len - 1), Arb.integer(0, 10000)), ([i, v]) => ({
          name: `set(${i}, ${v})`,
          check: (m: Model) => i < m.arr.length,
          run: (m: Model, r: Real) => {
            m.arr[i] = v;
            Queue.set(r, i, v);
          },
        }));
      },

      // swap(i, j)
      (model) => {
        const len = model.arr.length;
        if (len === 0) return skipCmd("swap");
        return Arb.map(Arb.tuple(Arb.integer(0, len - 1), Arb.integer(0, len - 1)), ([i, j]) => ({
          name: `swap(${i}, ${j})`,
          check: (m: Model) => i < m.arr.length && j < m.arr.length,
          run: (m: Model, r: Real) => {
            const tmp = m.arr[i]!;
            m.arr[i] = m.arr[j]!;
            m.arr[j] = tmp;
            Queue.swap(r, i, j);
          },
        }));
      },

      // toArray
      (_model) =>
        Arb.constant({
          name: "toArray",
          check: () => true,
          run: (m: Model, r: Real) => {
            assert.deepEqual(Queue.toArray(r), m.arr, "toArray mismatch");
          },
        }),

      // dumpToArray
      (_model) =>
        Arb.constant({
          name: "dumpToArray",
          check: () => true,
          run: (m: Model, r: Real) => {
            assert.deepEqual(Queue.dumpToArray(r), m.arr, "dumpToArray mismatch");
            m.arr = [];
            assert.equal(Queue.size(r), 0, "dumpToArray must empty the queue");
          },
        }),
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
