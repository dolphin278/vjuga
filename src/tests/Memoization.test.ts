import { test } from "node:test";
import * as assert from "node:assert/strict";
import { memoize, once } from "../Memoization.js";
import * as LRU from "../LRUCache.js";

test("function memoization caches results of given function", () => {
  let calls: number[] = [];
  const fn = (a: number) => (calls.push(a), a + 1);
  const memoized = memoize(fn);

  assert.equal(memoized(1), 2);
  assert.equal(memoized(1), 2);
  assert.equal(memoized(2), 3);
  assert.equal(memoized(2), 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [1, 2]);
});

test("default cache key function is JSON.stringify", () => {
  let calls: { a: number }[] = [];
  const fn = (a: { a: number }) => (calls.push(a), a.a + 1);
  const memoized = memoize(fn);
  assert.equal(memoized({ a: 1 }), 2);
  assert.equal(memoized({ a: 1 }), 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [{ a: 1 }]);
});

test("memoize caches undefined return values correctly", () => {
  let calls = 0;
  const fn = (_x: number): undefined => {
    calls++;
    return undefined;
  };
  const memoized = memoize(fn);
  assert.strictEqual(memoized(1), undefined);
  assert.strictEqual(memoized(1), undefined);
  assert.strictEqual(calls, 1);
});

test("memoize uses provided cacheKeyFn", () => {
  let calls = 0;
  const fn = (a: number) => (calls++, a * 2);
  // String() converts the first arg to a string — exercises the cacheKeyFn option branch.
  const memoized = memoize(fn, { cacheKeyFn: String });
  assert.equal(memoized(3), 6);
  assert.equal(memoized(3), 6);
  assert.equal(calls, 1);
});

test("memoize uses provided cache instance", () => {
  const cache = new Map<string, number>();
  const fn = (a: number) => a + 1;
  // Providing an explicit cache exercises the options.cache branch.
  const memoized = memoize(fn, { cache });
  assert.equal(memoized(5), 6);
  assert.equal(cache.size, 1);
});

test("once returns function that calls original function only once", () => {
  let counter = 0;
  const fn = () => (counter++, counter);
  const memoized = once(fn);
  assert.equal(memoized(), 1);
  assert.equal(memoized(), 1);
  assert.equal(counter, 1);
});

test("memoize accepts a minimal { get, has, set } cache (e.g. an LRUCache adapter)", () => {
  const lru = LRU.make<string, number>(2);
  const cache = {
    get: (k: string) => LRU.get(lru, k),
    has: (k: string) => LRU.has(lru, k),
    set: (k: string, v: number) => LRU.set(lru, k, v),
  };
  let calls = 0;
  const memoized = memoize((n: number) => (calls++, n * 2), { cache });
  assert.equal(memoized(1), 2);
  assert.equal(memoized(1), 2);
  assert.equal(calls, 1);
  memoized(2);
  memoized(3); // evicts the key for 1
  assert.equal(LRU.size(lru), 2);
  memoized(1);
  assert.equal(calls, 4);
});

test("once retries after fn throws and then caches the first success", () => {
  let calls = 0;
  const memoized = once(() => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return 42;
  });
  assert.throws(() => memoized(), /boom/);
  assert.equal(memoized(), 42);
  assert.equal(memoized(), 42);
  assert.equal(calls, 2);
});

test("once throws TypeError on a re-entrant call during the first run (G8-10)", () => {
  let calls = 0;
  let inner: unknown;
  const init: () => number = once(() => {
    calls++;
    if (calls === 1) {
      try {
        init();
      } catch (e) {
        inner = e;
      }
    }
    return calls;
  });
  assert.equal(init(), 1);
  assert.ok(inner instanceof TypeError, "re-entrant call throws TypeError");
  assert.equal(calls, 1, "fn ran exactly once");
  assert.equal(init(), 1);
});

test("once: an uncaught re-entrant TypeError fails the first run, which can be retried", () => {
  let calls = 0;
  const init: () => number = once(() => {
    calls++;
    if (calls === 1) init(); // propagates the TypeError out of fn
    return calls;
  });
  assert.throws(() => init(), TypeError);
  // The guard is cleared after the failed run, so the next call retries.
  assert.equal(init(), 2);
  assert.equal(init(), 2);
});

test("once with async fn: re-entry before the first await rejects, and that promise is cached (documented)", async () => {
  let calls = 0;
  const init: () => Promise<number> = once(async () => {
    calls++;
    await init(); // re-enters synchronously, inside the first run
    return calls;
  });
  const first = init();
  await assert.rejects(first, TypeError);
  assert.equal(init(), first, "the rejected promise is the cached result");
  assert.equal(calls, 1);
});

test("once with async fn: re-entry after the first await gets the cached promise", async () => {
  let calls = 0;
  let inner: Promise<number> | undefined;
  const init: () => Promise<number> = once(async () => {
    calls++;
    await Promise.resolve();
    inner = init();
    return calls;
  });
  const first = init();
  assert.equal(await first, 1);
  assert.equal(inner, first);
  assert.equal(calls, 1);
});

test("once caches an undefined result without calling fn again", () => {
  let calls = 0;
  const memoized = once((): undefined => {
    calls++;
    return undefined;
  });
  assert.equal(memoized(), undefined);
  assert.equal(memoized(), undefined);
  assert.equal(calls, 1);
});
