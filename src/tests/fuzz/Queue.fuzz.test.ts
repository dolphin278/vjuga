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
  const arb = Arb.array(
    Arb.constantFrom<"push" | "pop" | "shift">("push", "pop", "shift"),
    { minLength: 0, maxLength: 100 },
  );

  Prop.assert(arb, (ops) => {
    const q = Queue.make<number>();
    let expected = 0;
    let counter = 0;
    for (const op of ops) {
      if (op === "push") {
        Queue.push(q, counter++);
        expected++;
      } else if (op === "pop") {
        if (expected > 0) { Queue.pop(q); expected--; }
      } else {
        if (expected > 0) { Queue.shift(q); expected--; }
      }
    }
    return Queue.size(q) === expected;
  }, { numRuns: 1_000_000 });
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
  Arb.constant<ST.Command<Model, Real>>({ name: `${tag}(skip)`, check: () => false, run: () => {} });

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
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
