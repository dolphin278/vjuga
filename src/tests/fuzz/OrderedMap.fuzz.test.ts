import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as OM from "../../OrderedMap.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

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
    check: () => true,
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
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.get(real, k), modelGet(m, k), `get(${k}) mismatch`);
    },
  }));

const hasCmd: ST.CommandArbitrary<OMModel, OMReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `has(${k})`,
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.has(real, k), modelHas(m, k), `has(${k}) mismatch`);
    },
  }));

const delCmd: ST.CommandArbitrary<OMModel, OMReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `del(${k})`,
    check: () => true,
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
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.min(real), modelMin(m), "min mismatch");
    },
  });

const maxCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "max",
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.max(real), modelMax(m), "max mismatch");
    },
  });

const floorCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(keyArb, (k) => ({
    name: `floor(${k})`,
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.floor(real, k), modelFloor(m, k), `floor(${k}) mismatch`);
    },
  }));

const ceilingCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.map(keyArb, (k) => ({
    name: `ceiling(${k})`,
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(OM.ceiling(real, k), modelCeiling(m, k), `ceiling(${k}) mismatch`);
    },
  }));

const sizeCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "size",
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.equal(OM.size(real), modelSize(m), "size mismatch");
    },
  });

const entriesCmd: ST.CommandArbitrary<OMModel, OMReal> = (_model) =>
  Arb.constant<ST.Command<OMModel, OMReal>>({
    name: "entries",
    check: () => true,
    run: (m: OMModel, real: OMReal) => {
      assert.deepEqual(
        [...OM.entries(real)],
        m.entries,
        "full sorted entries mismatch",
      );
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test
// ---------------------------------------------------------------------------

test("OrderedMap stateful model-based fuzz test", () => {
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
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
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
