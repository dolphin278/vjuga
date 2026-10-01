import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import {
  SER_ERROR,
  SER_VALUE,
  serializeThrown,
  deserializeThrown,
  reducedError,
} from "../WorkerPool.protocol.js";
import type { SerializedError } from "../WorkerPool.protocol.js";

const asErr = (s: unknown): SerializedError => s as SerializedError;

describe("serializeThrown", () => {
  test("non-Error cloneable value is shipped as a tagged value", () => {
    assert.deepEqual(serializeThrown({ a: 1 }), { kind: SER_VALUE, value: { a: 1 } });
    assert.deepEqual(serializeThrown("str"), { kind: SER_VALUE, value: "str" });
  });

  test("non-Error uncloneable value falls back to its string form", () => {
    assert.deepEqual(serializeThrown({ fn() {} }), { kind: SER_VALUE, value: "[object Object]" });
    const hostile = {
      fn() {},
      toString() {
        throw new Error("no");
      },
    };
    assert.deepEqual(serializeThrown(hostile), { kind: SER_VALUE, value: "[unserializable]" });
  });

  test("Error keeps name/message/stack/cause and cloneable own props only", () => {
    const err = new Error("boom", { cause: new TypeError("root") });
    Object.assign(err, { code: 42, fn: () => 1 });
    const s = asErr(serializeThrown(err));
    assert.equal(s.kind, SER_ERROR);
    assert.equal(s.message, "boom");
    assert.equal(s.name, "Error");
    assert.equal(typeof s.stack, "string");
    assert.equal(asErr(s.cause).name, "TypeError");
    assert.deepEqual(s.properties, { code: 42 });
    structuredClone(s); // must be cloneable
  });

  test("non-Error cause is wrapped as a value, not confused with an error", () => {
    const s = asErr(serializeThrown(new Error("x", { cause: { message: "m" } })));
    assert.deepEqual(s.cause, { kind: SER_VALUE, value: { message: "m" } });
  });

  test("reserved enumerable keys are not duplicated into properties", () => {
    const err = new Error("x");
    Object.defineProperty(err, "name", { value: "Custom", enumerable: true });
    assert.deepEqual(asErr(serializeThrown(err)).properties, {});
  });

  test("cause cycles are cut at a bounded depth", () => {
    const err = new Error("loop") as Error & { cause: unknown };
    err.cause = err;
    let depth = 0;
    let cur: unknown = serializeThrown(err);
    while (cur !== undefined) {
      depth++;
      cur = asErr(cur).cause;
    }
    assert.ok(depth > 1 && depth <= 20);
  });

  test("throwing getters / proxy traps never throw out of serializeThrown", () => {
    const err = new Error("g");
    Object.defineProperty(err, "message", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(err, "stack", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(err, "cause", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(err, "bad", {
      enumerable: true,
      get() {
        throw new Error("no");
      },
    });
    const s = asErr(serializeThrown(err));
    assert.equal(s.message, "undefined");
    assert.equal(s.stack, undefined);
    assert.equal(s.cause, undefined);
    assert.deepEqual(s.properties, { bad: undefined });

    const proxy = new Proxy(new Error("p"), {
      ownKeys() {
        throw new Error("trap");
      },
    });
    assert.deepEqual(asErr(serializeThrown(proxy)).properties, {});
  });
});

describe("reducedError", () => {
  test("is strings only", () => {
    assert.deepEqual(reducedError(new RangeError("r")), {
      kind: SER_ERROR,
      message: "r",
      name: "RangeError",
      stack: undefined,
      cause: undefined,
      properties: {},
    });
    assert.equal(reducedError(123).message, "123");
    const noName = new Error("n");
    Object.defineProperty(noName, "name", { value: 5 });
    assert.equal(reducedError(noName).name, "Error");
  });
});

describe("deserializeThrown", () => {
  test("round-trips an Error with cause and props", () => {
    const src = new Error("boom", { cause: new TypeError("root") });
    src.name = "Custom";
    Object.assign(src, { code: 1 });
    const out = deserializeThrown(serializeThrown(src)) as Error & { code: number };
    assert.ok(out instanceof Error);
    assert.equal(out.name, "Custom");
    assert.equal(out.message, "boom");
    assert.equal(out.code, 1);
    assert.equal(out.stack, src.stack);
    assert.equal((out.cause as Error).name, "TypeError");
  });

  test("value payloads come back as the value", () => {
    assert.deepEqual(deserializeThrown({ kind: SER_VALUE, value: { a: 1 } }), { a: 1 });
  });

  test("malformed payloads become an Error and never throw", () => {
    for (const bad of [undefined, null, 5, "s", {}, { kind: 99 }]) {
      const out = deserializeThrown(bad);
      assert.ok(out instanceof Error);
      assert.match(out.message, /malformed/);
    }
  });

  test("missing / mistyped fields are tolerated", () => {
    const a = deserializeThrown({ kind: SER_ERROR }) as Error;
    assert.ok(a instanceof Error);
    assert.equal(a.message, "");
    assert.equal(a.name, "Error");
    assert.equal(a.cause, undefined);

    const b = deserializeThrown({
      kind: SER_ERROR,
      message: 12,
      name: 3,
      stack: 4,
      properties: null,
    }) as Error;
    assert.equal(b.message, "12");
    assert.equal(b.name, "Error");

    const c = deserializeThrown({ kind: SER_ERROR, message: Symbol.iterator }) as Error;
    assert.equal(c.message, "Symbol(Symbol.iterator)");
  });

  test("a bad cause does not throw and is surfaced as an Error", () => {
    const out = deserializeThrown({ kind: SER_ERROR, message: "m", cause: { message: "x" } });
    assert.ok((out as Error).cause instanceof Error);
  });

  test("cause chain is depth-capped", () => {
    let s: unknown = { kind: SER_ERROR, message: "leaf" };
    for (let i = 0; i < 100; i++) s = { kind: SER_ERROR, message: "n" + i, cause: s };
    let depth = 0;
    let cur: unknown = deserializeThrown(s);
    while (cur instanceof Error) {
      depth++;
      cur = cur.cause;
    }
    assert.ok(depth <= 20);
  });

  test("__proto__ and reserved property keys cannot corrupt the error", () => {
    const properties = JSON.parse('{"__proto__": {"polluted": 1}, "message": "evil", "ok": 1}');
    const out = deserializeThrown({ kind: SER_ERROR, message: "m", properties }) as Error;
    assert.equal(out.message, "m");
    assert.equal(Object.getPrototypeOf(out), Error.prototype);
    assert.equal((out as unknown as Record<string, unknown>).polluted, undefined);
    assert.equal((out as unknown as Record<string, unknown>).ok, 1);
  });
});
