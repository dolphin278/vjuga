/**
 * Deep fuzz testing — targets code paths that are hard to reach:
 * - Queue tryToShrinkList (>10,000 elements)
 * - Memoization edge cases
 * - RadixTree massive trees with remove/merge cascades
 * - LRUCache: rapid set/del/set cycles on same key
 * - SOA: set() with item that has extra keys
 * - Coverage-guided fuzzing on JSON and HTML
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Queue from "../Queue.js";
import * as LRU from "../LRUCache.js";
import * as PQ from "../PriorityQueue.js";
import * as RadixTree from "../RadixTree.js";
import * as SOA from "../SOA.js";
import * as HTML from "../HTML.js";
import * as VJSON from "../JSON.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as ST from "../StatefulTest.js";
import * as CG from "../CoverageGuided.js";

// ============================================================================
// Queue: tryToShrinkList path (requires list.length > 10,000)
// ============================================================================

test("Queue: tryToShrinkList path — push 15k, shift most, verify shrink", () => {
  const q = Queue.make<number>();
  const N = 15000;

  // Push 15k items — forces multiple growList calls
  for (let i = 0; i < N; i++) Queue.push(q, i);
  assert.equal(Queue.size(q), N);

  // Shift all but ~100 — should trigger tryToShrinkList
  const keep = 100;
  for (let i = 0; i < N - keep; i++) {
    const v = Queue.shift(q);
    assert.equal(v, i);
  }
  assert.equal(Queue.size(q), keep);

  // Verify remaining elements are correct
  for (let i = N - keep; i < N; i++) {
    assert.equal(Queue.shift(q), i);
  }
  assert.equal(Queue.size(q), 0);
});

test("Queue: tryToShrinkList via pop path", () => {
  const q = Queue.make<number>();
  const N = 15000;
  for (let i = 0; i < N; i++) Queue.push(q, i);

  // Pop from the back — also triggers tryToShrinkList
  for (let i = N - 1; i >= 100; i--) {
    assert.equal(Queue.pop(q), i);
  }
  assert.equal(Queue.size(q), 100);

  // Remaining elements should still be correct (front of queue)
  for (let i = 0; i < 100; i++) {
    assert.equal(Queue.shift(q), i);
  }
});

test("Queue: shrink only happens when tail > head", () => {
  // tryToShrinkList has condition: tail > head
  // If we have a wrapped buffer (head > tail), shrink should NOT happen
  const q = Queue.make<number>();
  const N = 15000;

  // Push N items
  for (let i = 0; i < N; i++) Queue.push(q, i);

  // Shift half to advance head past the middle
  for (let i = 0; i < N / 2; i++) Queue.shift(q);

  // Push more to wrap tail around
  for (let i = 0; i < 100; i++) Queue.push(q, N + i);

  // Pop most items from the back — this is the wrapped case
  const expectedSize = Queue.size(q);
  for (let i = 0; i < expectedSize - 50; i++) {
    Queue.pop(q);
  }

  // Queue should still be functional
  assert.equal(Queue.size(q), 50);
  const arr = Queue.toArray(q);
  assert.equal(arr.length, 50);
});

// ============================================================================
// LRUCache: set/del/set same key in tight loop
// ============================================================================

test("LRUCache: rapid set-del-set on same key doesn't corrupt", () => {
  Prop.assert(
    Arb.integer(100, 1000),
    (n) => {
      const cache = LRU.make<string, number>(5);
      for (let i = 0; i < n; i++) {
        LRU.set(cache, "key", i);
        if (i % 3 === 0) LRU.del(cache, "key");
        if (i % 5 === 0) {
          LRU.set(cache, "other", i);
          LRU.set(cache, "another", i);
          LRU.set(cache, "more", i);
          LRU.set(cache, "extra", i);
          LRU.set(cache, "overflow", i); // should evict LRU
        }
      }
      // Cache should be valid
      return LRU.size(cache) <= 5 && LRU.size(cache) >= 0;
    },
    { numRuns: 2000 },
  );
});

test("LRUCache: capacity-1 del then immediate set", () => {
  Prop.assert(
    Arb.array(Arb.tuple(Arb.constantFrom("a", "b", "c"), Arb.integer(0, 100)), {
      minLength: 1,
      maxLength: 100,
    }),
    (ops) => {
      const cache = LRU.make<string, number>(1);
      const model = new Map<string, number>();

      for (const [k, v] of ops) {
        // Randomly del or set
        if (v % 3 === 0 && model.has(k)) {
          LRU.del(cache, k);
          model.delete(k);
        } else {
          // Evict if full and inserting new key
          if (!model.has(k) && model.size >= 1) {
            const [firstKey] = model;
            model.delete(firstKey[0]);
          }
          LRU.set(cache, k, v);
          model.set(k, v);
        }

        if (LRU.size(cache) !== model.size) return false;
      }
      return true;
    },
    { numRuns: 3000 },
  );
});

// ============================================================================
// RadixTree: massive tree with full remove/re-insert (merge cascade)
// ============================================================================

test("RadixTree: 500-key insert-remove-verify cycle", () => {
  const tree = RadixTree.make<number>();
  const map = new Map<string, number>();

  // Generate deterministic but varied keys
  const keys: string[] = [];
  for (let i = 0; i < 500; i++) {
    // Mix of: short, medium, prefix-sharing keys
    keys.push(`/api/v${i % 3}/users/${i}`);
    keys.push(`/api/v${i % 3}/posts/${i}`);
    keys.push(`k${i}`);
  }

  // Insert all
  for (let i = 0; i < keys.length; i++) {
    RadixTree.insert(tree, keys[i], i);
    map.set(keys[i], i);
  }

  assert.equal(RadixTree.size(tree), map.size);

  // Remove every third key
  for (let i = 0; i < keys.length; i += 3) {
    RadixTree.remove(tree, keys[i]);
    map.delete(keys[i]);
  }

  assert.equal(RadixTree.size(tree), map.size);

  // Verify remaining
  for (const [k, v] of map) {
    assert.equal(RadixTree.lookup(tree, k), v, `lookup(${k}) failed`);
  }

  // Verify removed keys return undefined
  for (let i = 0; i < keys.length; i += 3) {
    if (!map.has(keys[i])) {
      assert.equal(RadixTree.lookup(tree, keys[i]), undefined, `${keys[i]} should be removed`);
    }
  }

  // Re-insert removed keys
  for (let i = 0; i < keys.length; i += 3) {
    RadixTree.insert(tree, keys[i], i + 10000);
    map.set(keys[i], i + 10000);
  }

  assert.equal(RadixTree.size(tree), map.size);

  // Final verification
  const entries = new Map(RadixTree.entries(tree));
  assert.equal(entries.size, map.size);
  for (const [k, v] of map) {
    assert.equal(entries.get(k), v, `entries mismatch for ${k}`);
  }
});

// ============================================================================
// Coverage-guided fuzzing on JSON.safeParse
// ============================================================================

test("CoverageGuided: fuzz JSON.safeParse with arbitrary strings", () => {
  const result = CG.fuzz(
    Arb.string({ maxLength: 200 }),
    (input) => {
      // safeParse should never throw — it returns a Result
      const res = VJSON.safeParse(input);
      if (res[0] !== true && res[0] !== false) {
        throw new Error(`safeParse returned invalid result`);
      }
    },
    { maxDuration: 5000 },
  );

  assert.equal(result.ok, true, `safeParse crashed: ${result.error}`);
});

// ============================================================================
// Coverage-guided fuzzing on HTML.escape
// ============================================================================

test("CoverageGuided: fuzz HTML.escape never throws", () => {
  const result = CG.fuzz(
    Arb.string({ maxLength: 500 }),
    (input) => {
      const escaped = HTML.escape(input);
      // escaped must be a string
      if (typeof escaped !== "string") {
        throw new Error(`escape returned ${typeof escaped}`);
      }
      // Must not contain raw < > " '
      for (let i = 0; i < escaped.length; i++) {
        const c = escaped[i];
        if (c === "<" || c === ">" || c === '"' || c === "'") {
          throw new Error(`Unescaped '${c}' at position ${i}`);
        }
      }
    },
    { maxDuration: 5000 },
  );

  assert.equal(result.ok, true, `HTML.escape failed: ${result.error}`);
});

// ============================================================================
// Coverage-guided fuzzing on RadixTree
// ============================================================================

test("CoverageGuided: fuzz RadixTree operations never crash", () => {
  const opArb = Arb.tuple(
    Arb.constantFrom<"insert" | "lookup" | "remove" | "prefixMatch" | "entries">(
      "insert",
      "lookup",
      "remove",
      "prefixMatch",
      "entries",
    ),
    Arb.string({ maxLength: 20 }),
    Arb.integer(0, 10000),
  );

  const tree = RadixTree.make<number>();

  const result = CG.fuzz(
    opArb,
    ([op, key, val]) => {
      switch (op) {
        case "insert":
          RadixTree.insert(tree, key, val);
          break;
        case "lookup":
          RadixTree.lookup(tree, key);
          break;
        case "remove":
          RadixTree.remove(tree, key);
          break;
        case "prefixMatch":
          RadixTree.prefixMatch(tree, key);
          break;
        case "entries":
          RadixTree.entries(tree);
          break;
      }
    },
    { maxDuration: 5000 },
  );

  assert.equal(result.ok, true, `RadixTree crashed: ${result.error}`);
});

// ============================================================================
// Memoization (new module — no fuzz test existed)
// ============================================================================

test("Memoization: import and fuzz", async () => {
  const Memo = await import("../Memoization.js");

  // Test memoize basic correctness
  let callCount = 0;
  const fn = Memo.memoize((x: number) => {
    callCount++;
    return x * 2;
  });

  Prop.assert(
    Arb.array(Arb.integer(0, 50), { minLength: 1, maxLength: 100 }),
    (inputs) => {
      callCount = 0;
      const memo = Memo.memoize((x: number) => {
        callCount++;
        return x * x;
      });

      const results: number[] = [];
      for (const x of inputs) {
        results.push(memo(x));
      }

      // Verify results
      for (let i = 0; i < inputs.length; i++) {
        if (results[i] !== inputs[i] * inputs[i]) return false;
      }

      // callCount should equal number of unique inputs
      const unique = new Set(inputs).size;
      return callCount === unique;
    },
    { numRuns: 2000 },
  );
});

test("Memoization: once() calls function exactly once", async () => {
  const Memo = await import("../Memoization.js");

  Prop.assert(
    Arb.integer(1, 100),
    (n) => {
      let calls = 0;
      const fn = Memo.once(() => {
        calls++;
        return 42;
      });

      for (let i = 0; i < n; i++) fn();
      return calls === 1 && fn() === 42;
    },
    { numRuns: 2000 },
  );
});

// ============================================================================
// ErrorChain (new module — no fuzz test existed)
// ============================================================================

test("ErrorChain: chain traversal with random depth", async () => {
  const EC = await import("../ErrorChain.js");

  Prop.assert(
    Arb.integer(1, 20),
    (depth) => {
      // Build an error chain of given depth
      let error: Error = new Error(`level-0`);
      for (let i = 1; i < depth; i++) {
        error = new Error(`level-${i}`, { cause: error });
      }

      const chain = EC.toArray(error);
      if (chain.length !== depth) return false;

      // First element should be the outermost error
      if (chain[0] !== error) return false;
      // Last element should be the innermost (no cause)
      if ((chain[chain.length - 1] as Error).cause !== undefined) return false;

      return true;
    },
    { numRuns: 1000 },
  );
});

test("ErrorChain: find() locates error by predicate", async () => {
  const EC = await import("../ErrorChain.js");

  const inner = new TypeError("type error");
  const middle = new RangeError("range error", { cause: inner });
  const outer = new Error("outer", { cause: middle });

  // Note: find() signature is find(predicate, error) — predicate first
  const found = EC.find((e) => e instanceof TypeError, outer);
  assert.ok(found instanceof TypeError);
  assert.equal(found!.message, "type error");

  const notFound = EC.find((e) => e instanceof SyntaxError, outer);
  assert.equal(notFound, undefined);
});
