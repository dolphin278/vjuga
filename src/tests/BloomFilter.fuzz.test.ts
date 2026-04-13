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
const itemArb = Arb.string({ minLength: 0, maxLength: 12 });

// ---------------------------------------------------------------------------
// Oracle model — Set<string>
// ---------------------------------------------------------------------------

interface BFModel {
  set: Set<string>;
  addCount: number; // total add() calls (includes duplicates)
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
    name: `add(${JSON.stringify(item)})`,
    run: (m: BFModel, real: BFReal) => {
      BF.add(real, item);
      m.set.add(item);
      m.addCount++;
      // No-false-negatives invariant: after add, mightContain must be true.
      assert.equal(BF.mightContain(real, item), true, `false negative for "${item}"`);
    },
  }));

const mightContainCmd: ST.CommandArbitrary<BFModel, BFReal> = (model) =>
  Arb.map(biasedItem(model), (item) => ({
    name: `mightContain(${JSON.stringify(item)})`,
    run: (m: BFModel, real: BFReal) => {
      const result = BF.mightContain(real, item);
      // No-false-negatives: if model has item, filter must return true.
      if (m.set.has(item)) {
        assert.equal(result, true, `false negative for "${item}"`);
      }
    },
  }));

const countCmd: ST.CommandArbitrary<BFModel, BFReal> = (_model) =>
  Arb.constant<ST.Command<BFModel, BFReal>>({
    name: "count",
    run: (m: BFModel, real: BFReal) => {
      // count() tracks total add() calls, not unique items.
      assert.equal(BF.count(real), m.addCount, "count() mismatch");
    },
  });

const clearCmd: ST.CommandArbitrary<BFModel, BFReal> = (_model) =>
  Arb.constant<ST.Command<BFModel, BFReal>>({
    name: "clear",
    run: (m: BFModel, real: BFReal) => {
      // Snapshot items before clearing — we'll verify none are found after.
      const prevItems = [...m.set];
      BF.clear(real);
      m.set.clear();
      m.addCount = 0;
      assert.equal(BF.count(real), 0, "count must be 0 after clear");
      // All bits are 0 after clear — mightContain must return false for everything.
      // (The filter needs ALL k probe positions set; a fresh zero array fails on probe 1.)
      for (const item of prevItems) {
        assert.equal(BF.mightContain(real, item), false, `mightContain("${item}") true after clear`);
      }
    },
  });

const bitHashInvariantCmd: ST.CommandArbitrary<BFModel, BFReal> = (_model) =>
  Arb.constant<ST.Command<BFModel, BFReal>>({
    name: "bitHashInvariant",
    run: (_m: BFModel, real: BFReal) => {
      const m = BF.bitCount(real);
      assert.ok(m >= 32, "bitCount must be ≥ 32");
      // bitCount must be a power of 2
      assert.equal(m & (m - 1), 0, "bitCount must be a power of 2");
      assert.ok(BF.hashCount(real) >= 1, "hashCount must be ≥ 1");
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test — 1M runs, 50 commands per sequence
// ---------------------------------------------------------------------------

test("BloomFilter stateful model-based fuzz test", { timeout: 300_000 }, () => {
  ST.assertStateful({
    initialModel: (): BFModel => ({ set: new Set(), addCount: 0 }),
    initialReal: () => BF.make(CAPACITY, 0.01),
    commands: [addCmd, mightContainCmd, countCmd, clearCmd, bitHashInvariantCmd],
    numRuns: 1_000_000,
    maxCommands: 50,
  });
});

// ---------------------------------------------------------------------------
// Property: add(x); mightContain(x) === true, for all strings including edge
// cases — empty string, unicode, long strings, strings with null bytes
// ---------------------------------------------------------------------------

test("BloomFilter property: no false negatives (varied strings)", () => {
  const edgeCaseArb = Arb.oneOf(
    itemArb,
    Arb.constant(""),
    Arb.string({ minLength: 100, maxLength: 200 }),
    Arb.constantFrom("\x00", "\uFFFF", "\u0001\u0002"),
  );
  Prop.assert(
    edgeCaseArb,
    (item) => {
      const bf = BF.make(CAPACITY, 0.01);
      BF.add(bf, item);
      assert.equal(BF.mightContain(bf, item), true, `false negative for "${item}"`);
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: all items added before clear are absent afterwards
// ---------------------------------------------------------------------------

test("BloomFilter property: clear empties the filter", () => {
  const arb = Arb.array(itemArb, { minLength: 1, maxLength: 30 });
  Prop.assert(
    arb,
    (items) => {
      const bf = BF.make(CAPACITY, 0.01);
      for (const item of items) BF.add(bf, item);
      BF.clear(bf);
      assert.equal(BF.count(bf), 0, "count must be 0 after clear");
      // All bits are zero — every probe fails on word 0 position 0.
      for (const item of items) {
        assert.equal(BF.mightContain(bf, item), false, `"${item}" still found after clear`);
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: add multiple items; all must still be found
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
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: count() equals number of add() calls, including duplicates
// ---------------------------------------------------------------------------

test("BloomFilter property: count equals add calls including duplicates", () => {
  const arb = Arb.array(itemArb, { minLength: 0, maxLength: 40 });
  Prop.assert(
    arb,
    (items) => {
      const bf = BF.make(CAPACITY, 0.01);
      for (const item of items) BF.add(bf, item);
      assert.equal(BF.count(bf), items.length, "count should equal items.length");
    },
    { numRuns: 1_000_000 },
  );
});
