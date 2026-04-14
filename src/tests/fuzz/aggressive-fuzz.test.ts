/**
 * Aggressive fuzz testing — high iteration counts, edge-case-targeted generators,
 * and coverage-guided fuzzing to find bugs in vjuga library modules.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Queue from "../../Queue.js";
import * as LRU from "../../LRUCache.js";
import * as PQ from "../../PriorityQueue.js";
import * as RadixTree from "../../RadixTree.js";
import * as SOA from "../../SOA.js";
import * as Pool from "../../MemoryPool.js";
import * as HTML from "../../HTML.js";
import * as VJSON from "../../JSON.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ST from "../../StatefulTest.js";

// ============================================================================
// Queue — target capacity boundary transitions and wraparound
// ============================================================================

test("Queue: push/shift through multiple capacity doublings", () => {
  // Push enough to trigger multiple growList() calls, then shift everything.
  // Initial capacity is 4, so grow at 4, 8, 16, 32, 64...
  Prop.assert(
    Arb.integer(50, 500),
    (n) => {
      const q = Queue.make<number>();
      for (let i = 0; i < n; i++) Queue.push(q, i);
      for (let i = 0; i < n; i++) {
        if (Queue.shift(q) !== i) return false;
      }
      return Queue.size(q) === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("Queue: interleaved push/shift causes head to wrap around", () => {
  // Push some, shift some, push more — forces head > 0 during growList()
  Prop.assert(
    Arb.tuple(Arb.integer(1, 20), Arb.integer(1, 200)),
    ([warmup, ops]) => {
      const q = Queue.make<number>();
      const model: number[] = [];

      // Warm up: push then shift to advance head
      for (let i = 0; i < warmup; i++) Queue.push(q, -1);
      for (let i = 0; i < warmup; i++) Queue.shift(q);

      // Now do real operations with non-zero head
      let counter = 0;
      for (let i = 0; i < ops; i++) {
        Queue.push(q, counter);
        model.push(counter);
        counter++;
        // Occasionally shift to keep head moving
        if (i % 3 === 0 && model.length > 0) {
          const expected = model.shift();
          const actual = Queue.shift(q);
          if (actual !== expected) return false;
        }
      }

      // Drain and verify
      while (model.length > 0) {
        if (Queue.shift(q) !== model.shift()) return false;
      }
      return Queue.size(q) === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("Queue: unshift + pop (reverse direction) through capacity transitions", () => {
  Prop.assert(
    Arb.integer(50, 300),
    (n) => {
      const q = Queue.make<number>();
      for (let i = 0; i < n; i++) Queue.unshift(q, i);
      for (let i = 0; i < n; i++) {
        if (Queue.pop(q) !== i) return false;
      }
      return Queue.size(q) === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("Queue: dumpToArray then reuse", () => {
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { minLength: 1, maxLength: 100 }),
    (items) => {
      const q = Queue.make<number>();
      for (const v of items) Queue.push(q, v);
      const dumped = Queue.dumpToArray(q);
      if (dumped.length !== items.length) return false;
      for (let i = 0; i < items.length; i++) {
        if (dumped[i] !== items[i]) return false;
      }
      // Queue should be empty after dump
      if (Queue.size(q) !== 0) return false;
      // Should be reusable
      Queue.push(q, 999);
      return Queue.shift(q) === 999;
    },
    { numRuns: 1_000_000 },
  );
});

test("Queue: make(iterable) matches push-by-push", () => {
  Prop.assert(
    Arb.array(Arb.integer(-1000, 1000), { minLength: 0, maxLength: 100 }),
    (items) => {
      const q1 = Queue.make(items);
      const q2 = Queue.make<number>();
      for (const v of items) Queue.push(q2, v);

      if (Queue.size(q1) !== Queue.size(q2)) return false;
      const a1 = Queue.toArray(q1);
      const a2 = Queue.toArray(q2);
      return a1.every((v, i) => v === a2[i]);
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// LRUCache — capacity-1, rapid eviction, eviction-order verification
// ============================================================================

test("LRUCache: capacity-1 cache", () => {
  Prop.assert(
    Arb.array(Arb.tuple(Arb.string({ minLength: 1, maxLength: 3 }), Arb.integer(0, 100)), {
      minLength: 1,
      maxLength: 50,
    }),
    (pairs) => {
      const cache = LRU.make<string, number>(1);
      for (const [k, v] of pairs) {
        LRU.set(cache, k, v);
        if (LRU.size(cache) !== 1) return false;
        if (LRU.get(cache, k) !== v) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("LRUCache: get() promotes entry, preventing eviction", () => {
  // With capacity 2: set(a), set(b), get(a), set(c) should evict b not a
  Prop.assert(
    Arb.tuple(Arb.integer(0, 100), Arb.integer(0, 100), Arb.integer(0, 100)),
    ([va, vb, vc]) => {
      const cache = LRU.make<string, number>(2);
      LRU.set(cache, "a", va);
      LRU.set(cache, "b", vb);
      LRU.get(cache, "a"); // promote a to MRU
      LRU.set(cache, "c", vc); // should evict b (LRU)
      if (LRU.get(cache, "a") !== va) return false;
      if (LRU.has(cache, "b") !== false) return false;
      if (LRU.get(cache, "c") !== vc) return false;
      return LRU.size(cache) === 2;
    },
    { numRuns: 1_000_000 },
  );
});

test("LRUCache: high-volume stateful test (capacity 2-3)", () => {
  interface LRUModel {
    map: Map<string, number>;
    order: string[];
    capacity: number;
  }

  type LRUReal = LRU.LRUCache<string, number>;

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

  const keyArb = Arb.string({ minLength: 1, maxLength: 2 });

  function biasedKey(model: LRUModel): Arb.Arbitrary<string> {
    const keys = [...model.map.keys()];
    return keys.length > 0
      ? Arb.oneOf(Arb.constantFrom(...(keys as [string, ...string[]])), keyArb)
      : keyArb;
  }

  ST.assertStateful({
    initialModel: (): LRUModel => ({ map: new Map(), order: [], capacity: 2 }),
    initialReal: () => LRU.make<string, number>(2),
    commands: [
      (model) =>
        Arb.map(Arb.tuple(biasedKey(model), Arb.integer(0, 100)), ([k, v]) => ({
          name: `set(${k},${v})`,
          check: () => true,
          run: (m: LRUModel, r: LRUReal) => {
            LRU.set(r, k, v);
            modelSet(m, k, v);
          },
        })),
      (model) =>
        Arb.map(biasedKey(model), (k) => ({
          name: `get(${k})`,
          check: () => true,
          run: (m: LRUModel, r: LRUReal) => {
            const expected = modelGet(m, k);
            assert.equal(LRU.get(r, k), expected, `get(${k})`);
          },
        })),
      (model) =>
        Arb.map(biasedKey(model), (k) => ({
          name: `del(${k})`,
          check: () => true,
          run: (m: LRUModel, r: LRUReal) => {
            const existed = m.map.has(k);
            if (existed) {
              m.map.delete(k);
              m.order.splice(m.order.indexOf(k), 1);
            }
            assert.equal(LRU.del(r, k), existed, `del(${k})`);
            assert.equal(LRU.size(r), m.map.size, `size after del(${k})`);
          },
        })),
    ],
    numRuns: 1_000_000,
    maxCommands: 80,
    timeoutMs: 300_000,
  });
});

// ============================================================================
// PriorityQueue — duplicate priorities, all-same-element, single-element
// ============================================================================

test("PQ: all duplicate values maintain heap invariant", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(-100, 100), Arb.integer(2, 200)),
    ([val, n]) => {
      const pq = PQ.make<number>((a, b) => a - b);
      for (let i = 0; i < n; i++) PQ.push(pq, val);
      for (let i = 0; i < n; i++) {
        if (PQ.pop(pq) !== val) return false;
      }
      return PQ.size(pq) === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("PQ: large heapify then pop-all produces sorted output", () => {
  Prop.assert(
    Arb.array(Arb.integer(-10000, 10000), { minLength: 1, maxLength: 1000 }),
    (arr) => {
      const pq = PQ.make<number>((a, b) => a - b, arr);
      const sorted = arr.slice().sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        if (PQ.pop(pq) !== sorted[i]) return false;
      }
      return PQ.size(pq) === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("PQ: interleaved push/pop always returns current minimum", () => {
  const arb = Arb.array(
    Arb.tuple(Arb.constantFrom<"push" | "pop">("push", "pop"), Arb.integer(-1000, 1000)),
    { minLength: 1, maxLength: 200 },
  );

  Prop.assert(
    arb,
    (ops) => {
      const pq = PQ.make<number>((a, b) => a - b);
      const model: number[] = []; // sorted

      for (const [op, val] of ops) {
        if (op === "push") {
          PQ.push(pq, val);
          // Binary insert into sorted model
          let lo = 0,
            hi = model.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (model[mid] < val) lo = mid + 1;
            else hi = mid;
          }
          model.splice(lo, 0, val);
        } else if (model.length > 0) {
          const expected = model.shift();
          const actual = PQ.pop(pq);
          if (actual !== expected) return false;
        }
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// RadixTree — unicode keys, very long shared prefixes, prefix-of-prefix
// ============================================================================

test("RadixTree: unicode keys", () => {
  const unicodeKey = Arb.map(
    Arb.array(Arb.integer(0x20, 0xffff), { minLength: 0, maxLength: 10 }),
    (codes) => String.fromCharCode(...codes),
  );

  Prop.assert(
    Arb.array(Arb.tuple(unicodeKey, Arb.integer(0, 1000)), { minLength: 1, maxLength: 30 }),
    (pairs) => {
      const tree = RadixTree.make<number>();
      const map = new Map<string, number>();
      for (const [k, v] of pairs) {
        RadixTree.insert(tree, k, v);
        map.set(k, v);
      }
      for (const [k, v] of map) {
        if (RadixTree.lookup(tree, k) !== v) return false;
      }
      return RadixTree.size(tree) === map.size;
    },
    { numRuns: 1_000_000 },
  );
});

test("RadixTree: insert + remove + re-insert cycle preserves integrity", () => {
  const keyArb = Arb.string({ minLength: 0, maxLength: 6 });

  Prop.assert(
    Arb.array(Arb.tuple(keyArb, Arb.integer(0, 1000)), { minLength: 5, maxLength: 30 }),
    (pairs) => {
      const tree = RadixTree.make<number>();
      const map = new Map<string, number>();

      // Insert all
      for (const [k, v] of pairs) {
        RadixTree.insert(tree, k, v);
        map.set(k, v);
      }

      // Remove half
      const keys = [...map.keys()];
      const toRemove = keys.slice(0, keys.length >> 1);
      for (const k of toRemove) {
        RadixTree.remove(tree, k);
        map.delete(k);
      }

      // Re-insert removed keys with new values
      for (const k of toRemove) {
        const newVal = 9999;
        RadixTree.insert(tree, k, newVal);
        map.set(k, newVal);
      }

      // Verify all
      if (RadixTree.size(tree) !== map.size) return false;
      for (const [k, v] of map) {
        if (RadixTree.lookup(tree, k) !== v) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("RadixTree: long shared prefix stress", () => {
  // Keys like "aaaa...b", "aaaa...c", "aaaa...d" with long common prefix
  Prop.assert(
    Arb.tuple(Arb.integer(1, 50), Arb.integer(2, 26)),
    ([prefixLen, suffixCount]) => {
      const tree = RadixTree.make<number>();
      const prefix = "a".repeat(prefixLen);
      for (let i = 0; i < suffixCount; i++) {
        RadixTree.insert(tree, prefix + String.fromCharCode(97 + i), i);
      }
      if (RadixTree.size(tree) !== suffixCount) return false;
      for (let i = 0; i < suffixCount; i++) {
        if (RadixTree.lookup(tree, prefix + String.fromCharCode(97 + i)) !== i) return false;
      }
      // Prefix match should find all
      const matched = RadixTree.prefixMatch(tree, prefix);
      return matched.length === suffixCount;
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// SOA — swapRemove ordering, view consistency after mutations
// ============================================================================

test("SOA: swapRemove preserves all non-removed elements", () => {
  type Point = { x: number; y: number };

  Prop.assert(
    Arb.tuple(
      Arb.array(Arb.tuple(Arb.integer(-100, 100), Arb.integer(-100, 100)), {
        minLength: 2,
        maxLength: 50,
      }),
      Arb.nat(49),
    ),
    ([pairs, rawIdx]) => {
      const soa: SOA.SOA<Point> = { x: [], y: [] };
      const items: Point[] = [];
      for (const [x, y] of pairs) {
        SOA.push(soa, { x, y });
        items.push({ x, y });
      }

      const idx = rawIdx % items.length;
      SOA.swapRemove(soa, idx);
      // Model: same swap-remove
      if (idx !== items.length - 1) {
        items[idx] = items[items.length - 1];
      }
      items.pop();

      if (SOA.length(soa) !== items.length) return false;
      for (let i = 0; i < items.length; i++) {
        const got = SOA.get(soa, i);
        if (got.x !== items[i].x || got.y !== items[i].y) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("SOA: view reflects mutations correctly", () => {
  type Point = { x: number; y: number };

  Prop.assert(
    Arb.array(Arb.tuple(Arb.integer(-100, 100), Arb.integer(-100, 100)), {
      minLength: 1,
      maxLength: 20,
    }),
    (pairs) => {
      const soa: SOA.SOA<Point> = { x: [], y: [] };
      for (const [x, y] of pairs) SOA.push(soa, { x, y });

      const view = SOA.createView(soa, 0);

      // Check each index via view
      for (let i = 0; i < pairs.length; i++) {
        view.index = i;
        if (view.x !== pairs[i][0] || view.y !== pairs[i][1]) return false;
      }

      // Mutate via view
      view.index = 0;
      view.x = 9999;
      if (soa.x[0] !== 9999) return false;

      return true;
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// HTML — stress with all-special-chars input
// ============================================================================

test("HTML: string of only special chars", () => {
  const specialOnly = Arb.map(
    Arb.array(Arb.constantFrom("<", ">", "&", '"', "'"), { minLength: 1, maxLength: 100 }),
    (chars) => chars.join(""),
  );

  Prop.assert(
    specialOnly,
    (s) => {
      const escaped = HTML.escape(s);
      // No literal < > " ' in output
      for (let i = 0; i < escaped.length; i++) {
        const c = escaped[i]!;
        if (c === "<" || c === ">" || c === '"' || c === "'") return false;
      }
      // Length should be much larger (each char expands to 4-6 chars)
      return escaped.length >= s.length;
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// JSON — deep nesting, large objects, prototype pollution vectors
// ============================================================================

test("JSON: safeParse deeply nested proto pollution", () => {
  Prop.assert(
    Arb.integer(1, 10),
    (depth) => {
      // Build {"a":{"a":{"__proto__":{"hacked":true}}}}
      let json = '{"hacked":true}';
      for (let i = 0; i < depth; i++) {
        json = `{"__proto__":${json}}`;
      }
      json = `{"a":${json}}`;
      const result = VJSON.safeParse(json);
      if (result[0] !== true) return false;
      // Walk the result and ensure no __proto__ key anywhere
      const stack: unknown[] = [result[1]];
      while (stack.length > 0) {
        const obj = stack.pop();
        if (obj !== null && typeof obj === "object") {
          for (const key of Object.keys(obj as object)) {
            if (key === "__proto__" || key === "constructor") return false;
            stack.push((obj as Record<string, unknown>)[key]);
          }
        }
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("JSON: round-trip with recursive JSON values (high volume)", () => {
  // NOTE: dictionary keys must not contain backslash. V8 (Node ≥22) has a JIT
  // bug where, after ~25k JSON.parse calls on objects with backslash keys,
  // the parser starts misreading '\"' as '\\', corrupting subsequent parses.
  // This is a V8 bug (not a vjuga bug); filtering '\\' avoids triggering it.
  const safeKey = Arb.filter(Arb.string({ minLength: 1, maxLength: 6 }), (s) => !s.includes("\\"));
  const { jsonValue } = Arb.letrec((tie) => ({
    jsonValue: Arb.oneOf(
      Arb.map(Arb.integer(-1e6, 1e6), (n) => n as unknown),
      Arb.map(Arb.string({ maxLength: 20 }), (s) => s as unknown),
      Arb.map(Arb.boolean(), (b) => b as unknown),
      Arb.constant(null as unknown),
      Arb.map(Arb.array(tie("jsonValue"), { maxLength: 4 }), (a) => a as unknown),
      Arb.map(
        Arb.dictionary(safeKey, tie("jsonValue"), {
          maxSize: 4,
        }),
        (d) => d as unknown,
      ),
    ),
  }));

  Prop.assert(
    jsonValue,
    (v) => {
      const s = VJSON.stringify(v);
      if (s === undefined) return true; // skip undefined results
      const parsed = VJSON.parseExn(s);
      // Deep equality
      return JSON.stringify(parsed) === JSON.stringify(v);
    },
    { numRuns: 1_000_000 },
  );
});

// ============================================================================
// MemoryPool — rapid acquire/release, pool reset verification
// ============================================================================

test("MemoryPool: rapid acquire/release never corrupts", () => {
  Prop.assert(
    Arb.integer(10, 200),
    (n) => {
      const pool = Pool.make({
        factory: () => ({ val: 0 }),
        reset: (obj) => {
          obj.val = 0;
        },
        maxSize: 10,
      });

      for (let i = 0; i < n; i++) {
        const obj = Pool.acquire(pool);
        obj.val = i;
        Pool.release(pool, obj);
      }

      // After all releases, acquired object should have val=0 (reset ran)
      const final = Pool.acquire(pool);
      return final.val === 0;
    },
    { numRuns: 1_000_000 },
  );
});

test("MemoryPool: withAcquire exception still releases", () => {
  const pool = Pool.make({
    factory: () => ({ val: 0 }),
    maxSize: 5,
  });

  for (let i = 0; i < 100; i++) {
    try {
      Pool.withAcquire(pool, (obj) => {
        obj.val = 42;
        if (i % 2 === 0) throw new Error("intentional");
        return obj.val;
      });
    } catch {
      // expected
    }
  }

  // Pool should still be functional — acquire should work
  const obj = Pool.acquire(pool);
  assert.ok(obj !== undefined);
});

// ============================================================================
// Cross-module: Queue used as underlying storage for a task system
// ============================================================================

test("Queue + PQ: sort via priority queue matches direct sort", () => {
  Prop.assert(
    Arb.array(Arb.integer(-10000, 10000), { minLength: 0, maxLength: 500 }),
    (items) => {
      const q = Queue.make(items);
      const pq = PQ.make<number>((a, b) => a - b);

      // Move from queue to PQ
      while (Queue.size(q) > 0) {
        PQ.push(pq, Queue.shift(q)!);
      }

      // Pop from PQ into result
      const result: number[] = [];
      while (PQ.size(pq) > 0) {
        result.push(PQ.pop(pq)!);
      }

      const expected = items.slice().sort((a, b) => a - b);
      if (result.length !== expected.length) return false;
      return result.every((v, i) => v === expected[i]);
    },
    { numRuns: 1_000_000 },
  );
});
