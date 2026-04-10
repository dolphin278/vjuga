import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as SOA from "../SOA.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";
import * as PRNG from "../PRNG.js";

const fixedSeed = PRNG.seed(42n);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Point = {
  x: number;
  y: number;
};

type PointSOA = SOA.SOA<Point>;

interface Model {
  items: Point[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pointArb: Arb.Arbitrary<Point> = Arb.record<Point>({
  x: Arb.float(-1000, 1000),
  y: Arb.float(-1000, 1000),
});

function freshSOA(): PointSOA {
  return { x: [], y: [] };
}

function assertPointEqual(actual: Point, expected: Point, msg: string): void {
  assert.equal(actual.x, expected.x, `${msg} .x`);
  assert.equal(actual.y, expected.y, `${msg} .y`);
}

// ---------------------------------------------------------------------------
// Stateful model-based test
// ---------------------------------------------------------------------------

const pushCmd: ST.CommandArbitrary<Model, PointSOA> = (_model) =>
  Arb.map(
    pointArb,
    (pt): ST.Command<Model, PointSOA> => ({
      name: `push({x:${pt.x},y:${pt.y}})`,
      check: () => true,
      run: (model, soa) => {
        model.items.push(pt);
        SOA.push(soa, pt);
      },
    }),
  );

const popCmd: ST.CommandArbitrary<Model, PointSOA> = (_model) =>
  Arb.constant<ST.Command<Model, PointSOA>>({
    name: "pop",
    check: (model) => model.items.length > 0,
    run: (model, soa) => {
      const expected = model.items.pop()!;
      const actual = SOA.pop(soa);
      assertPointEqual(actual, expected, "pop");
    },
  });

const getCmd: ST.CommandArbitrary<Model, PointSOA> = (model) =>
  Arb.map(
    Arb.nat(Math.max(0, model.items.length - 1)),
    (i): ST.Command<Model, PointSOA> => ({
      name: `get(${i})`,
      check: (m) => i < m.items.length,
      run: (m, soa) => {
        const expected = m.items[i]!;
        const actual = SOA.get(soa, i);
        assertPointEqual(actual, expected, `get(${i})`);
      },
    }),
  );

const setCmd: ST.CommandArbitrary<Model, PointSOA> = (model) =>
  Arb.map(
    Arb.tuple(Arb.nat(Math.max(0, model.items.length - 1)), pointArb),
    ([i, pt]): ST.Command<Model, PointSOA> => ({
      name: `set(${i},{x:${pt.x},y:${pt.y}})`,
      check: (m) => i < m.items.length,
      run: (m, soa) => {
        m.items[i] = pt;
        SOA.set(soa, i, pt);
      },
    }),
  );

const lengthCmd: ST.CommandArbitrary<Model, PointSOA> = (_model) =>
  Arb.constant<ST.Command<Model, PointSOA>>({
    name: "length",
    check: () => true,
    run: (model, soa) => {
      assert.equal(SOA.length(soa), model.items.length, "length mismatch");
    },
  });

const swapRemoveCmd: ST.CommandArbitrary<Model, PointSOA> = (model) =>
  Arb.map(
    Arb.nat(Math.max(0, model.items.length - 1)),
    (i): ST.Command<Model, PointSOA> => ({
      name: `swapRemove(${i})`,
      check: (m) => i < m.items.length,
      run: (m, soa) => {
        const last = m.items.length - 1;
        if (i !== last) {
          m.items[i] = m.items[last]!;
        }
        m.items.pop();
        SOA.swapRemove(soa, i);
      },
    }),
  );

const clearCmd: ST.CommandArbitrary<Model, PointSOA> = (_model) =>
  Arb.constant<ST.Command<Model, PointSOA>>({
    name: "clear",
    check: () => true,
    run: (model, soa) => {
      model.items.length = 0;
      SOA.clear(soa);
    },
  });

const getSliceCmd: ST.CommandArbitrary<Model, PointSOA> = (_model) =>
  Arb.map(
    Arb.constantFrom<"x" | "y">("x", "y"),
    (field): ST.Command<Model, PointSOA> => ({
      name: `getSlice("${field}")`,
      check: () => true,
      run: (model, soa) => {
        const expected = model.items.map((item) => item[field]);
        const actual = SOA.getSlice(soa, field);
        assert.deepEqual(actual, expected, `getSlice("${field}") mismatch`);
      },
    }),
  );

test("SOA stateful model-based test", () => {
  ST.assertStateful({
    initialModel: () => ({ items: [] }),
    initialReal: freshSOA,
    commands: [pushCmd, popCmd, getCmd, setCmd, lengthCmd, swapRemoveCmd, clearCmd, getSliceCmd],
    numRuns: 200,
    maxCommands: 50,
    seed: fixedSeed,
  });
});

// ---------------------------------------------------------------------------
// Property: push N items then get each returns same item
// ---------------------------------------------------------------------------

test("SOA push then get roundtrip", () => {
  Prop.assert(
    Arb.array(pointArb, { minLength: 1, maxLength: 100 }),
    (items) => {
      const soa = freshSOA();
      for (const item of items) SOA.push(soa, item);
      for (let i = 0; i < items.length; i++) {
        const got = SOA.get(soa, i);
        assertPointEqual(got, items[i]!, `roundtrip index ${i}`);
      }
    },
    { numRuns: 500, seed: fixedSeed },
  );
});

// ---------------------------------------------------------------------------
// Property: createView reflects correct values
// ---------------------------------------------------------------------------

test("SOA createView reflects correct values", () => {
  Prop.assert(
    Arb.array(pointArb, { minLength: 1, maxLength: 100 }),
    (items) => {
      const soa = freshSOA();
      for (const item of items) SOA.push(soa, item);
      const idx = items.length - 1;
      const view = SOA.createView(soa, idx);
      assert.equal(view.x, items[idx]!.x, "view.x mismatch");
      assert.equal(view.y, items[idx]!.y, "view.y mismatch");
      assert.equal(view.index, idx, "view.index mismatch");
      // Change index and verify
      if (items.length > 1) {
        view.index = 0;
        assert.equal(view.x, items[0]!.x, "view.x after reindex");
        assert.equal(view.y, items[0]!.y, "view.y after reindex");
      }
    },
    { numRuns: 500, seed: fixedSeed },
  );
});
