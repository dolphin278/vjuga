/**
 * Fuzz tests for the testing toolkit itself: shrink trees must stay inside the
 * declared domain at every depth, and iterating `shrinks` twice must yield the
 * same children (Property / StatefulTest / path replay rely on both).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as PRNG from "../../PRNG.js";

/** Collects up to `width` children per node, `depth` levels deep (values only). */
function walk<T>(tree: Arb.Tree<T>, depth: number, width: number, out: T[]): T[] {
  out.push(tree.value);
  if (depth === 0) return out;
  let n = 0;
  for (const child of tree.shrinks) {
    walk(child, depth - 1, width, out);
    if (++n >= width) break;
  }
  return out;
}

const seedArb = Arb.map(Arb.bigint(0n, 2n ** 64n - 1n), (s) => PRNG.make(PRNG.seed(s)));

test("integer: every shrink candidate stays in [min, max] and re-iterates identically", () => {
  Prop.assert(
    Arb.tuple(
      Arb.integer(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 2 ** 40),
      Arb.integer(0, 2 ** 40),
      Arb.nat(100),
      Arb.bigint(0n, 2n ** 64n - 1n),
    ),
    ([lo, span, size, s]) => {
      const hi = lo + span;
      const tree = Arb.integer(lo, hi)(PRNG.make(PRNG.seed(s)), size);
      const first = walk(tree, 2, 8, []);
      for (const v of first) {
        if (!Number.isSafeInteger(v) || v < lo || v > hi) return false;
      }
      assert.deepEqual(walk(tree, 2, 8, []), first);
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("float: every shrink candidate stays in [min, max)", () => {
  Prop.assert(
    Arb.tuple(Arb.float(-1e6, 1e6), Arb.float(0, 1e6), seedArb),
    ([lo, span, prng]) => {
      const hi = lo + span;
      const tree = Arb.float(lo, hi)(prng, 100);
      for (const v of walk(tree, 2, 8, [])) {
        if (!(v === lo || (v > lo && v < hi))) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("uniqueArray: shrink candidates stay unique and >= minLength at depth", () => {
  Prop.assert(
    Arb.tuple(Arb.nat(4), Arb.nat(100), seedArb),
    ([minLength, size, prng]) => {
      const arb = Arb.uniqueArray(Arb.integer(0, 30), { minLength, maxLength: 6 });
      for (const xs of walk(arb(prng, size), 2, 5, [])) {
        if (xs.length < minLength || new Set(xs).size !== xs.length) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("oneOf/frequency/chain: re-iterating shrinks is deterministic", () => {
  const arb = Arb.frequency<unknown>(
    { weight: 1, arb: Arb.oneOf<unknown>(Arb.string(), Arb.integer(-1e6, 1e6)) },
    {
      weight: 2,
      arb: Arb.chain(Arb.integer(0, 4), (n) => Arb.array(Arb.integer(-1e6, 1e6), { maxLength: n })),
    },
    { weight: 0, arb: Arb.constant("never") },
  );
  Prop.assert(
    Arb.tuple(Arb.nat(100), seedArb),
    ([size, prng]) => {
      const tree = arb(prng, size);
      const first = JSON.stringify(walk(tree, 2, 6, []));
      if (first.includes("never")) return false;
      return JSON.stringify(walk(tree, 2, 6, [])) === first;
    },
    { numRuns: 1_000_000 },
  );
});
