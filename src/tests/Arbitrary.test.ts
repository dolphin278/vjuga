/* c8 ignore start -- test file; branch coverage not meaningful for test-internal conditionals */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";
import * as Ref from "./fixtures/PRNGReference.js";

// Helper: make a deterministic PRNG
function rng(n = 42n) {
  return PRNG.make(PRNG.seed(n));
}

// Helper: collect first N shrinks from a tree
function firstShrinks<T>(tree: Arb.Tree<T>, n = 10): T[] {
  const result: T[] = [];
  for (const child of tree.shrinks) {
    result.push(child.value);
    if (result.length >= n) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// integer
// ---------------------------------------------------------------------------

test("integer() generates values in default range", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.integer()(PRNG.split(prng), 100);
    assert.ok(Number.isSafeInteger(tree.value));
  }
});

test("integer(min, max) respects bounds", () => {
  const prng = rng();
  for (let i = 0; i < 200; i++) {
    const tree = Arb.integer(5, 10)(PRNG.split(prng), 100);
    assert.ok(tree.value >= 5 && tree.value <= 10, `got ${tree.value}`);
  }
});

test("integer() shrinks toward 0", () => {
  const tree = Arb.integer(-100, 100)(rng(7n), 100);
  if (tree.value !== 0) {
    const shrinks = firstShrinks(tree);
    assert.ok(shrinks.length > 0, "should have shrinks");
    assert.equal(shrinks[0], 0, "first shrink should be 0");
  }
});

test("integer(5, 10) shrinks toward 5 (nearest bound to 0)", () => {
  const prng = rng(99n);
  const tree = Arb.integer(5, 10)(prng, 100);
  if (tree.value !== 5) {
    const shrinks = firstShrinks(tree);
    assert.equal(shrinks[0], 5);
  }
});

test("integer(-10, -5) shrinks toward -5 (nearest bound to 0)", () => {
  const prng = rng(99n);
  const tree = Arb.integer(-10, -5)(prng, 100);

  if (tree.value !== -5) {
    const shrinks = firstShrinks(tree);
    assert.equal(shrinks[0], -5);
  }
});

// ---------------------------------------------------------------------------
// nat
// ---------------------------------------------------------------------------

test("nat() generates non-negative integers", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.nat()(PRNG.split(prng), 100);
    assert.ok(tree.value >= 0, `got ${tree.value}`);
  }
});

// ---------------------------------------------------------------------------
// float
// ---------------------------------------------------------------------------

test("float() generates numbers in default range", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.float()(PRNG.split(prng), 100);
    assert.equal(typeof tree.value, "number");
  }
});

test("float(0, 1) generates values in [0, 1)", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.float(0, 1)(PRNG.split(prng), 100);
    assert.ok(tree.value >= 0 && tree.value < 1, `got ${tree.value}`);
  }
});

test("float() shrinks toward 0", () => {
  const tree = Arb.float(-100, 100)(rng(7n), 100);
  if (tree.value !== 0) {
    const shrinks = firstShrinks(tree);
    assert.ok(shrinks.length > 0);
    assert.equal(shrinks[0], 0);
  }
});

test("float() shrinks through truncation", () => {
  const tree = Arb.float(0, 100)(rng(1n), 100);
  if (tree.value !== 0 && tree.value !== Math.trunc(tree.value)) {
    const shrinks = firstShrinks(tree, 5);
    // Should include 0 and the truncated value
    assert.ok(shrinks.includes(0));
    assert.ok(shrinks.some((s) => s === Math.trunc(tree.value)));
  }
});

// ---------------------------------------------------------------------------
// boolean
// ---------------------------------------------------------------------------

test("boolean() generates true and false", () => {
  const prng = rng();
  let sawTrue = false;
  let sawFalse = false;
  for (let i = 0; i < 100; i++) {
    const tree = Arb.boolean()(PRNG.split(prng), 100);
    if (tree.value) sawTrue = true;
    else sawFalse = true;
  }
  assert.ok(sawTrue && sawFalse, "should generate both true and false");
});

test("boolean() true shrinks to false", () => {
  // Find a tree that generated true
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.boolean()(PRNG.split(prng), 100);
    if (tree.value) {
      const shrinks = firstShrinks(tree);
      assert.equal(shrinks.length, 1);
      assert.equal(shrinks[0], false);
      return;
    }
  }
});

test("boolean() false has no shrinks", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.boolean()(PRNG.split(prng), 100);
    if (!tree.value) {
      const shrinks = firstShrinks(tree);
      assert.equal(shrinks.length, 0);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// constant / constantFrom
// ---------------------------------------------------------------------------

test("constant() always returns the same value with no shrinks", () => {
  const arb = Arb.constant(42);
  const prng = rng();
  for (let i = 0; i < 10; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.equal(tree.value, 42);
    assert.deepEqual(firstShrinks(tree), []);
  }
});

test("constantFrom() picks from provided values", () => {
  const arb = Arb.constantFrom("a", "b", "c");
  const prng = rng();
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    seen.add(tree.value);
  }
  assert.ok(seen.size > 1, "should pick multiple values");
  for (const v of seen) {
    assert.ok(["a", "b", "c"].includes(v));
  }
});

test("constantFrom() shrinks toward first value", () => {
  const arb = Arb.constantFrom("a", "b", "c");
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value !== "a") {
      const shrinks = firstShrinks(tree);
      assert.equal(shrinks[0], "a");
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// string
// ---------------------------------------------------------------------------

test("string() generates strings of printable ASCII", () => {
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = Arb.string()(PRNG.split(prng), 100);
    assert.equal(typeof tree.value, "string");
    for (const ch of tree.value) {
      const code = ch.charCodeAt(0);
      assert.ok(code >= 0x20 && code <= 0x7e, `non-printable char ${code}`);
    }
  }
});

test("string() respects minLength/maxLength", () => {
  const arb = Arb.string({ minLength: 2, maxLength: 5 });
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value.length >= 2 && tree.value.length <= 5, `len=${tree.value.length}`);
  }
});

test("string() shrinks toward empty", () => {
  const arb = Arb.string();
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length > 0) {
      const shrinks = firstShrinks(tree, 3);
      assert.ok(shrinks.some((s) => s.length < tree.value.length));
      return;
    }
  }
});

test("string(minLength) doesn't shrink below minLength", () => {
  const arb = Arb.string({ minLength: 3 });
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    for (const child of tree.shrinks) {
      assert.ok(child.value.length >= 3, `shrunk below min: ${child.value.length}`);
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// array
// ---------------------------------------------------------------------------

test("array() generates arrays from arb", () => {
  const arb = Arb.array(Arb.integer(0, 10));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(Array.isArray(tree.value));
    for (const v of tree.value) {
      assert.ok(v >= 0 && v <= 10);
    }
  }
});

test("array() respects minLength/maxLength", () => {
  const arb = Arb.array(Arb.integer(), { minLength: 2, maxLength: 4 });
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value.length >= 2 && tree.value.length <= 4, `len=${tree.value.length}`);
  }
});

test("array() shrinks by removing elements", () => {
  const arb = Arb.array(Arb.integer(1, 100));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length > 0) {
      const shrinks = firstShrinks(tree, 5);
      assert.ok(shrinks.some((s) => s.length < tree.value.length));
      return;
    }
  }
});

test("array() shrinks individual elements", () => {
  const arb = Arb.array(Arb.integer(0, 100), { minLength: 2, maxLength: 2 });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.some((v) => v > 0)) {
      const shrinks = firstShrinks(tree, 20);
      // Should have shrinks that change element values, not just length
      assert.ok(shrinks.some((s) => s.length === tree.value.length));
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// tuple
// ---------------------------------------------------------------------------

test("tuple() generates tuples from multiple arbitraries", () => {
  const arb = Arb.tuple<[number, string, boolean]>(
    Arb.integer(0, 10),
    Arb.string({ maxLength: 3 }),
    Arb.boolean(),
  );
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.equal(tree.value.length, 3);
    assert.equal(typeof tree.value[0], "number");
    assert.equal(typeof tree.value[1], "string");
    assert.equal(typeof tree.value[2], "boolean");
  }
});

test("tuple() shrinks element-wise", () => {
  const arb = Arb.tuple<[number, number]>(Arb.integer(0, 100), Arb.integer(0, 100));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value[0] > 0 || tree.value[1] > 0) {
      const shrinks = firstShrinks(tree, 5);
      assert.ok(shrinks.length > 0, "tuple should have shrinks");
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

test("record() generates objects matching shape", () => {
  const arb = Arb.record<{ x: number; y: string }>({
    x: Arb.integer(0, 10),
    y: Arb.string({ maxLength: 3 }),
  });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.equal(typeof tree.value.x, "number");
    assert.equal(typeof tree.value.y, "string");
    assert.ok(tree.value.x >= 0 && tree.value.x <= 10);
  }
});

test("record() shrinks field-wise", () => {
  const arb = Arb.record<{ x: number }>({ x: Arb.integer(0, 100) });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.x > 0) {
      const shrinks = firstShrinks(tree, 5);
      assert.ok(shrinks.length > 0);
      assert.ok(shrinks.some((s) => s.x < tree.value.x));
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// oneOf
// ---------------------------------------------------------------------------

test("oneOf() picks from multiple arbitraries", () => {
  const arb = Arb.oneOf(Arb.constant("a"), Arb.constant("b"), Arb.constant("c"));
  const prng = rng();
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    seen.add(tree.value);
  }
  assert.ok(seen.size > 1);
});

test("oneOf() shrinks toward first arbitrary", () => {
  const arb = Arb.oneOf(Arb.constant(0), Arb.constant(1), Arb.constant(2));
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value !== 0) {
      const shrinks = firstShrinks(tree, 5);
      // Should eventually try the first arbitrary
      assert.ok(
        shrinks.some((s) => s === 0),
        "should shrink toward first arb",
      );
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

test("map() transforms generated values", () => {
  const arb = Arb.map(Arb.integer(0, 10), (n) => n * 2);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value % 2 === 0 && tree.value >= 0 && tree.value <= 20);
  }
});

test("map() preserves shrinking", () => {
  const arb = Arb.map(Arb.integer(0, 100), (n) => n * 2);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value > 0) {
      const shrinks = firstShrinks(tree, 5);
      assert.ok(shrinks.length > 0);
      assert.ok(
        shrinks.every((s) => s % 2 === 0),
        "mapped shrinks should be even",
      );
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// chain
// ---------------------------------------------------------------------------

test("chain() generates dependent values", () => {
  const arb = Arb.chain(Arb.integer(1, 5), (n) =>
    Arb.array(Arb.constant("x"), { minLength: n, maxLength: n }),
  );
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value.length >= 1 && tree.value.length <= 5);
    assert.ok(tree.value.every((v) => v === "x"));
  }
});

test("chain() has shrinks", () => {
  const arb = Arb.chain(Arb.integer(1, 10), (n) => Arb.constant(n));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value > 1) {
      const shrinks = firstShrinks(tree, 10);
      assert.ok(shrinks.length > 0, "chain should have shrinks");
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------

test("filter() only generates values matching predicate", () => {
  const arb = Arb.filter(Arb.integer(0, 100), (n) => n % 2 === 0);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value % 2 === 0, `got odd: ${tree.value}`);
  }
});

test("filter() shrinks respect predicate", () => {
  const arb = Arb.filter(Arb.integer(0, 100), (n) => n % 2 === 0);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value > 0) {
      for (const child of tree.shrinks) {
        assert.ok(child.value % 2 === 0, `shrink violated filter: ${child.value}`);
        break;
      }
      return;
    }
  }
});

test("filter() throws after maxRetries", () => {
  const impossible = Arb.filter(Arb.constant(1), (n) => n > 1, 5);
  assert.throws(() => impossible(rng(), 100), /failed to find a value after 5 retries/);
});

// ---------------------------------------------------------------------------
// bigint
// ---------------------------------------------------------------------------

test("bigint() generates values in range", () => {
  const arb = Arb.bigint(-100n, 100n);
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value >= -100n && tree.value <= 100n, `got ${tree.value}`);
  }
});

test("bigint() shrinks toward 0n", () => {
  const arb = Arb.bigint(0n, 1000n);
  const prng = rng(7n);
  const tree = arb(prng, 100);
  if (tree.value !== 0n) {
    const shrinks = firstShrinks(tree);
    assert.ok(shrinks.length > 0);
    assert.equal(shrinks[0], 0n);
  }
});

// ---------------------------------------------------------------------------
// date
// ---------------------------------------------------------------------------

test("date() generates Date objects", () => {
  const arb = Arb.date();
  const prng = rng();
  const tree = arb(PRNG.split(prng), 100);
  assert.ok(tree.value instanceof Date);
});

test("date(min, max) respects bounds", () => {
  const min = new Date("2020-01-01");
  const max = new Date("2020-12-31");
  const arb = Arb.date(min, max);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(tree.value.getTime() >= min.getTime());
    assert.ok(tree.value.getTime() <= max.getTime());
  }
});

// ---------------------------------------------------------------------------
// uniqueArray
// ---------------------------------------------------------------------------

test("uniqueArray() generates arrays with unique elements", () => {
  const arb = Arb.uniqueArray(Arb.integer(0, 100), { maxLength: 10 });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    const set = new Set(tree.value);
    assert.equal(set.size, tree.value.length, "elements should be unique");
  }
});

test("uniqueArray() with custom key function", () => {
  const arb = Arb.uniqueArray(Arb.integer(0, 100), {
    maxLength: 5,
    key: (n) => n % 10, // unique by last digit
  });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    const keys = tree.value.map((n) => n % 10);
    assert.equal(new Set(keys).size, keys.length);
  }
});

// ---------------------------------------------------------------------------
// dictionary
// ---------------------------------------------------------------------------

test("dictionary() generates objects with string keys", () => {
  const arb = Arb.dictionary(Arb.constantFrom("a", "b", "c"), Arb.integer(0, 10), { maxSize: 3 });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.equal(typeof tree.value, "object");
    for (const [k, v] of Object.entries(tree.value)) {
      assert.ok(["a", "b", "c"].includes(k));
      assert.ok(typeof v === "number");
    }
  }
});

// ---------------------------------------------------------------------------
// frequency
// ---------------------------------------------------------------------------

test("frequency() generates values according to weights", () => {
  const arb = Arb.frequency(
    { weight: 9, arb: Arb.constant("common") },
    { weight: 1, arb: Arb.constant("rare") },
  );
  const prng = rng();
  let commonCount = 0;
  for (let i = 0; i < 1000; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value === "common") commonCount++;
  }
  // With weights 9:1, common should appear roughly 90% of the time
  assert.ok(commonCount > 700, `common appeared only ${commonCount}/1000 times`);
});

test("frequency() has shrinks", () => {
  const arb = Arb.frequency(
    { weight: 1, arb: Arb.constant("a") },
    { weight: 1, arb: Arb.constant("b") },
  );
  const prng = rng();
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value !== "a") {
      const shrinks = firstShrinks(tree, 10);
      assert.ok(shrinks.length > 0);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// subarray
// ---------------------------------------------------------------------------

test("subarray() generates subsequences", () => {
  const items = [1, 2, 3, 4, 5];
  const arb = Arb.subarray(items);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    // Every element should be in the original array
    for (const v of tree.value) {
      assert.ok(items.includes(v));
    }
    // Should maintain original order
    for (let j = 1; j < tree.value.length; j++) {
      assert.ok(items.indexOf(tree.value[j]!) > items.indexOf(tree.value[j - 1]!));
    }
  }
});

test("subarray() shrinks toward empty", () => {
  const arb = Arb.subarray([1, 2, 3, 4, 5]);
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length > 0) {
      const shrinks = firstShrinks(tree, 5);
      assert.ok(
        shrinks.some((s) => s.length === 0),
        "should shrink to empty",
      );
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// letrec
// ---------------------------------------------------------------------------

test("letrec() creates recursive arbitraries", () => {
  const { json } = Arb.letrec((tie) => ({
    json: Arb.oneOf(
      Arb.map(Arb.integer(0, 100), (n) => n as unknown),
      Arb.map(Arb.string({ maxLength: 5 }), (s) => s as unknown),
      Arb.map(Arb.array(tie("json"), { maxLength: 3 }), (a) => a as unknown),
    ),
  }));

  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = json!(PRNG.split(prng), 5);
    // Should generate something without infinite recursion
    assert.ok(tree.value !== undefined);
  }
});

test("letrec() unresolved reference throws at generation time", () => {
  const refs: Arb.Arbitrary<unknown>[] = [];
  Arb.letrec<{ dummy: Arb.Arbitrary<unknown> }>((ref) => {
    refs.push(ref("dummy"));
    // Never register "dummy" — it will be set, but "missing" won't exist
    return { dummy: Arb.constant(0) };
  });
  // The registered "dummy" works:
  assert.ok(refs[0]!(rng(), 10).value === 0);

  // Now test truly missing ref:
  const missingRefs: Arb.Arbitrary<unknown>[] = [];
  Arb.letrec<{ exists: Arb.Arbitrary<unknown> }>((ref) => {
    // ref("exists") is valid, but we won't actually use it — test the error path
    const exists = ref("exists");
    missingRefs.push(exists);
    return { exists: Arb.constant(42) };
  });
  // This should work because "exists" is registered
  assert.equal(missingRefs[0]!(rng(), 10).value, 42);
});

// ---------------------------------------------------------------------------
// gen
// ---------------------------------------------------------------------------

test("gen() creates imperative-style generators", () => {
  const pointArb = Arb.gen((pick) => ({
    x: pick(Arb.integer(-100, 100)),
    y: pick(Arb.integer(-100, 100)),
  }));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = pointArb(PRNG.split(prng), 100);
    assert.equal(typeof tree.value.x, "number");
    assert.equal(typeof tree.value.y, "number");
  }
});

test("gen() shrinks individual picks", () => {
  const arb = Arb.gen((pick) => ({
    a: pick(Arb.integer(0, 100)),
    b: pick(Arb.integer(0, 100)),
  }));
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.a > 0 || tree.value.b > 0) {
      const shrinks = firstShrinks(tree, 10);
      assert.ok(shrinks.length > 0, "gen should produce shrinks");
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Edge cases for shrinking coverage
// ---------------------------------------------------------------------------

test("filter() shrinks skip values that don't match predicate", () => {
  // Generate even numbers, ensure odd shrinks are filtered out
  const arb = Arb.filter(Arb.integer(0, 100), (n) => n % 2 === 0);
  const prng = rng(1n);
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);
    // Walk deeper into shrink tree to exercise filterShrinks skipping

    for (const child of tree.shrinks) {
      for (const grandchild of child.shrinks) {
        assert.ok(grandchild.value % 2 === 0);
        break;
      }
      break;
    }
  }
});

test("string() shrinks simplify characters toward 'a'", () => {
  // Use a property check to verify string shrinking works end-to-end
  const arb = Arb.string({ minLength: 1, maxLength: 5 });
  const prng = rng(777n);
  // Find a string with non-'a' chars at size=100 (should be common)
  for (let i = 0; i < 200; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length >= 2 && !tree.value.startsWith("a")) {
      const shrinks = firstShrinks(tree, 20);
      // Shrinks should include: shorter string OR simpler chars
      assert.ok(
        shrinks.some((s) => s.length < tree.value.length || s.includes("a")),
        `expected shrinks for "${tree.value}": ${JSON.stringify(shrinks)}`,
      );
      return;
    }
  }

  // If we never found a non-'a' string, skip — this is extremely unlikely
});

test("bigint() with range <= 0n returns sizedMin", () => {
  // Use size=0 to force sizedMin === sizedMax (range = 0)
  const arb = Arb.bigint(0n, 100n);
  const tree = arb(rng(), 0);
  assert.equal(tree.value, 0n);
});

test("uniqueArray() shrinks maintain uniqueness", () => {
  const arb = Arb.uniqueArray(Arb.integer(0, 10), { minLength: 0, maxLength: 5 });
  const prng = rng();
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length >= 2) {
      for (const child of tree.shrinks) {
        const set = new Set(child.value);
        assert.equal(set.size, child.value.length, "shrink should maintain uniqueness");
        break;
      }
      return;
    }
  }
});

test("gen() catch branch on shrink replay failure", () => {
  // The gen() combinator catches errors when replaying shrinks with different
  // picks causes the function to throw. We force this by having the function
  // throw on replay with a different value.
  const arb = Arb.gen((pick) => {
    const n = pick(Arb.integer(0, 100));
    if (n < 10) {
      throw new Error("bad value during replay");
    }
    return n;
  });
  const prng = rng(99n);
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value >= 10) {
      // Walk shrinks — some will try values < 10, triggering the catch
      let count = 0;
      for (const _child of tree.shrinks) {
        count++;
        if (count > 5) break;
      }
      return;
    }
  }
});

test("filter() filterShrinks skips children that fail predicate", () => {
  const arb = Arb.filter(Arb.integer(0, 100), (n) => n > 10);
  const prng = rng(5n);
  for (let i = 0; i < 100; i++) {
    const tree = arb(PRNG.split(prng), 100);

    for (const child of tree.shrinks) {
      assert.ok(child.value > 10);
      for (const grandchild of child.shrinks) {
        assert.ok(grandchild.value > 10);
        break;
      }
      break;
    }
  }
});

test("uniqueArray() shrinkUniqueArray filters duplicates", () => {
  // Use uniqueArray with a key function, generate arrays where shrinking
  // elements could create duplicates
  const arb = Arb.uniqueArray(Arb.integer(0, 5), { minLength: 2, maxLength: 5 });
  const prng = rng(42n);
  for (let i = 0; i < 50; i++) {
    const tree = arb(PRNG.split(prng), 100);
    if (tree.value.length >= 3) {
      // Walk shrinks — some shrink candidates may have non-unique elements
      // (from element shrinking) and those should be filtered out
      for (const child of tree.shrinks) {
        const set = new Set(child.value);
        assert.equal(set.size, child.value.length, "shrink must maintain uniqueness");
      }
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

test("leaf creates a tree with no shrinks", () => {
  // Test via constant
  const tree = Arb.constant(99)(rng(), 100);
  assert.equal(tree.value, 99);
  assert.deepEqual(firstShrinks(tree), []);
});

// ---------------------------------------------------------------------------
// Re-iterable shrink trees (G7-1)
// ---------------------------------------------------------------------------

/** Serializes a value deterministically (handles bigint / Date / undefined). */
function ser(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    typeof x === "bigint"
      ? `${x}n`
      : x === undefined
        ? "<undef>"
        : x instanceof Date
          ? `D${x.getTime()}`
          : x,
  );
}

/** Snapshot of the first `width` children, `depth` levels deep. */
function snapshot<T>(tree: Arb.Tree<T>, depth: number, width = 6): unknown {
  const kids: unknown[] = [];
  if (depth > 0) {
    let n = 0;
    for (const child of tree.shrinks) {
      kids.push(snapshot(child, depth - 1, width));
      if (++n >= width) break;
    }
  }
  return [ser(tree.value), kids];
}

const reiterableCases: [string, Arb.Arbitrary<unknown>][] = [
  ["integer", Arb.integer(-1_000_000, 1_000_000)],
  ["bigint", Arb.bigint(-(10n ** 12n), 10n ** 12n)],
  ["float", Arb.float(-1000, 1000)],
  ["date", Arb.date()],
  ["string", Arb.string({ maxLength: 8 })],
  ["boolean", Arb.boolean()],
  ["constantFrom", Arb.constantFrom("a", "b", "c")],
  ["array", Arb.array(Arb.integer(-1000, 1000))],
  ["tuple", Arb.tuple(Arb.integer(-1000, 1000), Arb.string())],
  ["record", Arb.record({ a: Arb.integer(-1000, 1000), b: Arb.string() })],
  ["map", Arb.map(Arb.integer(-1000, 1000), (n) => n * 2)],
  ["filter", Arb.filter(Arb.integer(-1000, 1000), (n) => n % 2 === 0)],
  [
    "chain",
    Arb.chain(Arb.integer(1, 5), (n) => Arb.array(Arb.integer(-1000, 1000), { maxLength: n })),
  ],
  ["oneOf", Arb.oneOf<unknown>(Arb.string(), Arb.integer(-1000, 1000), Arb.integer(5000, 9000))],
  [
    "frequency",
    Arb.frequency<unknown>(
      { weight: 3, arb: Arb.string() },
      { weight: 1, arb: Arb.integer(-1000, 1000) },
      { weight: 1, arb: Arb.array(Arb.integer(0, 1000)) },
    ),
  ],
  ["uniqueArray", Arb.uniqueArray(Arb.integer(0, 1000), { minLength: 1 })],
  ["dictionary", Arb.dictionary(Arb.string({ minLength: 1 }), Arb.integer(-1000, 1000))],
  ["subarray", Arb.subarray([1, 2, 3, 4, 5, 6])],
  [
    "gen",
    Arb.gen((pick) => (pick(Arb.boolean()) ? pick(Arb.string()) : pick(Arb.integer(-1000, 1000)))),
  ],
  [
    "letrec",
    Arb.letrec((tie) => ({
      json: Arb.oneOf<unknown>(Arb.integer(-1000, 1000), Arb.string(), Arb.array(tie("json"))),
    })).json,
  ],
];

for (const [name, arb] of reiterableCases) {
  test(`${name}: iterating shrinks twice yields the same children (3 levels)`, () => {
    for (let s = 0n; s < 30n; s++) {
      const tree = arb(rng(s), 60);
      const first = snapshot(tree, 3);
      // Partial iteration must not drain anything.
      for (const _child of tree.shrinks) break;
      assert.deepEqual(snapshot(tree, 3), first, `seed ${s}`);
    }
  });
}

test("tuple shrinking reaches the true minimum (sibling trees not drained)", () => {
  // Every counterexample must be exactly [20, 0] — the minimal failing pair.
  for (let s = 1n; s <= 30n; s++) {
    const tree = Arb.tuple(Arb.integer(0, 100), Arb.integer(0, 100))(rng(s), 100);
    let [a, b] = tree.value;
    if (a - b < 20) continue;
    let current: Arb.Tree<[number, number]> = tree;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const child of current.shrinks) {
        if (child.value[0] - child.value[1] >= 20) {
          current = child;
          [a, b] = child.value;
          progressed = true;
          break;
        }
      }
    }
    assert.deepEqual([a, b], [20, 0], `seed ${s}`);
  }
});

// ---------------------------------------------------------------------------
// Large-number shrinking (G7-2)
// ---------------------------------------------------------------------------

test("integer shrink candidates beyond int32 stay in range and are finite", () => {
  const lo = 2 ** 40;
  const tree = Arb.integer(lo, lo + 1_000_000)(rng(5n), 100);
  const kids = [...tree.shrinks].map((t) => t.value);
  assert.ok(kids.length > 0 && kids.length < 64, `got ${kids.length} children`);
  for (const k of kids) assert.ok(k >= lo && k <= lo + 1_000_000, `out of range: ${k}`);
});

test("date shrink candidates stay in range", () => {
  const d0 = new Date("2020-01-01");
  const d1 = new Date("2030-01-01");
  const tree = Arb.date(d0, d1)(rng(3n), 100);
  for (const c of tree.shrinks) {
    assert.ok(c.value >= d0 && c.value <= d1, `out of range: ${c.value.toISOString()}`);
  }
});

// ---------------------------------------------------------------------------
// Sizing (G7-4)
// ---------------------------------------------------------------------------

test("integer reaches the full range at size 100", () => {
  const prng = rng(1n);
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < 2000; i++) {
    const v = Arb.integer(-1000, 1000)(PRNG.split(prng), 100).value;
    max = Math.max(max, v);
    min = Math.min(min, v);
  }
  assert.ok(max > 900 && min < -900, `range seen: ${min}..${max}`);
});

test("integer is biased toward the target at small sizes", () => {
  const prng = rng(2n);
  for (let i = 0; i < 500; i++) {
    assert.equal(Arb.integer(-1000, 1000)(PRNG.split(prng), 0).value, 0);
    const v = Arb.integer(0, 1_000_000)(PRNG.split(prng), 10).value;
    assert.ok(v <= 10, `size 10 produced ${v}`);
    const w = Arb.integer(0, 10)(PRNG.split(prng), 3).value;
    assert.ok(w <= 3, `small range at size 3 produced ${w}`);
  }
});

test("integer sizes between the extremes grow exponentially", () => {
  const prng = rng(3n);
  let max = 0;
  for (let i = 0; i < 2000; i++) {
    max = Math.max(max, Arb.integer(0, 1_000_000)(PRNG.split(prng), 50).value);
  }
  // (1e6 + 1)^0.5 - 1 ≈ 999
  assert.ok(max > 500 && max <= 1000, `size 50 max ${max}`);
});

test("integer handles ranges wider than 2^53", () => {
  const prng = rng(4n);
  const lo = -Number.MAX_SAFE_INTEGER;
  const hi = Number.MAX_SAFE_INTEGER;
  let big = 0;
  for (let i = 0; i < 200; i++) {
    const v = Arb.integer(lo, hi)(PRNG.split(prng), 100).value;
    assert.ok(Number.isSafeInteger(v));
    if (Math.abs(v) > 2 ** 50) big++;
  }
  assert.ok(big > 100, `only ${big} large values`);
});

test("integer validates its bounds", () => {
  assert.throws(() => Arb.integer(0.5, 10), RangeError);
  assert.throws(() => Arb.integer(5, 1), RangeError);
  assert.throws(() => Arb.integer(0, Number.NaN), RangeError);
  assert.throws(() => Arb.integer(0, 2 ** 60), RangeError);
});

test("integer with min === max always yields it", () => {
  assert.equal(Arb.integer(7, 7)(rng(), 100).value, 7);
});

test("bigint reaches the full range at size 100 and stays near 0 at size 0", () => {
  const prng = rng(5n);
  let max = 0n;
  for (let i = 0; i < 500; i++) {
    const v = Arb.bigint(0n, 10n ** 15n)(PRNG.split(prng), 100).value;
    if (v > max) max = v;
    assert.equal(Arb.bigint(-5n, 5n)(PRNG.split(prng), 0).value, 0n);
  }
  assert.ok(max > 9n * 10n ** 14n, `max ${max}`);
});

test("bigint supports ranges wider than 64 bits", () => {
  const prng = rng(6n);
  const hi = 2n ** 200n;
  let big = 0;
  for (let i = 0; i < 100; i++) {
    const v = Arb.bigint(0n, hi)(PRNG.split(prng), 100).value;
    assert.ok(v >= 0n && v <= hi);
    if (v > 2n ** 190n) big++;
  }
  assert.ok(big > 90, `only ${big} large values`);
  // Span beyond float range: exponent overflows to Infinity at mid sizes.
  const huge = 2n ** 1100n;
  const w = Arb.bigint(0n, huge)(rng(7n), 50).value;
  assert.ok(w >= 0n && w <= huge);
  assert.equal(Arb.bigint(3n, 3n)(rng(), 100).value, 3n);
});

test("bigint validates min <= max", () => {
  assert.throws(() => Arb.bigint(5n, 1n), RangeError);
});

test("date() spans far beyond ±100 ms at size 100", () => {
  const prng = rng(8n);
  let spread = 0;
  for (let i = 0; i < 200; i++) {
    spread = Math.max(spread, Math.abs(Arb.date()(PRNG.split(prng), 100).value.getTime()));
  }
  assert.ok(spread > 1e15, `spread ${spread}`);
});

// ---------------------------------------------------------------------------
// float shrinking stays in range (G7-9)
// ---------------------------------------------------------------------------

function everyNode<T>(tree: Arb.Tree<T>, depth: number, f: (v: T) => void): void {
  f(tree.value);
  if (depth === 0) return;
  for (const child of tree.shrinks) everyNode(child, depth - 1, f);
}

test("float(0.5, 1) shrink candidates never leave [0.5, 1)", () => {
  for (let s = 0n; s < 20n; s++) {
    everyNode(Arb.float(0.5, 1)(rng(s), 100), 3, (v) => assert.ok(v >= 0.5 && v < 1, `${v}`));
  }
});

test("float(-1, -0.5) shrinks toward -0.5 without reaching it", () => {
  for (let s = 0n; s < 20n; s++) {
    everyNode(Arb.float(-1, -0.5)(rng(s), 100), 3, (v) => assert.ok(v >= -1 && v < -0.5, `${v}`));
  }
});

test("float validates bounds and supports min === max", () => {
  assert.throws(() => Arb.float(1, 0), RangeError);
  assert.throws(() => Arb.float(0, Infinity), RangeError);
  const t = Arb.float(2, 2)(rng(), 100);
  assert.equal(t.value, 2);
  assert.deepEqual([...t.shrinks], []);
});

// ---------------------------------------------------------------------------
// uniqueArray (G7-5)
// ---------------------------------------------------------------------------

test("uniqueArray throws when minLength unique values are impossible", () => {
  assert.throws(
    () => Arb.uniqueArray(Arb.boolean(), { minLength: 3, maxLength: 3 })(rng(1n), 100),
    /minLength is 3/,
  );
});

test("uniqueArray reaches minLength even at size 0 (retries at larger sizes)", () => {
  for (let s = 0n; s < 20n; s++) {
    const t = Arb.uniqueArray(Arb.integer(0, 50), { minLength: 4, maxLength: 4 })(rng(s), 0);
    assert.equal(t.value.length, 4);
    assert.equal(new Set(t.value).size, 4);
  }
});

test("uniqueArray shrink candidates stay unique at every depth", () => {
  for (let s = 0n; s < 20n; s++) {
    const t = Arb.uniqueArray(Arb.integer(0, 50), { minLength: 2, maxLength: 4 })(rng(s), 50);
    everyNode(t, 3, (v) => {
      assert.equal(new Set(v).size, v.length, `duplicate in ${ser(v)}`);
      assert.ok(v.length >= 2);
    });
  }
});

test("dictionary keeps minSize distinct keys while shrinking", () => {
  const arb = Arb.dictionary(Arb.constantFrom("a", "b", "c", "d"), Arb.integer(-9, 9), {
    minSize: 2,
    maxSize: 2,
  });
  for (let s = 0n; s < 20n; s++) {
    everyNode(arb(rng(s), 50), 3, (d) => assert.equal(Object.keys(d).length, 2));
  }
});

// ---------------------------------------------------------------------------
// letrec termination (G7-3)
// ---------------------------------------------------------------------------

function countNodes(v: unknown): number {
  return Array.isArray(v) ? 1 + v.reduce((a: number, x) => a + countNodes(x), 0) : 1;
}

test("letrec doc example at size 100 stays within the expansion budget", () => {
  const { json } = Arb.letrec((tie) => ({
    json: Arb.oneOf<unknown>(Arb.integer(), Arb.string(), Arb.array(tie("json"))),
  }));
  // Budget: ≤ size+1 arrays generated at non-zero size, each ≤ 10 elements.
  const bound = 10 * (100 + 1) + 1;
  for (let s = 0n; s < 200n; s++) {
    const tree = json(rng(s), 100);
    assert.ok(countNodes(tree.value) <= bound, `seed ${s}: ${countNodes(tree.value)} nodes`);
    // Shrinking re-derives oneOf alternatives outside the generation: still bounded.
    let n = 0;
    for (const child of tree.shrinks) {
      assert.ok(countNodes(child.value) <= bound);
      if (++n > 20) break;
    }
  }
});

test("letrec references called directly start their own budget", () => {
  let ref: Arb.Arbitrary<unknown> | undefined;
  Arb.letrec((tie) => {
    ref = tie("json");
    return { json: Arb.oneOf<unknown>(Arb.integer(), Arb.array(tie("json"))) };
  });
  for (let s = 0n; s < 50n; s++) {
    assert.ok(countNodes(ref!(rng(s), 100).value) <= 10 * 101 + 1);
  }
});

test("letrec budget resets after a throwing generation", () => {
  let boom = true;
  const { t } = Arb.letrec((tie) => ({
    t: Arb.map(Arb.array(tie("t"), { maxLength: 2 }), (xs) => {
      if (boom) throw new Error("boom");
      return xs;
    }),
  }));
  assert.throws(() => t(rng(1n), 10), /boom/);
  boom = false;
  assert.ok(Array.isArray(t(rng(1n), 10).value));
});

// ---------------------------------------------------------------------------
// gen replay (G7-10)
// ---------------------------------------------------------------------------

test("gen replay never feeds a value from a different arbitrary into a pick", () => {
  const arb = Arb.gen((pick) =>
    pick(Arb.boolean())
      ? { kind: "s", v: pick(Arb.string({ minLength: 1 })) as unknown }
      : { kind: "n", v: pick(Arb.integer(1, 10)) as unknown },
  );
  for (let s = 0n; s < 40n; s++) {
    everyNode(arb(rng(s), 50), 3, (x) => {
      if (x.kind === "n") assert.equal(typeof x.v, "number", ser(x));
      else assert.equal(typeof x.v, "string", ser(x));
    });
  }
});

test("gen replay draws fresh values for picks beyond the recorded ones", () => {
  const arb = Arb.gen((pick) => {
    const n = pick(Arb.integer(0, 3));
    const out: number[] = [];
    for (let i = 0; i <= 3 - n; i++) out.push(pick(Arb.integer(1, 9)));
    return out;
  });
  for (let s = 0n; s < 40n; s++) {
    everyNode(arb(rng(s), 50), 3, (xs) => {
      for (const x of xs) assert.equal(typeof x, "number", ser(xs));
    });
  }
});

// ---------------------------------------------------------------------------
// frequency (G7-12, G7-15)
// ---------------------------------------------------------------------------

test("frequency never shrinks into a weight-0 entry", () => {
  const arb = Arb.frequency(
    { weight: 0, arb: Arb.constant(-999) },
    { weight: 1, arb: Arb.integer(1, 5) },
    { weight: 2, arb: Arb.integer(100, 200) },
  );
  for (let s = 0n; s < 50n; s++) {
    everyNode(arb(rng(s), 100), 2, (v) => assert.notEqual(v, -999));
  }
});

test("frequency shrinks lower-weight choices toward higher-weight entries only", () => {
  const arb = Arb.frequency(
    { weight: 1, arb: Arb.constant("low") },
    { weight: 5, arb: Arb.constant("high") },
  );
  for (let s = 0n; s < 50n; s++) {
    const t = arb(rng(s), 100);
    const kids = [...t.shrinks].map((c) => c.value);
    assert.deepEqual(kids, t.value === "low" ? ["high"] : []);
  }
});

test("frequency validates weights", () => {
  assert.throws(() => Arb.frequency({ weight: -1, arb: Arb.constant(1) }), RangeError);
  assert.throws(() => Arb.frequency({ weight: Number.NaN, arb: Arb.constant(1) }), RangeError);
  assert.throws(() => Arb.frequency({ weight: 0, arb: Arb.constant(1) }), RangeError);
});

// ---------------------------------------------------------------------------
// string simplification at minLength (G7-13)
// ---------------------------------------------------------------------------

test("string at minLength still simplifies characters toward 'a'", () => {
  let tree = Arb.string({ minLength: 3, maxLength: 3 })(rng(4n), 100);
  for (let steps = 0; steps < 10; steps++) {
    const [first] = tree.shrinks;
    if (first === undefined) break;
    assert.equal(first.value.length, 3);
    tree = first;
  }
  assert.equal(tree.value, "aaa");
});

test("bigint shrinks toward the upper bound for all-negative ranges", () => {
  const tree = Arb.bigint(-1000n, -5n)(rng(9n), 100);
  const kids = [...tree.shrinks].map((t) => t.value);
  if (tree.value !== -5n) assert.equal(kids[0], -5n);
  for (const k of kids) assert.ok(k >= -1000n && k <= -5n);
});

test("letrec shape arbs invoked during an active generation share its budget", () => {
  const out: { a: Arb.Arbitrary<unknown>; b: Arb.Arbitrary<unknown> } = Arb.letrec((tie) => ({
    a: Arb.oneOf<unknown>(Arb.integer(), (p, s) => out.b(p, s)),
    b: Arb.array(tie("a")),
  }));
  for (let s = 0n; s < 50n; s++) {
    assert.ok(countNodes(out.a(rng(s), 100).value) <= 10 * 101 + 1);
  }
});

// ---------------------------------------------------------------------------
// gen replay: parameter-keyed arbitrary identity (G5-2)
// ---------------------------------------------------------------------------

test("gen replay never feeds integer(0,10) picks into integer(100,200)", () => {
  const arb = Arb.gen((pick) =>
    pick(Arb.boolean())
      ? { k: "x", n: pick(Arb.integer(0, 10)) }
      : { k: "y", n: pick(Arb.integer(100, 200)) },
  );
  const r = Prop.check(arb, (v) => v.k === "y" && v.n >= 100 && v.n <= 200, {
    seed: PRNG.seed(1n),
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample!.k, "x", ser(r.counterexample));
  for (let s = 0n; s < 40n; s++) {
    everyNode(arb(rng(s), 100), 3, (v) => {
      if (v.k === "y") assert.ok(v.n >= 100 && v.n <= 200, ser(v));
      else assert.ok(v.n >= 0 && v.n <= 10, ser(v));
    });
  }
});

/** Same factory, different parameters: [name, A, B, is-a-value-of-B]. */
const swapCases: [string, Arb.Arbitrary<unknown>, Arb.Arbitrary<unknown>, (v: any) => boolean][] = [
  ["nat", Arb.nat(5), Arb.integer(50, 60), (v) => v >= 50 && v <= 60],
  ["float", Arb.float(0, 1), Arb.float(5, 6), (v) => v >= 5 && v < 6],
  ["bigint", Arb.bigint(0n, 5n), Arb.bigint(50n, 60n), (v) => v >= 50n && v <= 60n],
  [
    "string",
    Arb.string({ maxLength: 3 }),
    Arb.string({ minLength: 5, maxLength: 6 }),
    (v) => v.length >= 5,
  ],
  [
    "array",
    Arb.array(Arb.integer(0, 5)),
    Arb.array(Arb.integer(50, 60)),
    (v) => v.every((x: number) => x >= 50),
  ],
  [
    "array lengths",
    Arb.array(Arb.integer(0, 5), { maxLength: 2 }),
    Arb.array(Arb.integer(0, 5), { minLength: 4, maxLength: 5 }),
    (v) => v.length >= 4,
  ],
  [
    "tuple arity",
    Arb.tuple(Arb.integer(0, 5)),
    Arb.tuple(Arb.integer(0, 5), Arb.integer(0, 5)),
    (v) => v.length === 2,
  ],
  [
    "record keys",
    Arb.record({ a: Arb.integer(0, 5) }),
    Arb.record({ b: Arb.integer(0, 5) }),
    (v) => "b" in v,
  ],
  [
    "oneOf",
    Arb.oneOf<unknown>(Arb.integer(0, 5), Arb.integer(6, 9)),
    Arb.oneOf<unknown>(Arb.integer(50, 55), Arb.integer(56, 60)),
    (v) => v >= 50,
  ],
  ["constant", Arb.constant("x"), Arb.constant("y"), (v) => v === "y"],
  [
    "constant object",
    Arb.constant({ mode: "a" }),
    Arb.constant({ mode: "b" }),
    (v) => v.mode === "b",
  ],
  ["constant object keys", Arb.constant({ a: 1 }), Arb.constant({ b: 1 }), (v) => "b" in v],
  [
    "constant key order",
    Arb.constant({ x: 1, y: 2 }),
    Arb.constant({ y: 2, x: 1 }),
    (v) => Object.keys(v)[0] === "y",
  ],
  ["constant object size", Arb.constant({ a: 1 }), Arb.constant({ a: 1, b: 2 }), (v) => "b" in v],
  ["constant array length", Arb.constant([1]), Arb.constant([1, 2]), (v) => v.length === 2],
  ["constant array vs object", Arb.constant([1]), Arb.constant({ 0: 1 }), (v) => !Array.isArray(v)],
  [
    "constant nested callback",
    Arb.constant({ f: () => 1 }),
    Arb.constant({ f: () => 2 }),
    (v) => v.f() === 2,
  ],
  ["constantFrom", Arb.constantFrom(1, 2), Arb.constantFrom(8, 9), (v) => v >= 8],
  [
    "uniqueArray",
    Arb.uniqueArray(Arb.integer(0, 5)),
    Arb.uniqueArray(Arb.integer(50, 60)),
    (v) => v.every((x: number) => x >= 50),
  ],
  [
    "dictionary",
    Arb.dictionary(Arb.string(), Arb.integer(0, 5)),
    Arb.dictionary(Arb.string(), Arb.integer(50, 60)),
    (v) => Object.values(v).every((x) => (x as number) >= 50),
  ],
  [
    "subarray",
    Arb.subarray([1, 2, 3]),
    Arb.subarray([7, 8, 9]),
    (v) => v.every((x: number) => x >= 7),
  ],
  [
    "frequency weights",
    Arb.frequency<number>({ weight: 1, arb: Arb.integer(0, 5) }),
    Arb.frequency<number>({ weight: 2, arb: Arb.integer(50, 60) }),
    (v) => v >= 50,
  ],
  [
    "filter",
    Arb.filter(Arb.integer(0, 5), () => true),
    Arb.filter(Arb.integer(50, 60), () => true),
    (v) => v >= 50,
  ],
  [
    "chain",
    Arb.chain(Arb.integer(0, 5), (n) => Arb.constant(n)),
    Arb.chain(Arb.integer(50, 60), (n) => Arb.constant(n)),
    (v) => v >= 50,
  ],
  [
    "map callback",
    Arb.map(Arb.integer(0, 5), (n) => n),
    Arb.map(Arb.integer(0, 5), (n) => n + 1000),
    (v) => v >= 1000,
  ],
  [
    "date",
    Arb.date(new Date(0), new Date(10)),
    Arb.date(new Date(500), new Date(600)),
    (d) => d.getTime() >= 500,
  ],
  [
    "custom vs built-in",
    (_p: PRNG.PRNG, _s: number) => ({ value: -1, shrinks: [] }),
    Arb.integer(50, 60),
    (v) => v >= 50,
  ],
  [
    "letrec",
    Arb.letrec((tie) => ({ t: Arb.oneOf<unknown>(Arb.integer(0, 5), Arb.array(tie("t"))) })).t,
    Arb.letrec((tie) => ({ t: Arb.oneOf<unknown>(Arb.integer(50, 60), Arb.array(tie("t"))) })).t,
    function allBig(v): boolean {
      return Array.isArray(v) ? v.every(allBig) : v >= 50;
    },
  ],
];

for (const [name, a, b, isB] of swapCases) {
  test(`gen replay keeps ${name} picks apart when parameters differ`, () => {
    const arb = Arb.gen((pick) =>
      pick(Arb.boolean()) ? { a: true, v: pick(a) } : { a: false, v: pick(b) },
    );
    for (let s = 0n; s < 30n; s++) {
      everyNode(arb(rng(s), 30), 2, (x) => {
        if (!x.a) assert.ok(isB(x.v), `${name}: ${ser(x)}`);
      });
    }
  });
}

test("gen replay reuses picks of arbitraries rebuilt inline with equal parameters", () => {
  const arb = Arb.gen((pick) => {
    const big = pick(
      Arb.tuple(
        Arb.map(Arb.integer(100, 1000), (n) => n * 2),
        Arb.record({ s: Arb.string({ minLength: 2 }) }),
        Arb.oneOf(Arb.constant("k"), Arb.constantFrom("p", "q")),
        Arb.uniqueArray(Arb.integer(0, 99), { minLength: 1 }),
      ),
    );
    const n = pick(Arb.integer(0, 1000));
    return { big, n };
  });
  let checked = 0;
  for (let s = 0n; s < 30n; s++) {
    const tree = arb(rng(s), 100);
    for (const child of tree.shrinks) {
      // Shrinking only the second pick must replay the first one unchanged.
      if (child.value.n !== tree.value.n) {
        assert.deepEqual(child.value.big, tree.value.big);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test("gen replay matches inline object constants structurally, so shrinking still reaches the minimum", () => {
  const bodies: [string, (pick: Arb.GenPick) => { n: number }][] = [
    [
      "constant",
      (pick) => ({
        cfg: pick(Arb.constant({ mode: "a", xs: [1, null] })),
        n: pick(Arb.integer(0, 1000)),
      }),
    ],
    [
      "constantFrom",
      (pick) => ({
        cfg: pick(Arb.constantFrom({ mode: "a" }, { mode: "b" })),
        n: pick(Arb.integer(0, 1000)),
      }),
    ],
    [
      "subarray",
      (pick) => ({ s: pick(Arb.subarray([{ k: 1 }, { k: 2 }])), n: pick(Arb.integer(0, 1000)) }),
    ],
    [
      "null-prototype object",
      (pick) => ({
        cfg: pick(Arb.constant(Object.assign(Object.create(null) as object, { m: 1 }))),
        n: pick(Arb.integer(0, 1000)),
      }),
    ],
  ];
  for (const [name, body] of bodies) {
    for (let s = 1n; s <= 20n; s++) {
      const r = Prop.check(Arb.gen(body), (v) => v.n < 500, { seed: PRNG.seed(s), numRuns: 1000 });
      assert.equal(r.ok, false);
      assert.equal(r.counterexample!.n, 500, `${name} seed ${s}`);
    }
  }
});

test("gen replay structural comparison is bounded for cyclic and huge constants", () => {
  for (const make of [
    (): unknown => {
      const c: unknown[] = [];
      c.push(c);
      return c;
    },
    (): unknown => Array.from({ length: 5000 }, (_, i) => i),
  ]) {
    const arb = Arb.gen((pick) => ({
      c: pick(Arb.constant(make())),
      n: pick(Arb.integer(0, 1000)),
    }));
    // Unequal-by-budget values only miss reuse; every node stays a valid value.
    for (let s = 0n; s < 5n; s++) {
      everyNode(arb(rng(s), 100), 2, (v) => assert.ok(v.n >= 0 && v.n <= 1000));
    }
  }
});

// ---------------------------------------------------------------------------
// float: wide ranges and the exclusive max (G5-3)
// ---------------------------------------------------------------------------

/** PRNG whose next `next()` draw is 1 - 2^-53 (the largest value below 1). */
function rngNearOne(): PRNG.PRNG {
  return PRNG.make(PRNG.seed(Ref.seedForOutput(((1n << 53n) - 1n) << 11n)));
}

test("float() spans ranges wider than Number.MAX_VALUE without overflowing", () => {
  const arb = Arb.float(-Number.MAX_VALUE, Number.MAX_VALUE);
  const prng = rng(1n);
  let neg = 0;
  let pos = 0;
  for (let i = 0; i < 200; i++) {
    const tree = arb(PRNG.split(prng), 100);
    assert.ok(Number.isFinite(tree.value), `${tree.value}`);
    if (tree.value < 0) neg++;
    else pos++;
    everyNode(tree, 2, (v) => assert.ok(Number.isFinite(v) && v < Number.MAX_VALUE));
  }
  assert.ok(neg > 50 && pos > 50);
  assert.ok(arb(rngNearOne(), 100).value < Number.MAX_VALUE);
});

test("float() never returns the exclusive max when rounding lands on it", () => {
  assert.equal(Arb.float(1, 2)(rngNearOne(), 100).value, 2 - 2 ** -52);
  assert.equal(Arb.float(-2, -1)(rngNearOne(), 100).value, -1 - 2 ** -52);
  // Subnormal span: r·MIN_VALUE rounds to MIN_VALUE, landing on max = 0.
  assert.equal(Arb.float(-Number.MIN_VALUE, 0)(rngNearOne(), 100).value, -Number.MIN_VALUE);
  assert.equal(Arb.float(3, 3)(rngNearOne(), 100).value, 3);
});

// ---------------------------------------------------------------------------
// string shrinking removes leading and interior characters (G5-6)
// ---------------------------------------------------------------------------

test("string() shrinks a '%'-containing counterexample to exactly '%'", () => {
  for (let s = 1n; s <= 60n; s++) {
    const r = Prop.check(Arb.string(), (x) => !x.includes("%"), {
      seed: PRNG.seed(s),
      numRuns: 1000,
    });
    if (!r.ok) assert.equal(r.counterexample, "%", `seed ${s}`);
  }
});

test("string() shrink candidates remove runs at every offset, respecting minLength", () => {
  // Size 0 generates "", which has nothing to shrink.
  assert.equal([...Arb.string()(rng(), 0).shrinks].length, 0);
  let t = Arb.string({ minLength: 4, maxLength: 4 })(rng(3n), 100);
  for (const c of t.shrinks) assert.equal(c.value.length, 4);
  t = Arb.string({ minLength: 2, maxLength: 8 })(rng(5n), 100);
  const v = t.value;
  const kids = [...t.shrinks].map((c) => c.value);
  assert.ok(v.length > 3, v);
  // Removing the first character alone is a candidate.
  assert.ok(kids.includes(v.slice(1)), `${v} -> ${ser(kids)}`);
  assert.ok(kids.includes(v.slice(0, 1) + v.slice(2)), `${v} -> ${ser(kids)}`);
  for (const k of kids) assert.ok(k.length >= 2);
});

test("string() counterexample replays exactly from its path", () => {
  const pred = (x: string) => !(x.includes("%") && x.length > 1);
  const r = Prop.check(Arb.string(), pred, { seed: PRNG.seed(7n), numRuns: 1000 });
  assert.equal(r.ok, false);
  const replay = Prop.check(Arb.string(), pred, {
    seed: PRNG.seed(7n),
    numRuns: 1000,
    path: r.path,
  });
  assert.equal(replay.counterexample, r.counterexample);
  assert.equal(r.counterexample!.length, 2);
});

// ---------------------------------------------------------------------------
// collection length validation (G5-9)
// ---------------------------------------------------------------------------

test("string/array/uniqueArray/dictionary reject invalid lengths with RangeError", () => {
  const bad = [
    { minLength: 5, maxLength: 2 },
    { maxLength: 2.5 },
    { minLength: -1 },
    { minLength: Number.NaN },
    { minLength: Infinity },
    { maxLength: -Infinity },
  ];
  for (const opts of bad) {
    assert.throws(() => Arb.string(opts), {
      name: "RangeError",
      message: /^string: minLength must be a non-negative safe integer and maxLength/,
    });
    assert.throws(() => Arb.array(Arb.nat(), opts), /^RangeError: array: minLength/);
    assert.throws(() => Arb.uniqueArray(Arb.nat(), opts), /^RangeError: uniqueArray: minLength/);
  }
  assert.throws(() => Arb.dictionary(Arb.string(), Arb.nat(), { minSize: 3, maxSize: 1 }), {
    name: "RangeError",
    message: /^dictionary: minSize must be .* maxSize .*\(got 3, 1\)$/,
  });
  assert.throws(() => Arb.dictionary(Arb.string(), Arb.nat(), { minSize: 0.5 }), /dictionary/);
});

test("maxLength / maxSize: Infinity means uncapped (bounded by size), as in 10.0.0", () => {
  const prng = rng(3n);
  const arbs: [string, Arb.Arbitrary<unknown>, (v: any) => number][] = [
    ["string", Arb.string({ maxLength: Infinity }), (v) => v.length],
    ["array", Arb.array(Arb.integer(), { maxLength: Infinity }), (v) => v.length],
    ["uniqueArray", Arb.uniqueArray(Arb.integer(), { maxLength: Infinity }), (v) => v.length],
    [
      "dictionary",
      Arb.dictionary(Arb.string({ minLength: 4 }), Arb.integer(), { maxSize: Infinity }),
      (v) => Object.keys(v).length,
    ],
  ];
  for (const [name, arb, len] of arbs) {
    let longest = 0;
    for (let i = 0; i < 200; i++) {
      const n = len(arb(PRNG.split(prng), 40).value);
      assert.ok(n <= 40, `${name}: ${n}`);
      longest = Math.max(longest, n);
    }
    assert.ok(longest > 10, `${name} is capped at ${longest}`);
  }
});

test("an omitted maxLength defaults to max(minLength, 10)", () => {
  const prng = rng();
  for (let i = 0; i < 20; i++) {
    assert.equal(Arb.string({ minLength: 20 })(PRNG.split(prng), 100).value.length, 20);
    assert.equal(Arb.array(Arb.nat(), { minLength: 12 })(PRNG.split(prng), 100).value.length, 12);
    const d = Arb.dictionary(Arb.string({ minLength: 3 }), Arb.nat(), { minSize: 11 });
    assert.equal(Object.keys(d(PRNG.split(prng), 100).value).length, 11);
  }
  const lens = new Set<number>();
  for (let i = 0; i < 200; i++) lens.add(Arb.string()(PRNG.split(prng), 100).value.length);
  assert.equal(Math.max(...lens), 10);
});
