import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as WeakCache from "../../WeakCache.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

// ---------------------------------------------------------------------------
// Stateful test with a strong-reference oracle: every value stays reachable
// from the model, so the cache must behave exactly like a Map.
// ---------------------------------------------------------------------------

const keyArb = Arb.integer(0, 5);
// Few distinct values so the same value is often cached under several keys.
const valArb = Arb.integer(0, 3);

interface Model {
  map: Map<number, object>;
  values: object[];
}

test("stateful: WeakCache matches a strong-ref Map oracle", () => {
  ST.assertStateful<Model, WeakCache.WeakCache<number, object>>({
    initialModel: () => ({
      map: new Map(),
      values: [{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }],
    }),
    initialReal: () => WeakCache.make<number, object>(),
    commands: [
      () =>
        Arb.map(Arb.tuple(keyArb, valArb), ([k, v]) => ({
          name: `set(${k}, v${v})`,
          run: (m, c) => {
            const value = m.values[v]!;
            WeakCache.set(c, k, value);
            m.map.set(k, value);
          },
        })),
      () =>
        Arb.map(keyArb, (k) => ({
          name: `get(${k})`,
          run: (m, c) => assert.equal(WeakCache.get(c, k), m.map.get(k)),
        })),
      () =>
        Arb.map(keyArb, (k) => ({
          name: `has(${k})`,
          run: (m, c) => assert.equal(WeakCache.has(c, k), m.map.has(k)),
        })),
      () =>
        Arb.map(keyArb, (k) => ({
          name: `remove(${k})`,
          run: (m, c) => assert.equal(WeakCache.remove(c, k), m.map.delete(k)),
        })),
      () =>
        Arb.constant({
          name: "size",
          // Values are all strongly held, so nothing may drift or be lost.
          run: (m, c) => assert.equal(WeakCache.size(c), m.map.size),
        }),
    ],
    numRuns: 1_000_000,
    maxCommands: 40,
    timeoutMs: 300_000,
  });
});

// ---------------------------------------------------------------------------
// GC phase (requires --expose-gc, set by the npm test scripts): entries whose
// values are dropped disappear and size() converges to the kept count; kept
// entries survive.
// ---------------------------------------------------------------------------

function forceGc(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  const bun = (globalThis as unknown as { Bun?: { gc(sync: boolean): void } }).Bun;
  if (g !== undefined) g();
  else if (bun !== undefined) bun.gc(true);
  else assert.fail("gc unavailable: run tests with node --expose-gc");
}

function populate(
  cache: WeakCache.WeakCache<number, object>,
  keep: boolean[],
  shareFirst: boolean,
): Map<number, object> {
  const kept = new Map<number, object>();
  let shared: object | undefined;
  for (let k = 0; k < keep.length; k++) {
    // Optionally cache one value under every key (shared values).
    const value: object = shareFirst ? (shared ??= { shared: true }) : { k };
    WeakCache.set(cache, k, value);
    if (keep[k]) kept.set(k, value);
  }
  return kept;
}

test("GC phase: dropped values vanish, kept values survive, size() converges", async () => {
  await Prop.assertAsync(
    Arb.tuple(Arb.array(Arb.boolean(), { minLength: 1, maxLength: 20 }), Arb.boolean()),
    async ([keep, shareFirst]) => {
      const cache = WeakCache.make<number, object>();
      const kept = populate(cache, keep, shareFirst);
      // With a shared value, it stays alive iff any key is kept.
      const expected = shareFirst ? (kept.size > 0 ? keep.length : 0) : kept.size;
      for (let i = 0; i < 100 && WeakCache.size(cache) !== expected; i++) {
        forceGc();
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      for (const [k, v] of kept) assert.equal(WeakCache.get(cache, k), v);
      return WeakCache.size(cache) === expected;
    },
    { numRuns: 100 },
  );
});
