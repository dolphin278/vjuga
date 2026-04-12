import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as BF from "../BloomFilter.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAPACITY = 500;
const itemArb = Arb.string({ minLength: 1, maxLength: 8 });

// ---------------------------------------------------------------------------
// Oracle model — Set<string>
// ---------------------------------------------------------------------------

interface BFModel {
  set: Set<string>;
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

type BFReal = BF.BloomFilter;

function biasedItem(model: BFModel): Arb.Arbitrary<string> {
  const keys = [...model.set];
  return keys.length > 0
    ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), itemArb)
    : itemArb;
}

const addCmd: ST.CommandArbitrary<BFModel, BFReal> = (_model) =>
  Arb.map(itemArb, (item) => ({
    name: `add(${item})`,
    check: () => true,
    run: (m: BFModel, real: BFReal) => {
      BF.add(real, item);
      m.set.add(item);
      // No-false-negatives invariant: after add, mightContain must be true
      assert.equal(BF.mightContain(real, item), true, `mightContain(${item}) false after add`);
    },
  }));

const mightContainCmd: ST.CommandArbitrary<BFModel, BFReal> = (model) =>
  Arb.map(biasedItem(model), (item) => ({
    name: `mightContain(${item})`,
    check: () => true,
    run: (m: BFModel, real: BFReal) => {
      const inModel = m.set.has(item);
      const result = BF.mightContain(real, item);
      // No-false-negatives: if model has item, filter must return true.
      if (inModel) {
        assert.equal(result, true, `false negative for ${item}`);
      }
      // False positives are allowed — no assertion on !inModel case.
    },
  }));

const countCmd: ST.CommandArbitrary<BFModel, BFReal> = (_model) =>
  Arb.constant<ST.Command<BFModel, BFReal>>({
    name: "count",
    check: () => true,
    run: (m: BFModel, real: BFReal) => {
      // count() tracks additions, not unique items — just verify it's ≥ set size
      assert.ok(BF.count(real) >= m.set.size, "count should be >= unique items added");
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test
// ---------------------------------------------------------------------------

test("BloomFilter stateful model-based fuzz test", () => {
  ST.assertStateful({
    initialModel: (): BFModel => ({ set: new Set() }),
    initialReal: () => BF.make(CAPACITY, 0.01),
    commands: [addCmd, mightContainCmd, countCmd],
    numRuns: 200,
    maxCommands: 50,
  });
});

// ---------------------------------------------------------------------------
// Property: add(x); mightContain(x) === true always (no false negatives)
// ---------------------------------------------------------------------------

test("BloomFilter property: mightContain always true after add", () => {
  Prop.assert(
    itemArb,
    (item) => {
      const bf = BF.make(CAPACITY, 0.01);
      BF.add(bf, item);
      assert.equal(BF.mightContain(bf, item), true, `false negative for "${item}"`);
    },
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Property: add multiple items; all must mightContain === true
// ---------------------------------------------------------------------------

test("BloomFilter property: all added items return mightContain true", () => {
  const arb = Arb.array(itemArb, { minLength: 1, maxLength: 50 });
  Prop.assert(
    arb,
    (items) => {
      const bf = BF.make(CAPACITY, 0.01);
      for (const item of items) BF.add(bf, item);
      for (const item of items) {
        assert.equal(BF.mightContain(bf, item), true, `false negative for "${item}"`);
      }
    },
    { numRuns: 500 },
  );
});
