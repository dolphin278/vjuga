import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as BitSet from "../BitSet.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAPACITY = 64;
const indexArb = Arb.integer(0, CAPACITY - 1);

// ---------------------------------------------------------------------------
// Oracle model — a plain boolean[]
// ---------------------------------------------------------------------------

interface BitSetModel {
  bits: boolean[];
  capacity: number;
}

function modelSet(m: BitSetModel, i: number): void {
  m.bits[i] = true;
}
function modelClear(m: BitSetModel, i: number): void {
  m.bits[i] = false;
}
function modelToggle(m: BitSetModel, i: number): void {
  m.bits[i] = !m.bits[i];
}
function modelGet(m: BitSetModel, i: number): boolean {
  return m.bits[i];
}
function modelPopcount(m: BitSetModel): number {
  let n = 0;
  for (let i = 0; i < m.capacity; i++) if (m.bits[i]) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

type BSReal = BitSet.BitSet;

const setCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `set(${i})`,
    check: () => true,
    run: (m: BitSetModel, real: BSReal) => {
      BitSet.set(real, i);
      modelSet(m, i);
      assert.equal(BitSet.get(real, i), true, `get(${i}) should be true after set`);
      assert.equal(modelGet(m, i), true);
    },
  }));

const clearCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `clear(${i})`,
    check: () => true,
    run: (m: BitSetModel, real: BSReal) => {
      BitSet.clear(real, i);
      modelClear(m, i);
      assert.equal(BitSet.get(real, i), false, `get(${i}) should be false after clear`);
    },
  }));

const toggleCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `toggle(${i})`,
    check: () => true,
    run: (m: BitSetModel, real: BSReal) => {
      const before = modelGet(m, i);
      BitSet.toggle(real, i);
      modelToggle(m, i);
      assert.equal(BitSet.get(real, i), !before, `toggle(${i}) should flip bit`);
    },
  }));

const getCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `get(${i})`,
    check: () => true,
    run: (m: BitSetModel, real: BSReal) => {
      assert.equal(BitSet.get(real, i), modelGet(m, i), `get(${i}) mismatch`);
    },
  }));

const popcountCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.constant<ST.Command<BitSetModel, BSReal>>({
    name: "popcount",
    check: () => true,
    run: (m: BitSetModel, real: BSReal) => {
      assert.equal(BitSet.popcount(real), modelPopcount(m), "popcount mismatch");
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test
// ---------------------------------------------------------------------------

test("BitSet stateful model-based fuzz test", () => {
  ST.assertStateful({
    initialModel: (): BitSetModel => ({
      bits: Array(CAPACITY).fill(false) as boolean[],
      capacity: CAPACITY,
    }),
    initialReal: () => BitSet.make(CAPACITY),
    commands: [setCmd, clearCmd, toggleCmd, getCmd, popcountCmd],
    numRuns: 200,
    maxCommands: 50,
  });
});

// ---------------------------------------------------------------------------
// Property: popcount(bs) === toArray(bs).length
// ---------------------------------------------------------------------------

test("BitSet property: popcount equals toArray length", () => {
  const arb = Arb.array(Arb.integer(0, 99), { minLength: 0, maxLength: 30 });
  Prop.assert(
    arb,
    (indices) => {
      const bs = BitSet.make(100);
      for (const i of indices) BitSet.set(bs, i);
      assert.equal(
        BitSet.popcount(bs),
        BitSet.toArray(bs).length,
        "popcount should equal toArray.length",
      );
    },
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Property: de Morgan — and(not(a), not(b)) deepEqual not(or(a, b))
// ---------------------------------------------------------------------------

test("BitSet property: de Morgan — and(not(a), not(b)) equals not(or(a, b))", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 20 });
  const arb = Arb.tuple(indicesArb, indicesArb);
  Prop.assert(
    arb,
    ([ai, bi]) => {
      const a = BitSet.make(64);
      const b = BitSet.make(64);
      for (const i of ai) BitSet.set(a, i);
      for (const i of bi) BitSet.set(b, i);
      const lhs = BitSet.and(BitSet.not(a), BitSet.not(b));
      const rhs = BitSet.not(BitSet.or(a, b));
      assert.deepEqual(
        BitSet.toArray(lhs),
        BitSet.toArray(rhs),
        "de Morgan: and(not(a), not(b)) !== not(or(a, b))",
      );
    },
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Property: not(not(a)) deepEqual a
// ---------------------------------------------------------------------------

test("BitSet property: not(not(a)) deepEquals a", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 30 });
  Prop.assert(
    indicesArb,
    (indices) => {
      const a = BitSet.make(64);
      for (const i of indices) BitSet.set(a, i);
      const b = BitSet.not(BitSet.not(a));
      assert.deepEqual(
        BitSet.toArray(b),
        BitSet.toArray(a),
        "not(not(a)) should equal a",
      );
    },
    { numRuns: 500 },
  );
});
