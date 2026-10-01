import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as BF from "../../BloomFilter.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

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
        assert.equal(
          BF.mightContain(real, item),
          false,
          `mightContain("${item}") true after clear`,
        );
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

// ---------------------------------------------------------------------------
// Statistical: measured FPR tracks the exact theoretical FPR for any key family.
// numRuns is intentionally below 1M: every run builds a filter of up to 3000 items
// and probes 20k absent keys (~2 ms), so 1M runs would take 30+ minutes without
// adding statistical power (the bound is already ~5 sigma).
// ---------------------------------------------------------------------------

test("BloomFilter property: measured FPR <= theoretical FPR (+noise) across key families", () => {
  const unit = [
    (i: number, p: string) => p + i,
    (i: number, p: string) => p + String.fromCharCode(0x4e00 + (i % 5000), (0x4e00 + i / 5000) | 0),
    (i: number, p: string) =>
      p +
      String.fromCharCode(
        0x4100 + ((i % 50) << 8),
        0x4100 + ((((i / 50) | 0) % 50) << 8),
        0x4100 + (((i / 2500) | 0) << 8),
      ),
    (i: number, p: string) => p + i.toString(36) + String.fromCharCode(0xd800 + (i % 1000)),
    (i: number, p: string) => p + (Math.imul(i, 0x9e3779b1) >>> 0).toString(16),
  ];
  Prop.assert(
    Arb.tuple(
      Arb.integer(500, 3000),
      Arb.constantFrom(0.1, 0.01, 0.001),
      Arb.integer(0, unit.length - 1),
      Arb.string({ minLength: 0, maxLength: 6 }),
    ),
    ([n, fpr, fam, prefix]) => {
      const key = unit[fam];
      const bf = BF.make(n, fpr);
      for (let i = 0; i < n; i++) BF.add(bf, key(i, prefix));
      const m = BF.bitCount(bf);
      const k = BF.hashCount(bf);
      const expected = Math.pow(1 - Math.exp((-k * n) / m), k);
      const probes = 20_000;
      let fp = 0;
      for (let i = n; i < n + probes; i++) if (BF.mightContain(bf, key(i, prefix))) fp++;
      const measured = fp / probes;
      // Double hashing has an irreducible floor: a probe that shares (h1 mod m, h2 mod m) with
      // any member (prob ~ 2n/m^2) is always a false positive, however large k is.
      const floor = (2 * n) / (m * m);
      const rate = expected * 1.25 + 3 * floor;
      const bound = rate + 5 * Math.sqrt(rate / probes) + 1 / probes;
      return measured <= bound && measured <= fpr * 1.0001 + 5 * Math.sqrt(fpr / probes);
    },
    { numRuns: 5000 },
  );
});
