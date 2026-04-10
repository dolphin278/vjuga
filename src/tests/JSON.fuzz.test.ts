import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as VJSON from "../JSON.js";
import * as Arb from "../Arbitrary.js";
import * as Prop from "../Property.js";

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
  Prop.assert(jsonValue, (v) => {
    const str = VJSON.stringify(v);
    assert.notEqual(str, undefined);
    const parsed = JSON.parse(str!);
    assert.deepEqual(parsed, v);
  }, { numRuns: 500 });
});

test("stringify/parseExn round-trip: VJSON.parseExn(VJSON.stringify(v)) deep-equals v", () => {
  Prop.assert(jsonValue, (v) => {
    const str = VJSON.stringify(v);
    assert.notEqual(str, undefined);
    const parsed = VJSON.parseExn(str!);
    assert.deepEqual(parsed, v);
  }, { numRuns: 500 });
});

test("parse returns undefined for invalid JSON", () => {
  const invalidArb = Arb.filter(
    Arb.string({ minLength: 1, maxLength: 20 }),
    (s) => {
      try { JSON.parse(s); return false; } catch { return true; }
    },
  );
  Prop.assert(invalidArb, (s) => {
    return VJSON.parse(s) === undefined;
  }, { numRuns: 500 });
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
    Arb.tuple(
      Arb.array(dangerousKeyArb, { minLength: 1, maxLength: 4 }),
      Arb.integer(0, 100),
    ),
    ([keys, val]) => {
      // Build a nested object with keys: {"k1": {"k2": ... val}}
      let json = String(val);
      for (let i = keys.length - 1; i >= 0; i--) {
        json = `{${JSON.stringify(keys[i]!)}:${json}}`;
      }
      return json;
    },
  );

  Prop.assert(dangerousJsonArb, (json) => {
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
  }, { numRuns: 500 });
});

test("stringify produces JSON parseable by native JSON.parse", () => {
  Prop.assert(jsonValue, (v) => {
    const str = VJSON.stringify(v);
    assert.notEqual(str, undefined);
    // Should not throw
    JSON.parse(str!);
  }, { numRuns: 500 });
});
