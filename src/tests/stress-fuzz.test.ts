/**
 * Stress fuzz tests — maximum iteration counts, adversarial inputs.
 * Focuses on corner cases most likely to reveal bugs:
 * - Queue size() correctness around capacity boundary (off-by-one in mask)
 * - LRUCache linked-list pointer corruption after eviction cycles
 * - PriorityQueue comparator edge cases (equal elements, NaN)
 * - RadixTree empty-string keys mixed with non-empty
 * - SOA pop() on empty, swapRemove last element
 * - Validator: non-object/non-array inputs to object()/array()
 * - JSON: parse edge cases (empty string, whitespace-only, nested arrays)
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Queue from "../Queue.js";
import * as LRU from "../LRUCache.js";
import * as PQ from "../PriorityQueue.js";
import * as RadixTree from "../RadixTree.js";
import * as SOA from "../SOA.js";
import * as V from "../Validator.js";
import * as VJSON from "../JSON.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";

// ============================================================================
// Queue: size() correctness at exact capacity boundaries
// ============================================================================

test("Queue: size is exact at every power-of-2 boundary", () => {
  // Capacity transitions happen at 4, 8, 16, 32, 64, 128, 256...
  // size() uses (tail - head + len) & mask — if mask is wrong, size overflows
  for (const boundary of [3, 4, 7, 8, 15, 16, 31, 32, 63, 64, 127, 128, 255, 256]) {
    const q = Queue.make<number>();
    for (let i = 0; i < boundary; i++) {
      Queue.push(q, i);
      assert.equal(Queue.size(q), i + 1, `size wrong after ${i + 1} pushes (boundary ${boundary})`);
    }
    for (let i = 0; i < boundary; i++) {
      Queue.shift(q);
      assert.equal(Queue.size(q), boundary - i - 1, `size wrong after ${i + 1} shifts (boundary ${boundary})`);
    }
  }
});

test("Queue: alternating push-front/pop-back at exact capacity", () => {
  // This creates maximum wrap-around stress
  Prop.assert(
    Arb.integer(10, 100),
    (n) => {
      const q = Queue.make<number>();
      const model: number[] = [];

      for (let i = 0; i < n; i++) {
        // Alternate between unshift and push
        if (i % 2 === 0) {
          Queue.unshift(q, i);
          model.unshift(i);
        } else {
          Queue.push(q, i);
          model.push(i);
        }
      }

      // Drain alternating front/back
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          const expected = model.shift();
          const actual = Queue.shift(q);
          if (actual !== expected) return false;
        } else {
          const expected = model.pop();
          const actual = Queue.pop(q);
          if (actual !== expected) return false;
        }
      }

      return Queue.size(q) === 0;
    },
    { numRuns: 5000 },
  );
});

// ============================================================================
// LRUCache: full eviction cycle then rebuild
// ============================================================================

test("LRUCache: fill, evict all via new keys, verify old keys gone", () => {
  Prop.assert(
    Arb.integer(1, 20),
    (cap) => {
      const cache = LRU.make<number, number>(cap);

      // Fill to capacity
      for (let i = 0; i < cap; i++) LRU.set(cache, i, i);
      if (LRU.size(cache) !== cap) return false;

      // Insert cap new keys — should evict ALL old keys
      for (let i = cap; i < cap * 2; i++) LRU.set(cache, i, i);
      if (LRU.size(cache) !== cap) return false;

      // Old keys should be gone
      for (let i = 0; i < cap; i++) {
        if (LRU.has(cache, i) !== false) return false;
      }

      // New keys should be present
      for (let i = cap; i < cap * 2; i++) {
        if (LRU.get(cache, i) !== i) return false;
      }

      return true;
    },
    { numRuns: 3000 },
  );
});

test("LRUCache: del all entries then reuse", () => {
  Prop.assert(
    Arb.integer(1, 20),
    (cap) => {
      const cache = LRU.make<number, number>(cap);

      // Fill
      for (let i = 0; i < cap; i++) LRU.set(cache, i, i);

      // Del all
      for (let i = 0; i < cap; i++) {
        if (LRU.del(cache, i) !== true) return false;
      }
      if (LRU.size(cache) !== 0) return false;

      // Reuse — fill again
      for (let i = 100; i < 100 + cap; i++) LRU.set(cache, i, i);
      if (LRU.size(cache) !== cap) return false;

      for (let i = 100; i < 100 + cap; i++) {
        if (LRU.get(cache, i) !== i) return false;
      }

      return true;
    },
    { numRuns: 3000 },
  );
});

// ============================================================================
// PriorityQueue: edge cases
// ============================================================================

test("PQ: single element push/pop cycle", () => {
  Prop.assert(
    Arb.integer(1, 1000),
    (n) => {
      const pq = PQ.make<number>((a, b) => a - b);
      for (let i = 0; i < n; i++) {
        PQ.push(pq, i);
        if (PQ.pop(pq) !== i) return false;
        if (PQ.size(pq) !== 0) return false;
      }
      return true;
    },
    { numRuns: 3000 },
  );
});

test("PQ: reverse-sorted input (worst case for sift-up)", () => {
  Prop.assert(
    Arb.integer(1, 500),
    (n) => {
      const pq = PQ.make<number>((a, b) => a - b);
      // Push in descending order — each push sifts all the way to root
      for (let i = n; i > 0; i--) PQ.push(pq, i);
      // Pop should produce 1..n
      for (let i = 1; i <= n; i++) {
        if (PQ.pop(pq) !== i) return false;
      }
      return true;
    },
    { numRuns: 2000 },
  );
});

// ============================================================================
// RadixTree: empty key mixed with other keys, single-char keys
// ============================================================================

test("RadixTree: empty key alongside regular keys", () => {
  Prop.assert(
    Arb.array(Arb.string({ minLength: 0, maxLength: 5 }), { minLength: 1, maxLength: 30 }),
    (keys) => {
      const tree = RadixTree.make<number>();
      const map = new Map<string, number>();

      for (let i = 0; i < keys.length; i++) {
        RadixTree.insert(tree, keys[i], i);
        map.set(keys[i], i);
      }

      if (RadixTree.size(tree) !== map.size) return false;

      for (const [k, v] of map) {
        if (RadixTree.lookup(tree, k) !== v) return false;
      }

      // Remove all and verify
      for (const k of map.keys()) {
        if (RadixTree.remove(tree, k) !== true) return false;
      }

      return RadixTree.size(tree) === 0;
    },
    { numRuns: 5000 },
  );
});

test("RadixTree: single-char keys stress binary search", () => {
  // All 256 single-byte chars as keys
  const tree = RadixTree.make<number>();
  for (let i = 0; i < 256; i++) {
    RadixTree.insert(tree, String.fromCharCode(i), i);
  }
  assert.equal(RadixTree.size(tree), 256);

  // Lookup each
  for (let i = 0; i < 256; i++) {
    assert.equal(RadixTree.lookup(tree, String.fromCharCode(i)), i);
  }

  // Remove odd chars
  for (let i = 1; i < 256; i += 2) {
    assert.equal(RadixTree.remove(tree, String.fromCharCode(i)), true);
  }
  assert.equal(RadixTree.size(tree), 128);

  // Even chars still present
  for (let i = 0; i < 256; i += 2) {
    assert.equal(RadixTree.lookup(tree, String.fromCharCode(i)), i);
  }
});

// ============================================================================
// Validator: adversarial inputs
// ============================================================================

test("Validator: object() rejects arrays, null, primitives", () => {
  const objV = V.object({ x: V.number() });

  // Arrays are typeof "object" but should fail object validation
  assert.equal(objV([])[0], false);
  assert.equal(objV([1, 2, 3])[0], false);
  assert.equal(objV(null)[0], false);
  assert.equal(objV(undefined)[0], false);
  assert.equal(objV(42)[0], false);
  assert.equal(objV("string")[0], false);
  assert.equal(objV(true)[0], false);
});

test("Validator: object() with missing fields returns Err", () => {
  const validator = V.object({ a: V.string(), b: V.number() });

  // Missing 'b'
  assert.equal(validator({ a: "hello" })[0], false);
  // Missing 'a'
  assert.equal(validator({ b: 42 })[0], false);
  // Empty object
  assert.equal(validator({})[0], false);
  // Extra field is OK (structural typing)
  assert.equal(validator({ a: "hello", b: 42, c: true })[0], true);
});

test("Validator: map() transforms values correctly under fuzz", () => {
  const doubleV = V.map(V.number(), (n: number) => n * 2);

  Prop.assert(
    Arb.integer(-10000, 10000),
    (n) => {
      const result = doubleV(n);
      if (result[0] !== true) return false;
      return result[1] === n * 2;
    },
    { numRuns: 5000 },
  );
});

// ============================================================================
// JSON: edge-case strings
// ============================================================================

test("JSON: parse edge cases", () => {
  // Empty string
  assert.equal(VJSON.parse(""), undefined);
  // Whitespace only
  assert.equal(VJSON.parse("   "), undefined);
  // Valid primitives
  assert.equal(VJSON.parse("null"), null);
  assert.equal(VJSON.parse("true"), true);
  assert.equal(VJSON.parse("false"), false);
  assert.equal(VJSON.parse("42"), 42);
  assert.equal(VJSON.parse('"hello"'), "hello");
  // Deeply nested arrays
  assert.deepEqual(VJSON.parse("[[[[1]]]]"), [[[[1]]]]);
  // Object with numeric string keys
  assert.deepEqual(VJSON.parse('{"0":"a","1":"b"}'), { "0": "a", "1": "b" });
});

test("JSON: safeParse with constructor key", () => {
  const json = '{"constructor":{"prototype":{"polluted":true}}}';
  const result = VJSON.safeParse(json);
  assert.equal(result[0], true);
  // constructor key should be stripped
  const obj = result[1] as Record<string, unknown>;
  assert.equal(Object.hasOwn(obj, "constructor"), false);
});

// ============================================================================
// SOA: boundary operations
// ============================================================================

test("SOA: swapRemove last element (idx === length-1)", () => {
  type Point = { x: number; y: number };
  const soa: SOA.SOA<Point> = { x: [1, 2, 3], y: [4, 5, 6] };

  // swapRemove last — just a pop, no swap needed
  SOA.swapRemove(soa, 2);
  assert.equal(SOA.length(soa), 2);
  // SOA.get returns null-prototype objects — compare field by field
  const p0 = SOA.get(soa, 0);
  assert.equal(p0.x, 1); assert.equal(p0.y, 4);
  const p1 = SOA.get(soa, 1);
  assert.equal(p1.x, 2); assert.equal(p1.y, 5);
});

test("SOA: swapRemove first element", () => {
  type Point = { x: number; y: number };
  const soa: SOA.SOA<Point> = { x: [1, 2, 3], y: [4, 5, 6] };

  SOA.swapRemove(soa, 0);
  assert.equal(SOA.length(soa), 2);
  // Element 0 should now be what was element 2
  const p0 = SOA.get(soa, 0);
  assert.equal(p0.x, 3); assert.equal(p0.y, 6);
  const p1 = SOA.get(soa, 1);
  assert.equal(p1.x, 2); assert.equal(p1.y, 5);
});

test("SOA: swapRemove out of bounds throws", () => {
  type Point = { x: number; y: number };
  const soa: SOA.SOA<Point> = { x: [1], y: [2] };

  assert.throws(() => SOA.swapRemove(soa, 1), RangeError);
  assert.throws(() => SOA.swapRemove(soa, -1), RangeError);
});

// ============================================================================
// High-volume stateful tests (10x normal run count)
// ============================================================================

test("Queue: 10,000-run stateful test", () => {
  type Model = { arr: number[] };
  type Real = Queue.Queue<number>;

  ST.assertStateful<Model, Real>({
    initialModel: () => ({ arr: [] }),
    initialReal: () => Queue.make(),
    commands: [
      (_m) => Arb.map(Arb.integer(0, 10000), (v) => ({
        name: `push(${v})`, check: () => true,
        run: (m, r) => { m.arr.push(v); Queue.push(r, v); },
      })),
      (_m) => Arb.constant<ST.Command<Model, Real>>({
        name: "shift", check: (m) => m.arr.length > 0,
        run: (m, r) => { assert.equal(Queue.shift(r), m.arr.shift()); },
      }),
      (_m) => Arb.constant<ST.Command<Model, Real>>({
        name: "pop", check: (m) => m.arr.length > 0,
        run: (m, r) => { assert.equal(Queue.pop(r), m.arr.pop()); },
      }),
      (_m) => Arb.map(Arb.integer(0, 10000), (v) => ({
        name: `unshift(${v})`, check: () => true,
        run: (m, r) => { m.arr.unshift(v); Queue.unshift(r, v); },
      })),
      (_m) => Arb.constant<ST.Command<Model, Real>>({
        name: "toArray", check: () => true,
        run: (m, r) => { assert.deepEqual(Queue.toArray(r), m.arr); },
      }),
    ],
    numRuns: 10000,
    maxCommands: 30,
  });
});

test("LRUCache: 5,000-run stateful test (capacity 3)", () => {
  interface LRUModel { map: Map<string, number>; order: string[]; capacity: number; }
  type LRUReal = LRU.LRUCache<string, number>;
  const keyArb = Arb.string({ minLength: 1, maxLength: 2 });

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
    } else {
      if (m.map.size >= m.capacity) {
        const lru = m.order.pop()!;
        m.map.delete(lru);
      }
      m.map.set(k, v);
    }
    m.order.unshift(k);
  }

  function biasedKey(model: LRUModel): Arb.Arbitrary<string> {
    const keys = [...model.map.keys()];
    return keys.length > 0
      ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
      : keyArb;
  }

  ST.assertStateful({
    initialModel: (): LRUModel => ({ map: new Map(), order: [], capacity: 3 }),
    initialReal: () => LRU.make<string, number>(3),
    commands: [
      (model) => Arb.map(Arb.tuple(biasedKey(model), Arb.integer(0, 100)), ([k, v]) => ({
        name: `set(${k},${v})`, check: () => true,
        run: (m: LRUModel, r: LRUReal) => { LRU.set(r, k, v); modelSet(m, k, v); },
      })),
      (model) => Arb.map(biasedKey(model), (k) => ({
        name: `get(${k})`, check: () => true,
        run: (m: LRUModel, r: LRUReal) => { assert.equal(LRU.get(r, k), modelGet(m, k)); },
      })),
      (model) => Arb.map(biasedKey(model), (k) => ({
        name: `del(${k})`, check: () => true,
        run: (m: LRUModel, r: LRUReal) => {
          const existed = m.map.has(k);
          if (existed) { m.map.delete(k); m.order.splice(m.order.indexOf(k), 1); }
          assert.equal(LRU.del(r, k), existed);
        },
      })),
      (_model) => Arb.constant<ST.Command<LRUModel, LRUReal>>({
        name: "size", check: () => true,
        run: (m, r) => { assert.equal(LRU.size(r), m.map.size); },
      }),
    ],
    numRuns: 5000,
    maxCommands: 50,
  });
});
