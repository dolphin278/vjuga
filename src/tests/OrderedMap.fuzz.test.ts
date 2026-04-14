import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as OM from "../OrderedMap.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ---------------------------------------------------------------------------
// Oracle model — sorted array of [key, value] pairs
// ---------------------------------------------------------------------------

interface OMModel {
  entries: [number, number][];
}

function modelSet(m: OMModel, k: number, v: number): void {
  const idx = m.entries.findIndex(([mk]) => mk === k);
  if (idx >= 0) {
    m.entries[idx] = [k, v];
  } else {
    m.entries.push([k, v]);
    m.entries.sort((a, b) => a[0] - b[0]);
  }
}

function modelGet(m: OMModel, k: number): number | undefined {
  const found = m.entries.find(([mk]) => mk === k);
  return found?.[1];
}

function modelHas(m: OMModel, k: number): boolean {
  return m.entries.some(([mk]) => mk === k);
}

function modelDel(m: OMModel, k: number): boolean {
  const idx = m.entries.findIndex(([mk]) => mk === k);
  if (idx < 0) return false;
  m.entries.splice(idx, 1);
  return true;
}

function modelMin(m: OMModel): [number, number] | undefined {
  return m.entries.length > 0 ? m.entries[0] : undefined;
}

function modelMax(m: OMModel): [number, number] | undefined {
  return m.entries.length > 0 ? m.entries[m.entries.length - 1] : undefined;
}

function modelFloor(m: OMModel, k: number): [number, number] | undefined {
  let best: [number, number] | undefined = undefined;
  for (const e of m.entries) {
    if (e[0] <= k) best = e;
  }
  return best;
}

function modelCeiling(m: OMModel, k: number): [number, number] | undefined {
  for (const e of m.entries) {
    if (e[0] >= k) return e;
  }
  return undefined;
}

function modelSize(m: OMModel): number {
  return m.entries.length;
}

function modelRange(m: OMModel, lo: number, hi: number): [number, number][] {
  return m.entries.filter(([k]) => k >= lo && k <= hi);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEY_RANGE = 50;
const keyArb = Arb.integer(0, KEY_RANGE - 1);
const valArb = Arb.integer(0, 999);

type OMReal = OM.OrderedMap<number, number>;

function biasedKey(model: OMModel): Arb.Arbitrary<number> {
  const keys = model.entries.map(([k]) => k);
  return keys.length > 0
    ? Arb.oneOf(Arb.constantFrom(...(keys as [number, ...number[]])), keyArb)
    : keyArb;
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

const setCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(Arb.tuple(keyArb, valArb), ([k, v]) => ({
    name: `set(${k}, ${v})`,
    run: (m: OMModel, real: OMReal) => {
      OM.set(real, k, v);
      modelSet(m, k, v);
      assert.equal(OM.size(real), modelSize(m), `size mismatch after set(${k})`);
      assert.equal(OM.get(real, k), v, `get(${k}) mismatch after set`);
    },
  }));

const getCmd: ST.CommandArbitrary<OMModel, OMReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `get(${k})`,
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.get(real, k), modelGet(m, k), `get(${k}) mismatch`);
    },
  }));

const hasCmd: ST.CommandArbitrary<OMModel, OMReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `has(${k})`,
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.has(real, k), modelHas(m, k), `has(${k}) mismatch`);
    },
  }));

const delCmd: ST.CommandArbitrary<OMModel, OMReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `del(${k})`,
    run: (m: OMModel, real: OMReal) => {
      const expected = modelDel(m, k);
      const actual = OM.del(real, k);
      assert.equal(actual, expected, `del(${k}) mismatch`);
      assert.equal(OM.size(real), modelSize(m), `size mismatch after del(${k})`);
    },
  }));

const minCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "min",
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.min(real), modelMin(m), "min mismatch");
    },
  });

const maxCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "max",
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.max(real), modelMax(m), "max mismatch");
    },
  });

const floorCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(keyArb, (k) => ({
    name: `floor(${k})`,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.floor(real, k), modelFloor(m, k), `floor(${k}) mismatch`);
    },
  }));

const ceilingCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(keyArb, (k) => ({
    name: `ceiling(${k})`,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.ceiling(real, k), modelCeiling(m, k), `ceiling(${k}) mismatch`);
    },
  }));

const sizeCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "size",
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.size(real), modelSize(m), "size mismatch");
    },
  });

const entriesCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "entries",
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual([...OM.entries(real)], m.entries, "full sorted entries mismatch");
    },
  });

const valuesCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "values",
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(
        [...OM.values(real)],
        m.entries.map(([, v]) => v),
        "values() traversal mismatch",
      );
    },
  });

const rangeCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(Arb.tuple(keyArb, keyArb), ([a, b]) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      name: `range(${lo}, ${hi})`,
      run: (m: OMModel, real: OMReal) => {
        assert.deepEqual(
          [...OM.range(real, lo, hi)],
          modelRange(m, lo, hi),
          `range(${lo}, ${hi}) mismatch`,
        );
      },
    };
  });

const forRangeCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(Arb.tuple(keyArb, keyArb), ([a, b]) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      name: `forRange(${lo}, ${hi})`,
      run: (m: OMModel, real: OMReal) => {
        const collected: [number, number][] = [];
        const count = OM.forRange(real, lo, hi, (k, v) => {
          collected.push([k, v]);
        });
        const expected = modelRange(m, lo, hi);
        assert.deepEqual(collected, expected, `forRange(${lo}, ${hi}) result mismatch`);
        assert.equal(count, expected.length, `forRange(${lo}, ${hi}) count mismatch`);
      },
    };
  });

// ---------------------------------------------------------------------------
// Stateful model-based test — 1M runs, 50 commands per sequence
// ---------------------------------------------------------------------------

test("OrderedMap stateful model-based fuzz test", { timeout: 300_000 }, () => {
  ST.assertStateful({
    initialModel: (): OMModel => ({ entries: [] }),
    initialReal: () => OM.make<number, number>(),
    commands: [
      setCmd,
      getCmd,
      hasCmd,
      delCmd,
      minCmd,
      maxCmd,
      floorCmd,
      ceilingCmd,
      sizeCmd,
      entriesCmd,
      valuesCmd,
      rangeCmd,
      forRangeCmd,
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
  });
});

// ---------------------------------------------------------------------------
// Property: set(k, v); get(k) === v
// ---------------------------------------------------------------------------

test("OrderedMap property: get after set returns value", () => {
  const arb = Arb.tuple(keyArb, valArb);
  Prop.assert(
    arb,
    ([k, v]) => {
      const m = OM.make<number, number>();
      OM.set(m, k, v);
      assert.equal(OM.get(m, k), v);
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: keys() always in sorted order
// ---------------------------------------------------------------------------

test("OrderedMap property: keys are always in sorted order", () => {
  const arb = Arb.array(Arb.tuple(keyArb, valArb), { minLength: 1, maxLength: 40 });
  Prop.assert(
    arb,
    (pairs) => {
      const m = OM.make<number, number>();
      for (const [k, v] of pairs) OM.set(m, k, v);
      const ks = [...OM.keys(m)];
      for (let i = 1; i < ks.length; i++) {
        assert.ok(ks[i - 1] < ks[i], `keys not sorted at index ${i}: ${ks[i - 1]} >= ${ks[i]}`);
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: has(k) iff get(k) !== undefined
// ---------------------------------------------------------------------------

test("OrderedMap property: has iff get is defined", () => {
  const arb = Arb.tuple(
    Arb.array(Arb.tuple(keyArb, valArb), { minLength: 0, maxLength: 30 }),
    keyArb,
  );
  Prop.assert(
    arb,
    ([pairs, k]) => {
      const m = OM.make<number, number>();
      for (const [mk, mv] of pairs) OM.set(m, mk, mv);
      assert.equal(
        OM.has(m, k),
        OM.get(m, k) !== undefined,
        `has(${k}) !== (get(${k}) !== undefined)`,
      );
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: floor/ceiling duals —
//   floor(k) ≤ k and ceiling(k) ≥ k (when they exist)
//   floor(k)?.key === ceiling(k)?.key when k is present
// ---------------------------------------------------------------------------

test("OrderedMap property: floor and ceiling bounds", () => {
  const arb = Arb.tuple(
    Arb.array(Arb.tuple(keyArb, valArb), { minLength: 0, maxLength: 30 }),
    keyArb,
  );
  Prop.assert(
    arb,
    ([pairs, k]) => {
      const m = OM.make<number, number>();
      for (const [mk, mv] of pairs) OM.set(m, mk, mv);
      const f = OM.floor(m, k);
      const c = OM.ceiling(m, k);
      if (f !== undefined) {
        assert.ok(f[0] <= k, `floor(${k}) returned key ${f[0]} > ${k}`);
      }
      if (c !== undefined) {
        assert.ok(c[0] >= k, `ceiling(${k}) returned key ${c[0]} < ${k}`);
      }
      // If k is in the map, floor and ceiling must both return it.
      if (OM.has(m, k)) {
        assert.ok(f !== undefined && f[0] === k, `floor(${k}) should return k when k is present`);
        assert.ok(c !== undefined && c[0] === k, `ceiling(${k}) should return k when k is present`);
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: range(lo, hi) results are a subset of entries between lo and hi
// ---------------------------------------------------------------------------

test("OrderedMap property: range returns all and only in-bounds entries", () => {
  const arb = Arb.tuple(
    Arb.array(Arb.tuple(keyArb, valArb), { minLength: 0, maxLength: 30 }),
    Arb.tuple(keyArb, keyArb),
  );
  Prop.assert(
    arb,
    ([pairs, [a, b]]) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const m = OM.make<number, number>();
      for (const [k, v] of pairs) OM.set(m, k, v);
      const result = [...OM.range(m, lo, hi)];
      // All results must satisfy lo ≤ k ≤ hi.
      for (const [k] of result) {
        assert.ok(k >= lo && k <= hi, `range key ${k} outside [${lo}, ${hi}]`);
      }
      // Results must be in sorted order.
      for (let i = 1; i < result.length; i++) {
        assert.ok(result[i - 1][0] < result[i][0], `range not sorted at index ${i}`);
      }
    },
    { numRuns: 1_000_000 },
  );
});
