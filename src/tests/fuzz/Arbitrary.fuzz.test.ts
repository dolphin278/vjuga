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
import * as ST from "../../StatefulTest.js";

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

test("float: values and shrinks stay finite and in [min, max) for any finite bounds", () => {
  const anyFloat = Arb.float(-Number.MAX_VALUE, Number.MAX_VALUE);
  Prop.assert(
    Arb.tuple(anyFloat, anyFloat, Arb.oneOf(anyFloat, Arb.float(-1, 1)), seedArb),
    ([a, b, c, prng]) => {
      // Mix wide and narrow ranges: [a, b], and [a, a + small] around a.
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (const [min, max] of [
        [lo, hi],
        [Math.min(lo, c), Math.min(lo, c) + Math.abs(c)],
      ] as const) {
        if (!Number.isFinite(max)) continue;
        for (const v of walk(Arb.float(min, max)(prng, 100), 2, 8, [])) {
          if (!(v === min || (v > min && v < max))) return false;
        }
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("string: shrinks respect minLength and include every single-character removal", () => {
  Prop.assert(
    Arb.tuple(Arb.nat(4), Arb.nat(100), seedArb),
    ([minLength, size, prng]) => {
      const tree = Arb.string({ minLength, maxLength: minLength + 8 })(prng, size);
      const s = tree.value;
      const kids = new Set<string>();
      for (const child of tree.shrinks) {
        if (child.value.length < minLength || child.value.length > s.length) return false;
        kids.add(child.value);
      }
      // Local minimality: deleting any one character (leading, interior or
      // trailing) is always a candidate while above minLength.
      if (s.length > minLength) {
        for (let i = 0; i < s.length; i++) {
          if (!kids.has(s.slice(0, i) + s.slice(i + 1))) return false;
        }
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("string/array: lengths validate at construction and bound generated lengths", () => {
  const len = Arb.oneOf<number>(
    Arb.integer(-3, 30),
    Arb.constantFrom(0.5, Number.NaN, Infinity, 2 ** 53),
  );
  Prop.assert(
    Arb.tuple(len, len, Arb.boolean(), Arb.nat(100), seedArb),
    ([minLength, maxLength, omitMax, size, prng]) => {
      const opts = omitMax ? { minLength } : { minLength, maxLength };
      const effMax = omitMax ? Math.max(minLength, 10) : maxLength;
      const valid =
        Number.isSafeInteger(minLength) &&
        (Number.isSafeInteger(effMax) || effMax === Infinity) &&
        minLength >= 0 &&
        minLength <= effMax;
      let s: string;
      let xs: number[];
      try {
        s = Arb.string(opts)(prng, size).value;
        xs = Arb.array(Arb.nat(3), opts)(prng, size).value;
      } catch (e) {
        return !valid && e instanceof RangeError;
      }
      return (
        valid &&
        s.length >= minLength &&
        s.length <= effMax &&
        xs.length >= minLength &&
        xs.length <= effMax
      );
    },
    { numRuns: 1_000_000 },
  );
});

test("gen: replayed picks never cross between same-factory arbitraries", () => {
  const range = Arb.map(Arb.tuple(Arb.integer(-1000, 1000), Arb.nat(50)), ([lo, w]) => ({
    lo,
    hi: lo + w,
  }));
  Prop.assert(
    Arb.tuple(range, range, Arb.nat(100), seedArb),
    ([r1, r2, size, prng]) => {
      const arb = Arb.gen((pick) =>
        pick(Arb.boolean())
          ? { r: r1, xs: pick(Arb.array(Arb.integer(r1.lo, r1.hi), { maxLength: 3 })) }
          : { r: r2, xs: pick(Arb.array(Arb.integer(r2.lo, r2.hi), { maxLength: 3 })) },
      );
      for (const v of walk(arb(prng, size), 2, 6, [])) {
        for (const x of v.xs) if (x < v.r.lo || x > v.r.hi) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

/** Values Property's failure formatter must render without throwing. */
const awkward = Arb.letrec((tie) => ({
  v: Arb.oneOf<unknown>(
    Arb.constantFrom<unknown>(-0, 0, Number.NaN, -Infinity, null, undefined),
    Arb.bigint(),
    Arb.string(),
    Arb.map(Arb.oneOf(Arb.integer(), Arb.constant(Number.NaN)), (ms) => new Date(ms)),
    Arb.map(Arb.tuple(tie("v"), Arb.boolean()), ([x, cyc]) => {
      const box: unknown[] = [x, x];
      if (cyc) box.push(box);
      return box;
    }),
    Arb.map(tie("v"), (x) => new Map([[x, { x }]])),
  ),
})).v;

test("Property: assert always reports a counterexample (no formatter crash)", () => {
  Prop.assert(
    awkward,
    (value) => {
      try {
        Prop.assert(Arb.constant(value), () => false, { numRuns: 1, seed: PRNG.seed(1n) });
      } catch (e) {
        const msg = (e as Error).message;
        return (
          msg.startsWith("Property check failed!\n  Counterexample: ") && msg.includes("Seed:")
        );
      }
      return false;
    },
    { numRuns: 1_000_000 },
  );
});

test("Property: a Promise-returning predicate never passes the sync runner", () => {
  Prop.assert(
    Arb.tuple(Arb.boolean(), Arb.nat(3)),
    ([reject, numRuns]) => {
      const pred = (async () => {
        if (reject) throw new Error("rejected");
        return true;
      }) as unknown as () => boolean;
      const r = Prop.check(Arb.integer(), pred, { numRuns: numRuns + 1, seed: PRNG.seed(2n) });
      return !r.ok && r.error instanceof TypeError && r.numRuns === 1;
    },
    { numRuns: 1_000_000 },
  );
});

test("StatefulTest: preconditions that throw on shrink replay never escape", () => {
  type Model = Map<number, number>;
  const add: ST.CommandArbitrary<Model, null> = () =>
    Arb.map(Arb.nat(5), (k) => ({
      name: `add(${k})`,
      run: (m: Model) => void m.set(k, k),
    }));
  const use =
    (failAt: number): ST.CommandArbitrary<Model, null> =>
    (model) =>
      model.size === 0
        ? Arb.constant({ name: "noop", run: () => {} })
        : Arb.map(Arb.constantFrom(...(model.keys() as unknown as [number])), (k) => ({
            name: `use(${k})`,
            // Safe for the model it was generated from; throws once add(k) is shrunk away.
            check: (m: Model) => m.get(k)!.toString() !== "never",
            run: (m: Model) => {
              if (m.size >= failAt) throw new Error("bug");
            },
          }));
  Prop.assert(
    Arb.tuple(Arb.integer(1, 4), Arb.bigint(0n, 2n ** 64n - 1n)),
    ([failAt, s]) => {
      const r = ST.checkStateful<Model, null>({
        initialModel: () => new Map(),
        initialReal: () => null,
        commands: [add, use(failAt)],
        numRuns: 3,
        maxCommands: 12,
        seed: PRNG.seed(s),
      });
      return r.ok || (r.error as Error).message === "bug";
    },
    { numRuns: 1_000_000 },
  );
});
