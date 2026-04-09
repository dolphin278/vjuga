import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PQ from "../PriorityQueue.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

const cmp = (a: number, b: number): number => a - b;

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

test("pop sequence is always sorted", () => {
  Prop.assert(
    Arb.array(Arb.integer(-10000, 10000), { minLength: 0, maxLength: 50 }),
    (values) => {
      const pq = PQ.make<number>(cmp);
      for (const v of values) PQ.push(pq, v);
      const result: number[] = [];
      while (PQ.size(pq) > 0) result.push(PQ.pop(pq)!);
      for (let i = 1; i < result.length; i++) {
        if (result[i] < result[i - 1]) return false;
      }
      return true;
    },
    { numRuns: 500 },
  );
});

test("heapify then pop all equals sort", () => {
  Prop.assert(
    Arb.array(Arb.integer(-10000, 10000), { minLength: 0, maxLength: 50 }),
    (arr) => {
      const pq = PQ.make<number>(cmp, arr);
      const result: number[] = [];
      while (PQ.size(pq) > 0) result.push(PQ.pop(pq)!);
      const sorted = arr.slice().sort(cmp);
      if (result.length !== sorted.length) return false;
      return result.every((v, i) => v === sorted[i]);
    },
    { numRuns: 500 },
  );
});

test("size tracks correctly through random push/pop interleaving", () => {
  const opArb = Arb.tuple(
    Arb.constantFrom("push", "pop"),
    Arb.integer(-10000, 10000),
  );

  Prop.assert(
    Arb.array(opArb, { minLength: 0, maxLength: 80 }),
    (ops) => {
      const pq = PQ.make<number>(cmp);
      let expectedSize = 0;
      for (const [op, val] of ops) {
        if (op === "push") {
          PQ.push(pq, val);
          expectedSize++;
        } else {
          PQ.pop(pq);
          if (expectedSize > 0) expectedSize--;
        }
        if (PQ.size(pq) !== expectedSize) return false;
      }
      return true;
    },
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Stateful model-based fuzz test
// ---------------------------------------------------------------------------

interface Model {
  items: number[];
}

interface Real {
  pq: PQ.PriorityQueue<number>;
}

test("stateful: PriorityQueue matches sorted-array model", () => {
  ST.assertStateful<Model, Real>({
    initialModel: () => ({ items: [] }),
    initialReal: () => ({ pq: PQ.make(cmp) }),
    commands: [
      // push
      (_model) =>
        Arb.map(Arb.integer(-10000, 10000), (v) => ({
          name: `push(${v})`,
          check: () => true,
          run: (m, r) => {
            m.items.push(v);
            m.items.sort(cmp);
            PQ.push(r.pq, v);
          },
        })),

      // pop
      (_model) =>
        Arb.constant({
          name: "pop",
          check: () => true,
          run: (m: Model, r: Real) => {
            const expected = m.items.shift();
            const actual = PQ.pop(r.pq);
            assert.equal(actual, expected, "pop mismatch");
          },
        }),

      // peek
      (_model) =>
        Arb.constant({
          name: "peek",
          check: () => true,
          run: (m: Model, r: Real) => {
            const expected = m.items[0];
            const actual = PQ.peek(r.pq);
            assert.equal(actual, expected, "peek mismatch");
          },
        }),

      // size
      (_model) =>
        Arb.constant({
          name: "size",
          check: () => true,
          run: (m: Model, r: Real) => {
            assert.equal(PQ.size(r.pq), m.items.length, "size mismatch");
          },
        }),
    ],
    numRuns: 200,
    maxCommands: 50,
  });
});
