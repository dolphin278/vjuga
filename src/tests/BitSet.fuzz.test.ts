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
function modelToArray(m: BitSetModel): number[] {
  const result: number[] = [];
  for (let i = 0; i < m.capacity; i++) if (m.bits[i]) result.push(i);
  return result;
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

type BSReal = BitSet.BitSet;

const setCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `set(${i})`,
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
    run: (m: BitSetModel, real: BSReal) => {
      BitSet.clear(real, i);
      modelClear(m, i);
      assert.equal(BitSet.get(real, i), false, `get(${i}) should be false after clear`);
    },
  }));

const toggleCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.map(indexArb, (i) => ({
    name: `toggle(${i})`,
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
    run: (m: BitSetModel, real: BSReal) => {
      assert.equal(BitSet.get(real, i), modelGet(m, i), `get(${i}) mismatch`);
    },
  }));

const popcountCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.constant<ST.Command<BitSetModel, BSReal>>({
    name: "popcount",
    run: (m: BitSetModel, real: BSReal) => {
      assert.equal(BitSet.popcount(real), modelPopcount(m), "popcount mismatch");
    },
  });

const toArrayCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.constant<ST.Command<BitSetModel, BSReal>>({
    name: "toArray",
    run: (m: BitSetModel, real: BSReal) => {
      assert.deepEqual(BitSet.toArray(real), modelToArray(m), "toArray mismatch");
    },
  });

const capacityCmd: ST.CommandArbitrary<BitSetModel, BSReal> = (_model) =>
  Arb.constant<ST.Command<BitSetModel, BSReal>>({
    name: "capacity",
    run: (m: BitSetModel, real: BSReal) => {
      assert.equal(BitSet.capacity(real), m.capacity, "capacity mismatch");
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test — 1M runs, 50 commands per sequence
// ---------------------------------------------------------------------------

test("BitSet stateful model-based fuzz test", { timeout: 300_000 }, () => {
  ST.assertStateful({
    initialModel: (): BitSetModel => ({
      bits: Array(CAPACITY).fill(false) as boolean[],
      capacity: CAPACITY,
    }),
    initialReal: () => BitSet.make(CAPACITY),
    commands: [setCmd, clearCmd, toggleCmd, getCmd, popcountCmd, toArrayCmd, capacityCmd],
    numRuns: 1_000_000,
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
    { numRuns: 1_000_000 },
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
    { numRuns: 1_000_000 },
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
      assert.deepEqual(BitSet.toArray(b), BitSet.toArray(a), "not(not(a)) should equal a");
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: xor(a, b) deepEqual xor(b, a) — commutativity
// ---------------------------------------------------------------------------

test("BitSet property: xor is commutative", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 20 });
  const arb = Arb.tuple(indicesArb, indicesArb);
  Prop.assert(
    arb,
    ([ai, bi]) => {
      const a = BitSet.make(64);
      const b = BitSet.make(64);
      for (const i of ai) BitSet.set(a, i);
      for (const i of bi) BitSet.set(b, i);
      assert.deepEqual(
        BitSet.toArray(BitSet.xor(a, b)),
        BitSet.toArray(BitSet.xor(b, a)),
        "xor(a,b) !== xor(b,a)",
      );
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: and(a, a) equals a; or(a, a) equals a — idempotence
// ---------------------------------------------------------------------------

test("BitSet property: and and or are idempotent", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 30 });
  Prop.assert(
    indicesArb,
    (indices) => {
      const a = BitSet.make(64);
      for (const i of indices) BitSet.set(a, i);
      const arr = BitSet.toArray(a);
      assert.deepEqual(BitSet.toArray(BitSet.and(a, a)), arr, "and(a,a) !== a");
      assert.deepEqual(BitSet.toArray(BitSet.or(a, a)), arr, "or(a,a) !== a");
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: xor(a, a) popcount === 0 (self-xor is zero)
// ---------------------------------------------------------------------------

test("BitSet property: xor(a, a) is empty", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 30 });
  Prop.assert(
    indicesArb,
    (indices) => {
      const a = BitSet.make(64);
      for (const i of indices) BitSet.set(a, i);
      assert.equal(BitSet.popcount(BitSet.xor(a, a)), 0, "xor(a,a) should be empty");
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Property: and(a, not(a)) popcount === 0; or(a, not(a)) popcount === capacity
// ---------------------------------------------------------------------------

test("BitSet property: complement laws", () => {
  const indicesArb = Arb.array(Arb.integer(0, 63), { minLength: 0, maxLength: 30 });
  Prop.assert(
    indicesArb,
    (indices) => {
      const a = BitSet.make(64);
      for (const i of indices) BitSet.set(a, i);
      const notA = BitSet.not(a);
      assert.equal(BitSet.popcount(BitSet.and(a, notA)), 0, "and(a, not(a)) should be empty");
      assert.equal(
        BitSet.popcount(BitSet.or(a, notA)),
        64,
        "or(a, not(a)) should be full (capacity = 64)",
      );
    },
    { numRuns: 1_000_000 },
  );
});
