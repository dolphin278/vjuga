import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as RadixTree from "../RadixTree.js";

test("make() creates an empty tree", () => {
  const tree = RadixTree.make<number>();
  assert.equal(RadixTree.size(tree), 0);
});

test("insert/lookup basic round-trip", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "hello", 1);
  assert.equal(RadixTree.lookup(tree, "hello"), 1);
});

test("lookup returns undefined for missing key", () => {
  const tree = RadixTree.make<number>();
  assert.equal(RadixTree.lookup(tree, "missing"), undefined);
});

test("lookup returns undefined for missing key in non-empty tree", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abc", 1);
  assert.equal(RadixTree.lookup(tree, "xyz"), undefined);
});

test("has() returns correct presence", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "key", 42);
  assert.equal(RadixTree.has(tree, "key"), true);
  assert.equal(RadixTree.has(tree, "other"), false);
});

test("size() tracks entries correctly", () => {
  const tree = RadixTree.make<number>();
  assert.equal(RadixTree.size(tree), 0);
  RadixTree.insert(tree, "a", 1);
  assert.equal(RadixTree.size(tree), 1);
  RadixTree.insert(tree, "b", 2);
  assert.equal(RadixTree.size(tree), 2);
  RadixTree.remove(tree, "a");
  assert.equal(RadixTree.size(tree), 1);
});

test("insert overwrites existing key value", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "key", 1);
  RadixTree.insert(tree, "key", 99);
  assert.equal(RadixTree.lookup(tree, "key"), 99);
  assert.equal(RadixTree.size(tree), 1);
});

test("insert with shared prefixes — split node", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "team", 2);
  assert.equal(RadixTree.lookup(tree, "test"), 1);
  assert.equal(RadixTree.lookup(tree, "team"), 2);
  assert.equal(RadixTree.size(tree), 2);
});

test("insert where key is a prefix of existing key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "testing", 1);
  RadixTree.insert(tree, "test", 2);
  assert.equal(RadixTree.lookup(tree, "testing"), 1);
  assert.equal(RadixTree.lookup(tree, "test"), 2);
  assert.equal(RadixTree.size(tree), 2);
});

test("insert where existing key is a prefix of new key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "testing", 2);
  assert.equal(RadixTree.lookup(tree, "test"), 1);
  assert.equal(RadixTree.lookup(tree, "testing"), 2);
});

test("insert empty string key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "", 42);
  assert.equal(RadixTree.lookup(tree, ""), 42);
  assert.equal(RadixTree.size(tree), 1);
});

test("insert overwrite empty string key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "", 1);
  RadixTree.insert(tree, "", 2);
  assert.equal(RadixTree.lookup(tree, ""), 2);
  assert.equal(RadixTree.size(tree), 1);
});

test("insert many keys with common prefixes", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "romane", 1);
  RadixTree.insert(tree, "romanus", 2);
  RadixTree.insert(tree, "romulus", 3);
  RadixTree.insert(tree, "rubens", 4);
  RadixTree.insert(tree, "ruber", 5);
  RadixTree.insert(tree, "rubicon", 6);
  RadixTree.insert(tree, "rubicundus", 7);

  assert.equal(RadixTree.lookup(tree, "romane"), 1);
  assert.equal(RadixTree.lookup(tree, "romanus"), 2);
  assert.equal(RadixTree.lookup(tree, "romulus"), 3);
  assert.equal(RadixTree.lookup(tree, "rubens"), 4);
  assert.equal(RadixTree.lookup(tree, "ruber"), 5);
  assert.equal(RadixTree.lookup(tree, "rubicon"), 6);
  assert.equal(RadixTree.lookup(tree, "rubicundus"), 7);
  assert.equal(RadixTree.size(tree), 7);
});

test("remove returns false for missing key", () => {
  const tree = RadixTree.make<number>();
  assert.equal(RadixTree.remove(tree, "nope"), false);
});

test("remove returns false for missing key in non-empty tree", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abc", 1);
  assert.equal(RadixTree.remove(tree, "xyz"), false);
});

test("remove returns true and removes key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "hello", 1);
  assert.equal(RadixTree.remove(tree, "hello"), true);
  assert.equal(RadixTree.lookup(tree, "hello"), undefined);
  assert.equal(RadixTree.size(tree), 0);
});

test("remove returns false for key that is prefix of existing but has no value", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "testing", 1);
  // "test" is a prefix but has no stored value
  assert.equal(RadixTree.remove(tree, "test"), false);
});

test("remove returns false for internal node that has no value (split node)", () => {
  const tree = RadixTree.make<number>();
  // Insert "test" and "team" which creates a split at "te" (no value)
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "team", 2);
  // "te" exists as an internal node with no value — remove should return false
  assert.equal(RadixTree.remove(tree, "te"), false);
});

test("remove with node merging — leaf removal triggers parent merge", () => {
  const tree = RadixTree.make<number>();
  // Build: "test" -> split into "te" (no value) -> "st" (value=1), "am" (value=2)
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "team", 2);
  assert.equal(RadixTree.size(tree), 2);

  // Remove "team" — the "te" node now has only one child "st", so they merge
  RadixTree.remove(tree, "team");
  assert.equal(RadixTree.size(tree), 1);
  assert.equal(RadixTree.lookup(tree, "test"), 1);
  assert.equal(RadixTree.lookup(tree, "team"), undefined);
});

test("remove internal node with one child — merge with child", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "testing", 2);

  // Remove "test" — node still has child "ing", so they should merge
  RadixTree.remove(tree, "test");
  assert.equal(RadixTree.size(tree), 1);
  assert.equal(RadixTree.lookup(tree, "test"), undefined);
  assert.equal(RadixTree.lookup(tree, "testing"), 2);
});

test("remove leaf from root-level (no parent merge needed)", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "alpha", 1);
  RadixTree.insert(tree, "beta", 2);
  RadixTree.remove(tree, "alpha");
  assert.equal(RadixTree.lookup(tree, "alpha"), undefined);
  assert.equal(RadixTree.lookup(tree, "beta"), 2);
  assert.equal(RadixTree.size(tree), 1);
});

test("remove internal node with multiple children — no merge", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "testing", 2);
  RadixTree.insert(tree, "tester", 3);

  // Remove "test" — node has two children ("ing" and "er"), so no merge
  RadixTree.remove(tree, "test");
  assert.equal(RadixTree.size(tree), 2);
  assert.equal(RadixTree.lookup(tree, "test"), undefined);
  assert.equal(RadixTree.lookup(tree, "testing"), 2);
  assert.equal(RadixTree.lookup(tree, "tester"), 3);
});

test("remove the empty string key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "", 1);
  RadixTree.insert(tree, "a", 2);
  assert.equal(RadixTree.remove(tree, ""), true);
  assert.equal(RadixTree.lookup(tree, ""), undefined);
  assert.equal(RadixTree.lookup(tree, "a"), 2);
  assert.equal(RadixTree.size(tree), 1);
});

test("remove — key not found because remaining is shorter than child prefix", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abcdef", 1);
  // "abc" shares prefix but is shorter than the stored node prefix
  assert.equal(RadixTree.remove(tree, "abc"), false);
});

test("remove — key not found because of character mismatch mid-prefix", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abcdef", 1);
  assert.equal(RadixTree.remove(tree, "abcxyz"), false);
});

test("prefixMatch returns empty array for empty tree", () => {
  const tree = RadixTree.make<number>();
  assert.deepEqual(RadixTree.prefixMatch(tree, "any"), []);
});

test("prefixMatch with empty prefix returns all values", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "a", 1);
  RadixTree.insert(tree, "b", 2);
  RadixTree.insert(tree, "c", 3);
  const result = RadixTree.prefixMatch(tree, "");
  assert.equal(result.length, 3);
  assert.ok(result.includes(1));
  assert.ok(result.includes(2));
  assert.ok(result.includes(3));
});

test("prefixMatch returns matching values only", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "testing", 2);
  RadixTree.insert(tree, "team", 3);
  RadixTree.insert(tree, "other", 4);

  const result = RadixTree.prefixMatch(tree, "test");
  assert.equal(result.length, 2);
  assert.ok(result.includes(1));
  assert.ok(result.includes(2));
});

test("prefixMatch with prefix longer than any key", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "ab", 1);
  assert.deepEqual(RadixTree.prefixMatch(tree, "abcdef"), []);
});

test("prefixMatch where prefix partially matches a node prefix", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "testing", 1);
  RadixTree.insert(tree, "tester", 2);
  // "te" is a partial match of the split node's prefix
  const result = RadixTree.prefixMatch(tree, "te");
  assert.equal(result.length, 2);
  assert.ok(result.includes(1));
  assert.ok(result.includes(2));
});

test("prefixMatch with no matching prefix", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abc", 1);
  assert.deepEqual(RadixTree.prefixMatch(tree, "xyz"), []);
});

test("prefixMatch partial prefix mismatch within child prefix", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abcdef", 1);
  // "abd" has first char matching but second char mismatch within child prefix
  assert.deepEqual(RadixTree.prefixMatch(tree, "abd"), []);
});

test("prefixMatch character mismatch when remaining >= child prefix length", () => {
  const tree = RadixTree.make<number>();
  // Create a tree where a child prefix is shorter than the query prefix
  // but mismatches mid-way. Insert "abc" and "axyz" so root children are split.
  RadixTree.insert(tree, "abc", 1);
  RadixTree.insert(tree, "axyz", 2);
  // Now the tree has root -> "a" (no value) -> ["bc"(1), "xyz"(2)]
  // Query "abyzzz" — remaining after consuming "a" is "byzzz", first char 'b'
  // matches child "bc" prefix first char. remaining.length(5) >= childPrefix.length(2)
  // but remaining[1]='y' != childPrefix[1]='c' — should hit the mismatch branch.
  assert.deepEqual(RadixTree.prefixMatch(tree, "abyzzz"), []);
});

test("entries returns empty array for empty tree", () => {
  const tree = RadixTree.make<number>();
  assert.deepEqual(RadixTree.entries(tree), []);
});

test("entries returns all key-value pairs", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "a", 1);
  RadixTree.insert(tree, "ab", 2);
  RadixTree.insert(tree, "abc", 3);
  const result = RadixTree.entries(tree);
  assert.equal(result.length, 3);

  // Sort entries by key for deterministic comparison
  result.sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(result, [
    ["a", 1],
    ["ab", 2],
    ["abc", 3],
  ]);
});

test("entries includes empty string key", () => {
  const tree = RadixTree.make<string>();
  RadixTree.insert(tree, "", "root");
  RadixTree.insert(tree, "a", "child");
  const result = RadixTree.entries(tree);
  assert.equal(result.length, 2);
  const keys = result.map((e) => e[0]).sort();
  assert.deepEqual(keys, ["", "a"]);
});

test("very long keys", () => {
  const tree = RadixTree.make<number>();
  const longKey = "a".repeat(10000);
  RadixTree.insert(tree, longKey, 42);
  assert.equal(RadixTree.lookup(tree, longKey), 42);
  assert.equal(RadixTree.has(tree, longKey), true);
  assert.equal(RadixTree.remove(tree, longKey), true);
  assert.equal(RadixTree.size(tree), 0);
});

test("keys that are prefixes of each other — full chain", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "a", 1);
  RadixTree.insert(tree, "ab", 2);
  RadixTree.insert(tree, "abc", 3);
  RadixTree.insert(tree, "abcd", 4);

  assert.equal(RadixTree.lookup(tree, "a"), 1);
  assert.equal(RadixTree.lookup(tree, "ab"), 2);
  assert.equal(RadixTree.lookup(tree, "abc"), 3);
  assert.equal(RadixTree.lookup(tree, "abcd"), 4);
  assert.equal(RadixTree.size(tree), 4);

  // Remove from the middle
  RadixTree.remove(tree, "ab");
  assert.equal(RadixTree.lookup(tree, "a"), 1);
  assert.equal(RadixTree.lookup(tree, "ab"), undefined);
  assert.equal(RadixTree.lookup(tree, "abc"), 3);
  assert.equal(RadixTree.lookup(tree, "abcd"), 4);
  assert.equal(RadixTree.size(tree), 3);
});

test("lookup partial match fails correctly", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abcdef", 1);
  // Key shorter than node prefix
  assert.equal(RadixTree.lookup(tree, "abc"), undefined);
  // Key has different character mid-prefix
  assert.equal(RadixTree.lookup(tree, "abcxyz"), undefined);
});

test("remove all entries one by one", () => {
  const tree = RadixTree.make<number>();
  const keys = ["alpha", "alphabet", "beta", "gamma", "gammon"];
  for (let i = 0; i < keys.length; i++) {
    RadixTree.insert(tree, keys[i], i);
  }
  assert.equal(RadixTree.size(tree), 5);

  for (let i = 0; i < keys.length; i++) {
    assert.equal(RadixTree.remove(tree, keys[i]), true);
  }
  assert.equal(RadixTree.size(tree), 0);
  for (let i = 0; i < keys.length; i++) {
    assert.equal(RadixTree.lookup(tree, keys[i]), undefined);
  }
});

test("insert/lookup/remove with various character sets", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "/api/users", 1);
  RadixTree.insert(tree, "/api/users/123", 2);
  RadixTree.insert(tree, "/api/posts", 3);
  RadixTree.insert(tree, "/health", 4);

  assert.equal(RadixTree.lookup(tree, "/api/users"), 1);
  assert.equal(RadixTree.lookup(tree, "/api/users/123"), 2);
  assert.equal(RadixTree.lookup(tree, "/api/posts"), 3);
  assert.equal(RadixTree.lookup(tree, "/health"), 4);

  const apiResults = RadixTree.prefixMatch(tree, "/api");
  assert.equal(apiResults.length, 3);
});

test("prefixMatch exact key match returns that value too", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  const result = RadixTree.prefixMatch(tree, "test");
  assert.deepEqual(result, [1]);
});

test("has returns false for undefined value stored", () => {
  // has() uses lookup() !== undefined, so storing undefined means has returns false.
  // This is by design — undefined is not a valid value sentinel.
  const tree = RadixTree.make<undefined>();
  RadixTree.insert(tree, "key", undefined);
  // The value is undefined, so has() returns false. This is the expected behavior
  // because the implementation uses undefined as the sentinel for "no value".
  // Users should not store undefined as a value.
  assert.equal(RadixTree.has(tree, "key"), false);
});

test("children binary search with many first-characters", () => {
  const tree = RadixTree.make<number>();
  // Insert keys starting with many different characters to exercise binary search
  const chars = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < chars.length; i++) {
    RadixTree.insert(tree, chars[i] + "suffix", i);
  }
  assert.equal(RadixTree.size(tree), 26);
  for (let i = 0; i < chars.length; i++) {
    assert.equal(RadixTree.lookup(tree, chars[i] + "suffix"), i);
  }
});

test("insert where split results in key ending at split point", () => {
  const tree = RadixTree.make<number>();
  // "abcdef" creates a leaf. Then inserting "abc" requires splitting "abcdef"
  // into "abc" (with value) -> "def" (with old value).
  RadixTree.insert(tree, "abcdef", 1);
  RadixTree.insert(tree, "abc", 2);
  assert.equal(RadixTree.lookup(tree, "abcdef"), 1);
  assert.equal(RadixTree.lookup(tree, "abc"), 2);
});

test("remove — root node with value and no path", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "", 1);
  assert.equal(RadixTree.remove(tree, ""), true);
  assert.equal(RadixTree.size(tree), 0);
  // Root node should still work after removing its value
  RadixTree.insert(tree, "a", 2);
  assert.equal(RadixTree.lookup(tree, "a"), 2);
});

test("remove — root node with value and one child (no merge since root)", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "", 1);
  RadixTree.insert(tree, "child", 2);
  assert.equal(RadixTree.remove(tree, ""), true);
  assert.equal(RadixTree.lookup(tree, ""), undefined);
  assert.equal(RadixTree.lookup(tree, "child"), 2);
});

test("prefixMatch — prefix matches exactly one leaf", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abc", 1);
  RadixTree.insert(tree, "def", 2);
  const result = RadixTree.prefixMatch(tree, "abc");
  assert.deepEqual(result, [1]);
});

test("prefixMatch — prefix is longer than a full path (no match beyond leaf)", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "abc", 1);
  assert.deepEqual(RadixTree.prefixMatch(tree, "abcdef"), []);
});

test("prefixMatch — prefix diverges after a full node prefix match", () => {
  const tree = RadixTree.make<number>();
  // Insert "abcd" and "abce" — creates a split node "abc" with children "d" and "e"
  RadixTree.insert(tree, "abcd", 1);
  RadixTree.insert(tree, "abce", 2);
  // Query "abxd" — "ab" matches part of "abc" but then 'x' != 'c' at position 2,
  // triggering the character-mismatch return inside the full-prefix comparison loop.
  assert.deepEqual(RadixTree.prefixMatch(tree, "abxd"), []);
});

test("insert multiple keys, remove, then re-insert", () => {
  const tree = RadixTree.make<number>();
  RadixTree.insert(tree, "test", 1);
  RadixTree.insert(tree, "testing", 2);
  RadixTree.remove(tree, "test");
  RadixTree.remove(tree, "testing");
  assert.equal(RadixTree.size(tree), 0);

  // Re-insert
  RadixTree.insert(tree, "test", 10);
  RadixTree.insert(tree, "testing", 20);
  assert.equal(RadixTree.lookup(tree, "test"), 10);
  assert.equal(RadixTree.lookup(tree, "testing"), 20);
  assert.equal(RadixTree.size(tree), 2);
});
