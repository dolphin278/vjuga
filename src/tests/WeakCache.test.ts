import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as WeakCache from "../WeakCache.js";

/**
 * Test helper: finds the internal Map<K, WeakRef<V>> inside a WeakCache by
 * iterating its symbol-keyed properties.  Used to simulate stale WeakRefs
 * for coverage of GC-related code paths without relying on non-deterministic
 * garbage collection.
 */
function getInternalEntries<K, V extends object>(
  cache: WeakCache.WeakCache<K, V>,
): Map<K, WeakRef<V>> {
  const symbols = Object.getOwnPropertySymbols(cache);
  const entriesSym = symbols.find((s) => {
    const v = (cache as unknown as Record<symbol, unknown>)[s];
    return v instanceof Map;
  });
  assert.ok(entriesSym !== undefined, "should find kEntries symbol");
  return (cache as unknown as Record<symbol, unknown>)[entriesSym] as Map<K, WeakRef<V>>;
}

test("set/get basic round-trip", () => {
  const cache = WeakCache.make<string, object>();
  const value = { x: 1 };
  WeakCache.set(cache, "a", value);
  assert.equal(WeakCache.get(cache, "a"), value);
});

test("get() returns undefined for missing key", () => {
  const cache = WeakCache.make<string, object>();
  assert.equal(WeakCache.get(cache, "missing"), void 0);
});

test("has() returns correct presence", () => {
  const cache = WeakCache.make<string, object>();
  const value = { x: 1 };
  WeakCache.set(cache, "x", value);
  assert.equal(WeakCache.has(cache, "x"), true);
  assert.equal(WeakCache.has(cache, "y"), false);
});

test("size() tracks the number of entries", () => {
  const cache = WeakCache.make<string, object>();
  assert.equal(WeakCache.size(cache), 0);
  const a = { a: 1 };
  const b = { b: 2 };
  WeakCache.set(cache, "a", a);
  assert.equal(WeakCache.size(cache), 1);
  WeakCache.set(cache, "b", b);
  assert.equal(WeakCache.size(cache), 2);
  WeakCache.remove(cache, "a");
  assert.equal(WeakCache.size(cache), 1);
});

test("remove() removes the entry and returns true", () => {
  const cache = WeakCache.make<string, object>();
  const value = { k: 42 };
  WeakCache.set(cache, "k", value);
  assert.equal(WeakCache.remove(cache, "k"), true);
  assert.equal(WeakCache.has(cache, "k"), false);
  assert.equal(WeakCache.size(cache), 0);
});

test("remove() returns false for missing key", () => {
  const cache = WeakCache.make<string, object>();
  assert.equal(WeakCache.remove(cache, "nope"), false);
});

test("set() on existing key updates value", () => {
  const cache = WeakCache.make<string, object>();
  const v1 = { v: 1 };
  const v2 = { v: 2 };
  WeakCache.set(cache, "a", v1);
  WeakCache.set(cache, "a", v2);
  assert.equal(WeakCache.get(cache, "a"), v2);
  assert.equal(WeakCache.size(cache), 1);
});

test("multiple keys with distinct values", () => {
  const cache = WeakCache.make<string, object>();
  const a = { a: 1 };
  const b = { b: 2 };
  const c = { c: 3 };
  WeakCache.set(cache, "a", a);
  WeakCache.set(cache, "b", b);
  WeakCache.set(cache, "c", c);
  assert.equal(WeakCache.get(cache, "a"), a);
  assert.equal(WeakCache.get(cache, "b"), b);
  assert.equal(WeakCache.get(cache, "c"), c);
  assert.equal(WeakCache.size(cache), 3);
});

test("get() returns undefined and cleans up when WeakRef is stale", () => {
  // Simulate a stale WeakRef by directly manipulating the internal map.
  // This exercises the code path where deref() returns undefined without
  // relying on non-deterministic GC behavior.
  const cache = WeakCache.make<string, object>();
  const value = { x: 1 };
  WeakCache.set(cache, "a", value);

  const entries = getInternalEntries(cache);
  // Replace the real WeakRef with a stub whose deref() always returns undefined,
  // simulating a GC-collected value.
  entries.set("a", { deref: () => undefined } as unknown as WeakRef<object>);

  assert.equal(WeakCache.get(cache, "a"), void 0);
  // The stale entry should have been eagerly removed.
  assert.equal(WeakCache.has(cache, "a"), false);
});

test("has() returns false and cleans up when WeakRef is stale", () => {
  const cache = WeakCache.make<string, object>();
  const value = { x: 1 };
  WeakCache.set(cache, "a", value);

  const entries = getInternalEntries(cache);
  entries.set("a", { deref: () => undefined } as unknown as WeakRef<object>);

  assert.equal(WeakCache.has(cache, "a"), false);
});

test("remove() on stale WeakRef still returns true", () => {
  const cache = WeakCache.make<string, object>();
  const value = { x: 1 };
  WeakCache.set(cache, "a", value);

  const entries = getInternalEntries(cache);
  entries.set("a", { deref: () => undefined } as unknown as WeakRef<object>);

  // remove should still return true — the key exists in the map even though
  // the value has been collected.
  assert.equal(WeakCache.remove(cache, "a"), true);
  assert.equal(WeakCache.size(cache), 0);
});

test("set() overwriting a stale WeakRef does not increment size", () => {
  const cache = WeakCache.make<string, object>();
  const v1 = { v: 1 };
  WeakCache.set(cache, "a", v1);
  assert.equal(WeakCache.size(cache), 1);

  // Simulate stale ref for the existing entry.
  const entries = getInternalEntries(cache);
  entries.set("a", { deref: () => undefined } as unknown as WeakRef<object>);

  // Overwriting the stale entry — key already exists in map, so size should
  // not change.
  const v2 = { v: 2 };
  WeakCache.set(cache, "a", v2);
  assert.equal(WeakCache.size(cache), 1);
  assert.equal(WeakCache.get(cache, "a"), v2);
});

test("numeric keys work correctly", () => {
  const cache = WeakCache.make<number, object>();
  const a = { a: 1 };
  const b = { b: 2 };
  WeakCache.set(cache, 1, a);
  WeakCache.set(cache, 2, b);
  assert.equal(WeakCache.get(cache, 1), a);
  assert.equal(WeakCache.get(cache, 2), b);
  assert.equal(WeakCache.has(cache, 3), false);
  assert.equal(WeakCache.size(cache), 2);
});

test("cleanupStaleEntry removes stale entry from map", () => {
  const entries = new Map<string, WeakRef<object>>();
  entries.set("a", { deref: () => undefined } as unknown as WeakRef<object>);
  WeakCache.cleanupStaleEntry(entries, "a");
  assert.equal(entries.has("a"), false);
});

test("cleanupStaleEntry does nothing for missing key", () => {
  const entries = new Map<string, WeakRef<object>>();
  WeakCache.cleanupStaleEntry(entries, "missing");
  assert.equal(entries.size, 0);
});

test("cleanupStaleEntry does nothing when ref is still alive", () => {
  const entries = new Map<string, WeakRef<object>>();
  const alive = { alive: true };
  entries.set("a", new WeakRef(alive));
  WeakCache.cleanupStaleEntry(entries, "a");
  assert.equal(entries.has("a"), true);
  // Keep alive reference to prevent GC from collecting it during the test.
  void alive;
});

test("size() does not drift when entries are removed or overwritten", () => {
  const cache = WeakCache.make<string, object>();
  const a = { a: 1 };
  WeakCache.set(cache, "a", a);
  WeakCache.set(cache, "a", { a: 2 });
  WeakCache.set(cache, "b", a);
  assert.equal(WeakCache.size(cache), 2);
  WeakCache.remove(cache, "a");
  WeakCache.remove(cache, "a");
  assert.equal(WeakCache.size(cache), 1);
  // Stale entries observed by get()/has() are dropped from size().
  const entries = getInternalEntries(cache);
  entries.set("b", { deref: () => undefined } as unknown as WeakRef<object>);
  assert.equal(WeakCache.get(cache, "b"), void 0);
  assert.equal(WeakCache.size(cache), 0);
});

// --- Real GC paths.  The test scripts run node with --expose-gc; Bun has its
// own gc.  Missing gc is a hard failure so these paths cannot silently stop
// being exercised in CI.

function forceGc(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  const bun = (globalThis as unknown as { Bun?: { gc(sync: boolean): void } }).Bun;
  if (g !== undefined) g();
  else if (bun !== undefined) bun.gc(true);
  else assert.fail("gc unavailable: run tests with node --expose-gc");
}

/** GC until `done()` holds (finalizers run in later macrotasks). */
async function gcUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i++) {
    forceGc();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

// Separate functions so the temporaries are not live in the test's frame.
function fill(cache: WeakCache.WeakCache<string, object>, n: number): void {
  for (let i = 0; i < n; i++) WeakCache.set(cache, `k${i}`, { i });
}

test("GC: finalizer cleans up collected entries and size() reaches 0", async () => {
  const cache = WeakCache.make<string, object>();
  const entries = getInternalEntries(cache);
  fill(cache, 100);
  assert.equal(WeakCache.size(cache), 100);
  await gcUntil(() => entries.size === 0);
  assert.equal(entries.size, 0);
  assert.equal(WeakCache.size(cache), 0);
});

function setShared(cache: WeakCache.WeakCache<string, object>): void {
  const shared = { shared: true };
  WeakCache.set(cache, "a", shared);
  WeakCache.set(cache, "b", shared);
  WeakCache.remove(cache, "a");
}

test("GC: remove(a) does not cancel the finalizer of b sharing the same value", async () => {
  const cache = WeakCache.make<string, object>();
  const entries = getInternalEntries(cache);
  setShared(cache);
  assert.equal(WeakCache.size(cache), 1);
  await gcUntil(() => entries.size === 0);
  assert.equal(WeakCache.size(cache), 0);
});

function setThenOverwrite(cache: WeakCache.WeakCache<string, object>, keep: object): void {
  WeakCache.set(cache, "key", { old: true });
  WeakCache.set(cache, "key", keep);
}

test("GC: finalizer of an overwritten value does not delete the new entry", async () => {
  const cache = WeakCache.make<string, object>();
  const keep = { keep: true };
  setThenOverwrite(cache, keep);
  for (let i = 0; i < 5; i++) {
    forceGc();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(WeakCache.get(cache, "key"), keep);
  assert.equal(WeakCache.size(cache), 1);
});
