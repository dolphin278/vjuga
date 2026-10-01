import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as VJSON from "../../JSON.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

// ---------------------------------------------------------------------------
// JSON value generator — recursive via letrec
// ---------------------------------------------------------------------------

const { jsonValue } = Arb.letrec((tie) => ({
  jsonValue: Arb.oneOf(
    Arb.map(Arb.integer(-1000, 1000), (n) => n as unknown),
    Arb.map(Arb.string({ maxLength: 8 }), (s) => s as unknown),
    Arb.map(Arb.boolean(), (b) => b as unknown),
    Arb.constant(null as unknown),
    Arb.map(Arb.array(tie("jsonValue"), { maxLength: 3 }), (a) => a as unknown),
    Arb.map(
      Arb.dictionary(Arb.string({ minLength: 1, maxLength: 4 }), tie("jsonValue"), { maxSize: 3 }),
      (d) => d as unknown,
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

test("stringify/parse round-trip: JSON.parse(VJSON.stringify(v)) deep-equals v", () => {
  Prop.assert(
    jsonValue,
    (v) => {
      const str = VJSON.stringify(v);
      assert.notEqual(str, undefined);
      const parsed = JSON.parse(str!);
      assert.deepEqual(parsed, v);
    },
    { numRuns: 1_000_000 },
  );
});

test("stringify/parseExn round-trip: VJSON.parseExn(VJSON.stringify(v)) deep-equals v", () => {
  Prop.assert(
    jsonValue,
    (v) => {
      const str = VJSON.stringify(v);
      assert.notEqual(str, undefined);
      const parsed = VJSON.parseExn(str!);
      assert.deepEqual(parsed, v);
    },
    { numRuns: 1_000_000 },
  );
});

test("parse returns undefined for invalid JSON", () => {
  const invalidArb = Arb.filter(Arb.string({ minLength: 1, maxLength: 20 }), (s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });
  Prop.assert(
    invalidArb,
    (s) => {
      return VJSON.parse(s) === undefined;
    },
    { numRuns: 1_000_000 },
  );
});

test("safeParse strips __proto__ and constructor keys at any depth", () => {
  /** Generate an object key that may be dangerous. */
  const dangerousKeyArb = Arb.oneOf(
    Arb.constant("__proto__"),
    Arb.constant("constructor"),
    Arb.string({ minLength: 1, maxLength: 4 }),
  );

  /** Build JSON strings with dangerous keys embedded at various depths. */
  const dangerousJsonArb = Arb.map(
    Arb.tuple(Arb.array(dangerousKeyArb, { minLength: 1, maxLength: 4 }), Arb.integer(0, 100)),
    ([keys, val]) => {
      // Build a nested object with keys: {"k1": {"k2": ... val}}
      let json = String(val);
      for (let i = keys.length - 1; i >= 0; i--) {
        json = `{${JSON.stringify(keys[i]!)}:${json}}`;
      }
      return json;
    },
  );

  Prop.assert(
    dangerousJsonArb,
    (json) => {
      const result = VJSON.safeParse(json);
      if (result[0] === false) return; // invalid JSON is fine, skip
      // Walk the value tree — no __proto__ or constructor keys should remain
      const stack: unknown[] = [result[1]];
      let current: unknown;
      while ((current = stack.pop()) !== undefined) {
        if (current === null || typeof current !== "object") continue;
        if (Array.isArray(current)) {
          for (const item of current) stack.push(item);
        } else {
          const obj = current as Record<string, unknown>;
          for (const key of Object.keys(obj)) {
            assert.notEqual(key, "__proto__", "found __proto__ key after safeParse");
            assert.notEqual(key, "constructor", "found constructor key after safeParse");
            stack.push(obj[key]);
          }
        }
      }
    },
    { numRuns: 1_000_000 },
  );
});

test("stringify produces JSON parseable by native JSON.parse", () => {
  Prop.assert(
    jsonValue,
    (v) => {
      const str = VJSON.stringify(v);
      assert.notEqual(str, undefined);
      // Should not throw
      JSON.parse(str!);
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// G6-6: \u-escaped dangerous keys never survive safeParse
// ---------------------------------------------------------------------------

const escapeWord = (word: string, mask: boolean[], upper: boolean[]): string => {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    if (mask[i % mask.length]) {
      let hex = word.charCodeAt(i).toString(16).padStart(4, "0");
      if (upper[i % upper.length]) hex = hex.toUpperCase();
      out += "\\u" + hex;
    } else {
      out += word[i];
    }
  }
  return out;
};

test("safeParse: randomly \\u-escaped __proto__/constructor keys never survive or pollute", () => {
  const bools = Arb.array(Arb.boolean(), { minLength: 1, maxLength: 11 });
  Prop.assert(
    Arb.tuple<[boolean[], boolean[], boolean[], string, number, unknown]>(
      bools,
      bools,
      bools,
      Arb.constantFrom("__proto__", "constructor"),
      Arb.integer(0, 3),
      jsonValue,
    ),
    ([mask, upper, mask2, word, depth, filler]) => {
      const key = escapeWord(word, mask, upper);
      // Second, independently-escaped key at the same level.
      const key2 = escapeWord("__proto__", mask2, upper);
      let text = `{"${key}":{"polluted":true},"${key2}":{"polluted":true},"f":${JSON.stringify(filler)}}`;
      for (let i = 0; i < depth; i++) text = `[{"k":${text}}]`;
      const r = VJSON.safeParse(text);
      assert.equal(r[0], true);

      const stack: unknown[] = [r[1]];
      let current: unknown;
      while ((current = stack.pop()) !== undefined) {
        if (current === null || typeof current !== "object") continue;
        if (Array.isArray(current)) {
          for (const item of current) stack.push(item);
        } else {
          assert.equal(Object.getPrototypeOf(current), Object.prototype);
          for (const k of Object.getOwnPropertyNames(current)) {
            assert.notEqual(k, "__proto__");
            assert.notEqual(k, "constructor");
            stack.push((current as Record<string, unknown>)[k]);
          }
        }
      }
      assert.equal(({} as Record<string, unknown>).polluted, undefined);
    },
    { numRuns: 1_000_000 },
  );
});
