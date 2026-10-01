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

  Prop.assert(
    arb,
    ([pairs, extraKey, extraVal]) => {
      const tree = RadixTree.make<number>();
      for (const [k, v] of pairs) RadixTree.insert(tree, k, v);
      // Insert one more and verify it's retrievable
      RadixTree.insert(tree, extraKey, extraVal);
      return RadixTree.lookup(tree, extraKey) === extraVal;
    },
    { numRuns: 1_000_000 },
  );
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
      (_model) =>
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
        const arb =
          keys.length > 0
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
        const arb =
          keys.length > 0
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
        const arb =
          keys.length > 0
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
        const arb =
          keys.length > 0
            ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
            : keyArb;
        return Arb.map(arb, (prefix) => ({
          name: `prefixMatch(${JSON.stringify(prefix)})`,
          check: () => true,
          run: (m: Model, r: Real) => {
            const actual = RadixTree.prefixMatch(r.tree, prefix)
              .slice()
              .sort((a, b) => a - b);
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

// ---------------------------------------------------------------------------
// Small-alphabet stateful test with structural invariants.
// A 95-char alphabet almost never produces shared prefixes, so node splits and
// merges are barely exercised. Alphabet {a, b, c} with short keys hits them on
// nearly every operation.
// ---------------------------------------------------------------------------

type Sym = Record<symbol, unknown>;
const symOf = (o: object, name: string): symbol =>
  Object.getOwnPropertySymbols(o).find((s) => s.description === name) as symbol;

/** Returns a description of the first structural violation, or null. */
function structureViolation(tree: RadixTree.RadixTree<number>): string | null {
  const root = (tree as unknown as Sym)[symOf(tree, "root")] as Sym;
  const kPrefix = symOf(root, "prefix");
  const kValue = symOf(root, "value");
  const kChildren = symOf(root, "children");
  const stack: [Sym, boolean][] = [[root, true]];
  while (stack.length > 0) {
    const [n, isRoot] = stack.pop()!;
    const kids = n[kChildren] as Sym[];
    if (!isRoot) {
      if ((n[kPrefix] as string).length === 0) return "empty prefix on non-root node";
      if (n[kValue] === undefined && kids.length < 2) {
        return `valueless node with ${kids.length} children (prefix ${JSON.stringify(n[kPrefix])})`;
      }
    }
    for (let i = 1; i < kids.length; i++) {
      const a = (kids[i - 1][kPrefix] as string).charCodeAt(0);
      const b = (kids[i][kPrefix] as string).charCodeAt(0);
      if (a >= b) return "children not strictly sorted by first char";
    }
    for (const c of kids) stack.push([c, false]);
  }
  return null;
}

const smallKeyArb = Arb.map(
  Arb.array(Arb.constantFrom("a", "b", "c"), { minLength: 0, maxLength: 5 }),
  (cs) => cs.join(""),
);

const byKey = (a: [string, number], b: [string, number]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

/** Wraps a command so the full invariant suite runs after every step. */
function checked(cmd: ST.Command<Model, Real>): ST.Command<Model, Real> {
  return {
    name: cmd.name,
    check: () => true,
    run: (m, r) => {
      cmd.run(m, r);
      assert.equal(structureViolation(r.tree), null, "structure");
      assert.equal(RadixTree.size(r.tree), m.map.size, "size");
      const expected = [...m.map.entries()].sort(byKey);
      // Exact lexicographic order, not just set equality.
      assert.deepEqual(RadixTree.entries(r.tree), expected, "entries");
      for (const [k, v] of m.map) assert.equal(RadixTree.lookup(r.tree, k), v, "lookup");
    },
  };
}

test("stateful (small alphabet): structure, order, size and contents match Map", () => {
  ST.assertStateful<Model, Real>({
    initialModel: () => ({ map: new Map() }),
    initialReal: () => ({ tree: RadixTree.make() }),
    commands: [
      (_model) =>
        Arb.map(Arb.tuple(smallKeyArb, Arb.integer(0, 10000)), ([k, v]) =>
          checked({
            name: `insert(${JSON.stringify(k)}, ${v})`,
            run: (m, r) => {
              m.map.set(k, v);
              RadixTree.insert(r.tree, k, v);
            },
          }),
        ),
      // insert(k, undefined) is defined as remove(k)
      (_model) =>
        Arb.map(smallKeyArb, (k) =>
          checked({
            name: `insert(${JSON.stringify(k)}, undefined)`,
            run: (m, r) => {
              m.map.delete(k);
              RadixTree.insert(r.tree, k, undefined as unknown as number);
            },
          }),
        ),
      (_model) =>
        Arb.map(smallKeyArb, (k) =>
          checked({
            name: `remove(${JSON.stringify(k)})`,
            run: (m, r) => {
              assert.equal(RadixTree.remove(r.tree, k), m.map.delete(k));
            },
          }),
        ),
      (_model) =>
        Arb.map(smallKeyArb, (prefix) =>
          checked({
            name: `prefixMatch(${JSON.stringify(prefix)})`,
            run: (m, r) => {
              const keys = [...m.map.keys()].filter((k) => k.startsWith(prefix)).sort();
              assert.deepEqual(
                RadixTree.prefixMatch(r.tree, prefix),
                keys.map((k) => m.map.get(k)),
              );
            },
          }),
        ),
    ],
    numRuns: 1_000_000,
    maxCommands: 50,
    timeoutMs: 300_000,
  });
});
