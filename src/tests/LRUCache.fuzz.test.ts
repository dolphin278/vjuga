import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as LRU from "../LRUCache.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAPACITY = 5;
const keyArb = Arb.string({ minLength: 1, maxLength: 3 });
const valArb = Arb.integer(0, 1000);

// ---------------------------------------------------------------------------
// Model for stateful testing
// ---------------------------------------------------------------------------

interface LRUModel {
  map: Map<string, number>;
  order: string[]; // order[0] = MRU, order[last] = LRU
  capacity: number;
}

function modelGet(m: LRUModel, k: string): number | undefined {
  if (!m.map.has(k)) return undefined;
  m.order.splice(m.order.indexOf(k), 1);
  m.order.unshift(k);
  return m.map.get(k);
}

function modelSet(m: LRUModel, k: string, v: number): void {
  if (m.map.has(k)) {
    m.map.set(k, v);
    m.order.splice(m.order.indexOf(k), 1);
    m.order.unshift(k);
  } else {
    if (m.map.size >= m.capacity) {
      const lru = m.order.pop()!;
      m.map.delete(lru);
    }
    m.map.set(k, v);
    m.order.unshift(k);
  }
}

function modelHas(m: LRUModel, k: string): boolean {
  return m.map.has(k);
}

function modelDel(m: LRUModel, k: string): boolean {
  if (!m.map.has(k)) return false;
  m.map.delete(k);
  m.order.splice(m.order.indexOf(k), 1);
  return true;
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

type LRUReal = LRU.LRUCache<string, number>;

/** Pick an existing key when available, otherwise generate a fresh one. */
function biasedKey(model: LRUModel): Arb.Arbitrary<string> {
  const keys = [...model.map.keys()];
  return keys.length > 0
    ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
    : keyArb;
}

const setCmd: ST.CommandArbitrary<LRUModel, LRUReal> = (model) =>
  Arb.map(Arb.tuple(biasedKey(model), valArb), ([k, v]) => ({
    name: `set(${k}, ${v})`,
    check: () => true,
    run: (m: LRUModel, real: LRUReal) => {
      LRU.set(real, k, v);
      modelSet(m, k, v);
      assert.equal(LRU.size(real), m.map.size, `size mismatch after set(${k}, ${v})`);
    },
  }));

const getCmd: ST.CommandArbitrary<LRUModel, LRUReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `get(${k})`,
    check: () => true,
    run: (m: LRUModel, real: LRUReal) => {
      const expected = modelGet(m, k);
      const actual = LRU.get(real, k);
      assert.equal(actual, expected, `get(${k}) mismatch`);
    },
  }));

const hasCmd: ST.CommandArbitrary<LRUModel, LRUReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `has(${k})`,
    check: () => true,
    run: (m: LRUModel, real: LRUReal) => {
      assert.equal(LRU.has(real, k), modelHas(m, k), `has(${k}) mismatch`);
    },
  }));

const delCmd: ST.CommandArbitrary<LRUModel, LRUReal> = (model) =>
  Arb.map(biasedKey(model), (k) => ({
    name: `del(${k})`,
    check: () => true,
    run: (m: LRUModel, real: LRUReal) => {
      const expected = modelDel(m, k);
      const actual = LRU.del(real, k);
      assert.equal(actual, expected, `del(${k}) mismatch`);
      assert.equal(LRU.size(real), m.map.size, `size mismatch after del(${k})`);
    },
  }));

const sizeCmd: ST.CommandArbitrary<LRUModel, LRUReal> = (_model) =>
  Arb.constant<ST.Command<LRUModel, LRUReal>>({
    name: "size",
    check: () => true,
    run: (m: LRUModel, real: LRUReal) => {
      assert.equal(LRU.size(real), m.map.size, "size mismatch");
    },
  });

// ---------------------------------------------------------------------------
// Stateful model-based test
// ---------------------------------------------------------------------------

test("LRUCache stateful model-based fuzz test", () => {
  ST.assertStateful({
    initialModel: (): LRUModel => ({ map: new Map(), order: [], capacity: CAPACITY }),
    initialReal: () => LRU.make<string, number>(CAPACITY),
    commands: [setCmd, getCmd, hasCmd, delCmd, sizeCmd],
    numRuns: 200,
    maxCommands: 50,
  });
});

// ---------------------------------------------------------------------------
// Property: set then get returns the value
// ---------------------------------------------------------------------------

test("LRUCache property: set(k, v) then get(k) returns v", () => {
  const arb = Arb.tuple(keyArb, valArb);
  Prop.assert(
    arb,
    ([k, v]) => {
      const cache = LRU.make<string, number>(CAPACITY);
      LRU.set(cache, k, v);
      assert.equal(LRU.get(cache, k), v);
    },
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Property: size never exceeds capacity
// ---------------------------------------------------------------------------

test("LRUCache property: size never exceeds capacity after N sets", () => {
  const keysArb = Arb.array(Arb.tuple(keyArb, valArb), { minLength: 1, maxLength: 30 });
  Prop.assert(
    keysArb,
    (pairs) => {
      const cache = LRU.make<string, number>(CAPACITY);
      for (const [k, v] of pairs) {
        LRU.set(cache, k, v);
        assert.ok(LRU.size(cache) <= CAPACITY, `size ${LRU.size(cache)} exceeds capacity ${CAPACITY}`);
      }
    },
    { numRuns: 500 },
  );
});
