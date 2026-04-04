import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseExn, stringify, parse } from "../JSON.js";

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
      assert.deepEqual(parseExn('[1,"asdf",true,null]'), [
        1,
        "asdf",
        true,
        null,
      ]);
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
});
