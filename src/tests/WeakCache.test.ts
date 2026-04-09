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

// requires --expose-gc; cannot be exercised in standard test runner
/* node:coverage disable */
test("FinalizationRegistry callback cleans up stale entries after GC", async () => {
  const gc = (globalThis as unknown as Record<string, (() => void) | undefined>).gc;
  if (gc === undefined) return;

  const cache = WeakCache.make<string, object>();
  const entries = getInternalEntries(cache);

  {
    let obj: object | undefined = { ephemeral: true };
    WeakCache.set(cache, "ephemeral", obj);
    obj = undefined;
  }

  gc();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  gc();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  assert.equal(entries.has("ephemeral"), false);
});

test("FinalizationRegistry callback ignores re-set keys", async () => {
  const gc = (globalThis as unknown as Record<string, (() => void) | undefined>).gc;
  if (gc === undefined) return;

  const cache = WeakCache.make<string, object>();
  const entries = getInternalEntries(cache);

  {
    let oldValue: object | undefined = { old: true };
    WeakCache.set(cache, "key", oldValue);
    const newValue = { new: true };
    WeakCache.set(cache, "key", newValue);
    oldValue = undefined;
    assert.equal(WeakCache.get(cache, "key"), newValue);
  }

  gc();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  gc();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  assert.equal(entries.has("key"), true);
});
/* node:coverage enable */
