import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as RadixTree from "../../RadixTree.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

// ---------------------------------------------------------------------------
// Property-based tests: invariants over random insert/lookup/remove sequences
// ---------------------------------------------------------------------------

/** Generate short ASCII keys — short enough for interesting prefix overlap. */
const keyArb = Arb.string({ minLength: 0, maxLength: 8 });

test("insert then lookup always returns the inserted value", () => {
  const arb = Arb.tuple(
    Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 1, maxLength: 30 }),
    keyArb,
    Arb.integer(0, 1000),
  );

  Prop.assert(arb, ([pairs, extraKey, extraVal]) => {
    const tree = RadixTree.make<number>();
    for (const [k, v] of pairs) RadixTree.insert(tree, k, v);
    // Insert one more and verify it's retrievable
    RadixTree.insert(tree, extraKey, extraVal);
    return RadixTree.lookup(tree, extraKey) === extraVal;
  }, { numRuns: 1_000_000 });
});

test("size equals number of distinct keys", () => {
  Prop.assert(
    Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 0, maxLength: 40 }),
    (pairs) => {
      const tree = RadixTree.make<number>();
      const seen = new Set<string>();
      for (const [k, v] of pairs) {
        RadixTree.insert(tree, k, v);
        seen.add(k);
      }
      return RadixTree.size(tree) === seen.size;
    },
    { numRuns: 1_000_000 },
  );
});

test("entries returns exactly the keys inserted (last-write-wins)", () => {
  Prop.assert(
    Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 0, maxLength: 30 }),
    (pairs) => {
      const tree = RadixTree.make<number>();
      const expected = new Map<string, number>();
      for (const [k, v] of pairs) {
        RadixTree.insert(tree, k, v);
        expected.set(k, v);
      }
      const actual = new Map(RadixTree.entries(tree));
      if (actual.size !== expected.size) return false;
      for (const [k, v] of expected) {
        if (actual.get(k) !== v) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("remove then lookup returns undefined", () => {
  Prop.assert(
    Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 1, maxLength: 20 }),
    (pairs) => {
      const tree = RadixTree.make<number>();
      for (const [k, v] of pairs) RadixTree.insert(tree, k, v);
      // Remove every key and verify lookup returns undefined
      for (const [k] of pairs) {
        RadixTree.remove(tree, k);
        if (RadixTree.lookup(tree, k) !== undefined) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("prefixMatch returns superset of exact match", () => {
  Prop.assert(
    Arb.tuple(
      Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 1, maxLength: 30 }),
      keyArb,
    ),
    ([pairs, prefix]) => {
      const tree = RadixTree.make<number>();
      const map = new Map<string, number>();
      for (const [k, v] of pairs) {
        RadixTree.insert(tree, k, v);
        map.set(k, v);
      }
      const result = RadixTree.prefixMatch(tree, prefix);
      // Every value for a key starting with prefix must appear in result
      const expectedValues: number[] = [];
      for (const [k, v] of map) {
        if (k.startsWith(prefix)) expectedValues.push(v);
      }
      if (result.length !== expectedValues.length) return false;
      const sorted1 = result.slice().sort((a, b) => a - b);
      const sorted2 = expectedValues.sort((a, b) => a - b);
      return sorted1.every((v, i) => v === sorted2[i]);
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Stateful model-based fuzz test
// ---------------------------------------------------------------------------

interface Model {
  map: Map<string, number>;
}

interface Real {
  tree: RadixTree.RadixTree<number>;
}

test("stateful: RadixTree matches Map under random operations", () => {
  ST.assertStateful<Model, Real>({
    initialModel: () => ({ map: new Map() }),
    initialReal: () => ({ tree: RadixTree.make() }),
    commands: [
      // Insert
      (model) =>
        Arb.map(Arb.tuple(keyArb, Arb.integer(0, 10000)), ([k, v]) => ({
          name: `insert(${JSON.stringify(k)}, ${v})`,
          check: () => true,
          run: (m, r) => {
            m.map.set(k, v);
            RadixTree.insert(r.tree, k, v);
          },
        })),

      // Lookup
      (model) => {
        const keys = [...model.map.keys()];
        const arb = keys.length > 0
          ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
          : keyArb;
        return Arb.map(arb, (k) => ({
          name: `lookup(${JSON.stringify(k)})`,
          check: () => true,
          run: (m, r) => {
            const expected = m.map.get(k);
            const actual = RadixTree.lookup(r.tree, k);
            assert.equal(actual, expected, `lookup(${JSON.stringify(k)})`);
          },
        }));
      },

      // Has
      (model) => {
        const keys = [...model.map.keys()];
        const arb = keys.length > 0
          ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
          : keyArb;
        return Arb.map(arb, (k) => ({
          name: `has(${JSON.stringify(k)})`,
          check: () => true,
          run: (m, r) => {
            const expected = m.map.has(k);
            const actual = RadixTree.has(r.tree, k);
            assert.equal(actual, expected, `has(${JSON.stringify(k)})`);
          },
        }));
      },

      // Remove
      (model) => {
        const keys = [...model.map.keys()];
        const arb = keys.length > 0
          ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
          : keyArb;
        return Arb.map(arb, (k) => ({
          name: `remove(${JSON.stringify(k)})`,
          check: () => true,
          run: (m, r) => {
            const expected = m.map.has(k);
            const actual = RadixTree.remove(r.tree, k);
            assert.equal(actual, expected, `remove(${JSON.stringify(k)})`);
            m.map.delete(k);
          },
        }));
      },

      // Size check
      (_model) =>
        Arb.constant({
          name: "size",
          check: () => true,
          run: (m: Model, r: Real) => {
            assert.equal(RadixTree.size(r.tree), m.map.size, "size mismatch");
          },
        }),

      // Entries check
      (_model) =>
        Arb.constant({
          name: "entries",
          check: () => true,
          run: (m: Model, r: Real) => {
            const actual = new Map(RadixTree.entries(r.tree));
            assert.equal(actual.size, m.map.size, "entries size mismatch");
            for (const [k, v] of m.map) {
              assert.equal(actual.get(k), v, `entries mismatch for ${JSON.stringify(k)}`);
            }
          },
        }),

      // PrefixMatch check
      (model) => {
        const keys = [...model.map.keys()];
        const arb = keys.length > 0
          ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
          : keyArb;
        return Arb.map(arb, (prefix) => ({
          name: `prefixMatch(${JSON.stringify(prefix)})`,
          check: () => true,
          run: (m: Model, r: Real) => {
            const actual = RadixTree.prefixMatch(r.tree, prefix).slice().sort((a, b) => a - b);
            const expected: number[] = [];
            for (const [k, v] of m.map) {
              if (k.startsWith(prefix)) expected.push(v);
            }
            expected.sort((a, b) => a - b);
            assert.deepEqual(actual, expected, `prefixMatch(${JSON.stringify(prefix)})`);
          },
        }));
      },
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
