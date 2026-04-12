import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseExn, stringify, parse, safeParse, escapeJsonString } from "../JSON.js";

describe("JSON", () => {
  describe("stringify", () => {
    it("should stringify numbers", () => {
      assert.equal(stringify(1), "1");
    });

    it("should stringify strings", () => {
      assert.equal(stringify("asdf"), '"asdf"');
    });

    it("should stringify booleans", () => {
      assert.equal(stringify(true), "true");
    });

    it("should stringify null", () => {
      assert.equal(stringify(null), "null");
    });

    it("should stringify arrays", () => {
      assert.equal(stringify([1, "asdf", true, null]), '[1,"asdf",true,null]');
    });

    it("should stringify objects", () => {
      assert.equal(
        stringify({ a: 1, b: "asdf", c: true, d: null }),
        '{"a":1,"b":"asdf","c":true,"d":null}',
      );
    });
  });

  describe("parseExn", () => {
    it("should parse numbers", () => {
      assert.equal(parseExn("1"), 1);
    });

    it("should parse strings", () => {
      assert.equal(parseExn('"asdf"'), "asdf");
    });

    it("should parse booleans", () => {
      assert.equal(parseExn("true"), true);
    });

    it("should parse null", () => {
      assert.equal(parseExn("null"), null);
    });

    it("should parse arrays", () => {
      assert.deepEqual(parseExn('[1,"asdf",true,null]'), [1, "asdf", true, null]);
    });

    it("should parse objects", () => {
      assert.deepEqual(parseExn('{"a":1,"b":"asdf","c":true,"d":null}'), {
        a: 1,
        b: "asdf",
        c: true,
        d: null,
      });
    });

    it("should throw on invalid JSON", () => {
      assert.throws(() => parseExn("asdf"));
    });
  });

  describe("parse", () => {
    it("should parse numbers", () => {
      assert.equal(parse("1"), 1);
    });

    it("should parse strings", () => {
      assert.equal(parse('"asdf"'), "asdf");
    });

    it("should parse booleans", () => {
      assert.equal(parse("true"), true);
    });

    it("should parse null", () => {
      assert.equal(parse("null"), null);
    });

    it("should parse arrays", () => {
      assert.deepEqual(parse('[1,"asdf",true,null]'), [1, "asdf", true, null]);
    });

    it("should parse objects", () => {
      assert.deepEqual(parse('{"a":1,"b":"asdf","c":true,"d":null}'), {
        a: 1,
        b: "asdf",
        c: true,
        d: null,
      });
    });

    it("should return undefined on invalid JSON", () => {
      assert.equal(parse("asdf"), undefined);
    });
  });

  describe("escapeJsonString — lone surrogate handling", () => {
    it("should escape a lone high surrogate", () => {
      const s = String.fromCharCode(0xd800);
      assert.equal(escapeJsonString(s), '"\\ud800"');
    });

    it("should escape a lone low surrogate", () => {
      const s = String.fromCharCode(0xdc00);
      assert.equal(escapeJsonString(s), '"\\udc00"');
    });

    it("should leave a valid surrogate pair unescaped", () => {
      // U+10000 = high surrogate D800 + low surrogate DC00
      const s = String.fromCharCode(0xd800, 0xdc00);
      assert.equal(escapeJsonString(s), '"' + s + '"');
    });

    it("should escape a high surrogate at the end of the string", () => {
      const s = "abc" + String.fromCharCode(0xdbff);
      assert.equal(escapeJsonString(s), '"abc\\udbff"');
    });
  });

  describe("safeParse", () => {
    it("should parse valid JSON and return Ok", () => {
      const r = safeParse('{"a":1}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { a: 1 });
    });

    it("should return Err on invalid JSON", () => {
      const r = safeParse("not json");
      assert.equal(r[0], false);
      assert.equal(r[1], "invalid JSON");
    });

    it("should strip __proto__ keys from objects", () => {
      const r = safeParse('{"__proto__":{"polluted":true},"safe":"value"}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { safe: "value" });
    });

    it("should strip constructor keys from objects", () => {
      const r = safeParse('{"constructor":{"prototype":{"polluted":true}},"ok":1}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { ok: 1 });
    });

    it("should strip __proto__ from nested objects", () => {
      const r = safeParse('{"a":{"__proto__":{"bad":true},"b":1}}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { a: { b: 1 } });
    });

    it("should strip dangerous keys from objects inside arrays", () => {
      const r = safeParse('[{"__proto__":1,"ok":2},{"constructor":3,"safe":4}]');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], [{ ok: 2 }, { safe: 4 }]);
    });

    it("should handle deeply nested structures", () => {
      const r = safeParse('{"a":{"b":{"c":{"__proto__":"bad","d":"good"}}}}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { a: { b: { c: { d: "good" } } } });
    });

    it("should pass through primitives unchanged", () => {
      assert.deepEqual(safeParse("42"), [true, 42]);
      assert.deepEqual(safeParse('"hello"'), [true, "hello"]);
      assert.deepEqual(safeParse("true"), [true, true]);
      assert.deepEqual(safeParse("null"), [true, null]);
    });

    it("should handle empty objects and arrays", () => {
      assert.deepEqual(safeParse("{}"), [true, {}]);
      assert.deepEqual(safeParse("[]"), [true, []]);
    });

    it("should handle clean objects without stripping anything", () => {
      const r = safeParse('{"name":"test","value":123}');
      assert.equal(r[0], true);
      assert.deepEqual(r[1], { name: "test", value: 123 });
    });
  });
});
