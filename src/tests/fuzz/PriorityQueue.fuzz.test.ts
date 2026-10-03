import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PQ from "../../PriorityQueue.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

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
    { numRuns: 1_000_000 },
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
    { numRuns: 1_000_000 },
  );
});

test("size tracks correctly through random push/pop interleaving", () => {
  const opArb = Arb.tuple(Arb.constantFrom("push", "pop"), Arb.integer(-10000, 10000));

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
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Shrink policy (G6-4): large heaps release memory as they drain, without
// dropping elements. numRuns is intentionally below 1M: each run pushes
// 10k-30k items (the shrink threshold is 10 000 slots), ~3 ms per run.
// ---------------------------------------------------------------------------

const itemsLength = (pq: object): number => {
  const sym = Object.getOwnPropertySymbols(pq).find((s) => s.description === "items")!;
  return ((pq as Record<symbol, unknown[]>)[sym] as unknown[]).length;
};

test("pop shrink keeps order and bounds the backing array (large heaps)", () => {
  Prop.assert(
    Arb.tuple(
      Arb.integer(10_001, 30_000),
      Arb.boolean(),
      Arb.array(Arb.tuple(Arb.boolean(), Arb.integer(-50_000, 50_000)), { maxLength: 40 }),
      Arb.integer(0, 0x7fffffff),
    ),
    ([n, viaHeapify, tailOps, salt]) => {
      const values: number[] = [];
      for (let i = 0; i < n; i++) values.push((Math.imul(i ^ salt, 0x9e3779b1) % 40_000) | 0);
      let pq: PQ.PriorityQueue<number>;
      if (viaHeapify) {
        pq = PQ.make(cmp, values);
      } else {
        pq = PQ.make(cmp);
        for (const v of values) PQ.push(pq, v);
      }
      const model = values.slice().sort(cmp);
      let k = 0;
      // Drain to a random small remainder, checking the order on the way.
      const keep = (salt & 15) + 1;
      while (PQ.size(pq) > keep) {
        if (PQ.pop(pq) !== model[k++]) return false;
        // Live elements always fit; the array never lags far behind 4x usage.
        const len = itemsLength(pq);
        if (len < PQ.size(pq)) return false;
        if (len > 10_000 && len > 4 * (PQ.size(pq) + 1024)) return false;
      }
      if (itemsLength(pq) > 10_000) return false;
      // The shrunk heap still behaves like a sorted-array model.
      const rest = model.slice(k);
      for (const [isPush, v] of tailOps) {
        if (isPush) {
          PQ.push(pq, v);
          rest.push(v);
          rest.sort(cmp);
        } else if (PQ.pop(pq) !== rest.shift()) return false;
      }
      while (rest.length > 0) if (PQ.pop(pq) !== rest.shift()) return false;
      return PQ.size(pq) === 0 && PQ.pop(pq) === undefined;
    },
    { numRuns: 2000 },
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
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
