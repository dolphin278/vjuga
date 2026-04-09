import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as HTML from "../HTML.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const generalStr = Arb.string({ minLength: 0, maxLength: 100 });

/** String guaranteed to contain exactly one dangerous char. */
const withDangerousChar = Arb.map(
  Arb.tuple(
    Arb.string({ maxLength: 10 }),
    Arb.constantFrom("<", ">", "&", '"', "'"),
    Arb.string({ maxLength: 10 }),
  ),
  ([a, c, b]) => a + c + b,
);

const DANGEROUS = new Set(["<", ">", "&", '"', "'"]);

function isSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (DANGEROUS.has(s[i]!)) return false;
  }
  return true;
}

/**
 * Chars that must never appear literally in escaped output.
 * `&` is excluded because entity references (`&lt;`, `&amp;`, etc.) start with it.
 */
const FORBIDDEN_IN_OUTPUT = new Set(["<", ">", '"', "'"]);

/** String containing no dangerous chars. */
const safeStr = Arb.filter(generalStr, isSafe);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

test("fuzz: no dangerous chars in escaped output", () => {
  Prop.assert(withDangerousChar, (s) => {
    const escaped = HTML.escape(s);
    for (let i = 0; i < escaped.length; i++) {
      if (FORBIDDEN_IN_OUTPUT.has(escaped[i]!)) return false;
    }
    return true;
  }, { numRuns: 500 });
});

test("fuzz: safe strings are returned unchanged", () => {
  Prop.assert(safeStr, (s) => HTML.escape(s) === s, { numRuns: 500 });
});

test("fuzz: length is non-decreasing", () => {
  Prop.assert(generalStr, (s) => HTML.escape(s).length >= s.length, { numRuns: 500 });
});

test("fuzz: correct entity mapping for each special char", () => {
  const ENTITY_MAP: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#039;",
  };

  const singleSpecial = Arb.map(
    Arb.tuple(
      Arb.filter(Arb.string({ maxLength: 10 }), isSafe),
      Arb.constantFrom("<", ">", "&", '"', "'"),
      Arb.filter(Arb.string({ maxLength: 10 }), isSafe),
    ),
    ([a, c, b]) => ({ prefix: a, char: c, suffix: b }),
  );

  Prop.assert(singleSpecial, ({ prefix, char, suffix }) => {
    const escaped = HTML.escape(prefix + char + suffix);
    return escaped === prefix + ENTITY_MAP[char] + suffix;
  }, { numRuns: 500 });
});

test("fuzz: empty string returns empty string", () => {
  assert.equal(HTML.escape(""), "");
});
