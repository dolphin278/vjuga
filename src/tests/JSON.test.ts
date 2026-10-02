import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  parseExn,
  stringify,
  parse,
  safeParse,
  escapeJsonString,
  findDangerousKey,
  type SafeParseOptions,
} from "../JSON.js";

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
      assert.ok(r[1].startsWith("invalid JSON: "), r[1]);
    });

    it("should include the engine's diagnostic in the Err (5a)", () => {
      for (const input of ["{broken", "", "[1,", '{"a":1}x']) {
        const r = safeParse(input);
        assert.equal(r[0], false);
        const msg = r[1] as string;
        assert.ok(msg.startsWith("invalid JSON: "), msg);
        assert.ok(msg.length > "invalid JSON: ".length, msg);
        let engine = "";
        try {
          JSON.parse(input);
        } catch (e) {
          engine = (e as Error).message;
        }
        assert.equal(msg, "invalid JSON: " + engine);
      }
    });

    it("should stringify a non-Error thrown while coercing the input", () => {
      const evil = {
        toString(): string {
          throw "boom";
        },
      };
      assert.deepEqual(safeParse(evil as unknown as string), [false, "invalid JSON: boom"]);
    });

    it("should return Err (not throw) for non-string input that JSON.parse coerces", () => {
      const inputs: unknown[] = [
        123,
        true,
        null,
        undefined,
        {
          toString(): string {
            return '{"a":1}';
          },
        },
      ];
      for (const input of inputs) {
        const r = safeParse(input as string);
        assert.equal(r[0], false, String(input));
        assert.ok((r[1] as string).startsWith("invalid JSON"), String(input));
      }
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

describe("safeParse \\u-escaped dangerous keys (G6-6)", () => {
  const polluted = (): boolean => (({}) as Record<string, unknown>).polluted === true;

  for (const key of [
    "\\u005f_proto__",
    "__\\u0070roto__",
    "\\u005F\\u005F\\u0070\\u0072\\u006F\\u0074\\u006F\\u005F\\u005F",
    "\\u0063onstructor",
    "constr\\u0075ctor",
  ]) {
    it(`strips escaped key ${key}`, () => {
      const r = safeParse(`{"${key}":{"polluted":true},"a":1}`);
      assert.equal(r[0], true);
      const v = r[1] as Record<string, unknown>;
      assert.equal(Object.prototype.hasOwnProperty.call(v, "__proto__"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(v, "constructor"), false);
      assert.equal(v.a, 1);
      assert.equal(polluted(), false);
    });
  }

  it("strips escaped keys nested in arrays and objects", () => {
    const r = safeParse('[{"x":{"\\u005f_proto__":{"polluted":true}}}]');
    const x = (r[1] as Record<string, unknown>[])[0].x as object;
    assert.equal(Object.prototype.hasOwnProperty.call(x, "__proto__"), false);
  });

  it("keeps benign \\u escapes intact", () => {
    const r = safeParse('{"caf\\u00e9":"na\\u00efve"}');
    assert.deepEqual(r[1], { café: "naïve" });
  });
});

describe("safeParse onDangerousKey (5b)", () => {
  const poisoned = '{"a":{"__proto__":{"x":1}},"constructor":{"y":1},"b":1}';

  it("defaults to strip, and an explicit strip matches it", () => {
    assert.deepEqual(safeParse(poisoned), [true, { a: {}, b: 1 }]);
    assert.deepEqual(safeParse(poisoned, {}), [true, { a: {}, b: 1 }]);
    assert.deepEqual(safeParse(poisoned, { onDangerousKey: "strip" }), [true, { a: {}, b: 1 }]);
  });

  it("reject returns Err naming the dangerous key", () => {
    const r = safeParse('{"a":1,"__proto__":{"x":1}}', { onDangerousKey: "reject" });
    assert.equal(r[0], false);
    assert.ok((r[1] as string).includes('"__proto__"'), r[1] as string);
    assert.ok((r[1] as string).includes("dangerous"), r[1] as string);
    assert.ok(!(r[1] as string).startsWith("invalid JSON"));
    const c = safeParse('[{"constructor":1}]', { onDangerousKey: "reject" });
    assert.equal(c[0], false);
    assert.ok((c[1] as string).includes('"constructor"'));
  });

  it("reject catches \\u-escaped keys", () => {
    const r = safeParse('{"\\u005f_proto__":{"x":1}}', { onDangerousKey: "reject" });
    assert.equal(r[0], false);
    assert.ok((r[1] as string).includes('"__proto__"'));
  });

  it("reject returns Ok for false positives (token as a value)", () => {
    assert.deepEqual(
      safeParse('{"type":"constructor","n":"__proto__"}', { onDangerousKey: "reject" }),
      [true, { type: "constructor", n: "__proto__" }],
    );
    assert.deepEqual(safeParse('{"a":1}', { onDangerousKey: "reject" }), [true, { a: 1 }]);
  });

  it("reject still reports syntax errors as invalid JSON", () => {
    const r = safeParse('{"__proto__":', { onDangerousKey: "reject" });
    assert.equal(r[0], false);
    assert.ok((r[1] as string).startsWith("invalid JSON: "));
  });

  it("keep leaves dangerous keys as own properties without polluting", () => {
    const r = safeParse(poisoned, { onDangerousKey: "keep" });
    assert.equal(r[0], true);
    const v = r[1] as Record<string, Record<string, unknown>>;
    assert.ok(Object.hasOwn(v.a!, "__proto__"));
    assert.ok(Object.hasOwn(v, "constructor"));
    assert.equal(({} as Record<string, unknown>).x, undefined);
    assert.deepEqual(r[1], parse(poisoned));
  });

  it("unknown policy values fail closed (behave like reject)", () => {
    const opts = { onDangerousKey: "rejected" } as unknown as SafeParseOptions;
    const r = safeParse('{"__proto__":{"x":1},"a":1}', opts);
    assert.equal(r[0], false);
    assert.match(r[1] as string, /^dangerous JSON key "__proto__"/);
    assert.deepEqual(safeParse('{"a":1}', opts), [true, { a: 1 }]);
    assert.deepEqual(safeParse('{"\\u0061":1}', opts), [true, { a: 1 }]);
  });

  it("an explicit undefined policy is the default strip", () => {
    assert.deepEqual(safeParse('{"__proto__":{"x":1},"a":1}', { onDangerousKey: undefined }), [
      true,
      { a: 1 },
    ]);
  });

  it("parse keeps dangerous keys (non-stripping, by design)", () => {
    const v = parse('{"__proto__":{"x":1},"a":1}') as Record<string, unknown>;
    assert.ok(Object.hasOwn(v, "__proto__"));
  });
});

describe("findDangerousKey", () => {
  it("returns the first dangerous key or undefined, without mutating", () => {
    const v = JSON.parse('{"a":[1,{"b":{"constructor":2}}],"c":null}');
    const before = JSON.stringify(v);
    assert.equal(findDangerousKey(v), "constructor");
    assert.equal(JSON.stringify(v), before);
    assert.equal(findDangerousKey(JSON.parse('{"__proto__":1}')), "__proto__");
    assert.equal(findDangerousKey({ a: [1, "x", null, { b: true }] }), undefined);
    assert.equal(findDangerousKey(42), undefined);
  });
});
