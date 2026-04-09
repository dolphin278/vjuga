import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Validator from "../Validator.js";
import { ValidationError } from "../Validator.js";

// --- Helpers ---
function assertOk<T>(r: Validator.Validator<T> extends (v: unknown) => infer R ? R : never): void;
function assertOk(r: ReturnType<Validator.Validator<unknown>>): void {
  /* c8 ignore next 2 */
  if (!r[0]) throw new Error(`Expected Ok but got Err: ${String(r[1])}`);
}
function assertErr(r: ReturnType<Validator.Validator<unknown>>): ValidationError {
  /* c8 ignore next 2 */
  if (r[0]) throw new Error("Expected Err but got Ok");
  return r[1] as ValidationError;
}

// --- string ---

test("string() accepts a string", () => {
  const r = Validator.string()("hello");
  assertOk(r);
  assert.equal(r[1], "hello");
});

test("string() rejects non-string", () => {
  const e = assertErr(Validator.string()(42));
  assert.ok(e instanceof ValidationError);
  assert.equal(e.expected, "string");
});

// --- number ---

test("number() accepts a number", () => {
  const r = Validator.number()(3.14);
  assertOk(r);
  assert.equal(r[1], 3.14);
});

test("number() rejects NaN", () => {
  assertErr(Validator.number()(NaN));
});

test("number() rejects string", () => {
  assertErr(Validator.number()("3"));
});

test("number() rejects null (exercises formatReceived null branch)", () => {
  const e = assertErr(Validator.number()(null));
  assert.ok(e.message.includes("null"));
});

// --- boolean ---

test("boolean() accepts true and false", () => {
  assertOk(Validator.boolean()(true));
  assertOk(Validator.boolean()(false));
});

test("boolean() rejects non-boolean", () => {
  assertErr(Validator.boolean()(0));
  assertErr(Validator.boolean()("true"));
});

// --- null_ ---

test("null_() accepts null", () => {
  const r = Validator.null_()(null);
  assertOk(r);
  assert.equal(r[1], null);
});

test("null_() rejects undefined", () => {
  assertErr(Validator.null_()(undefined));
});

// --- undefined_ ---

test("undefined_() accepts undefined", () => {
  const r = Validator.undefined_()(undefined);
  assertOk(r);
  assert.equal(r[1], undefined);
});

test("undefined_() rejects null", () => {
  assertErr(Validator.undefined_()(null));
});

// --- literal ---

test("literal() accepts exact value", () => {
  assertOk(Validator.literal("ok")("ok"));
  assertOk(Validator.literal(42)(42));
  assertOk(Validator.literal(true)(true));
  assertOk(Validator.literal(null)(null));
});

test("literal() rejects different value", () => {
  assertErr(Validator.literal("ok")("nope"));
  assertErr(Validator.literal(1)(2));
});

// --- object ---

test("object() validates a matching object", () => {
  const v = Validator.object({ name: Validator.string(), age: Validator.number() });
  const r = v({ name: "Alice", age: 30 });
  assert.ok(r[0]);
  assert.equal(r[1].name, "Alice");
  assert.equal(r[1].age, 30);
});

test("object() rejects non-object", () => {
  const v = Validator.object({ x: Validator.number() });
  assertErr(v(42));
  assertErr(v(null));
  assertErr(v("string"));
});

test("object() rejects when a field fails", () => {
  const v = Validator.object({ x: Validator.number() });
  const e = assertErr(v({ x: "not a number" }));
  assert.equal(e.path, "x");
});

test("object() allows extra keys", () => {
  const v = Validator.object({ x: Validator.number() });
  const r = v({ x: 1, extra: "ignored" });
  assertOk(r);
});

test("object() error path for nested object", () => {
  const v = Validator.object({ a: Validator.object({ b: Validator.number() }) });
  const e = assertErr(v({ a: { b: "bad" } }));
  assert.equal(e.path, "a.b");
});

// --- array ---

test("array() validates an array of numbers", () => {
  const v = Validator.array(Validator.number());
  const r = v([1, 2, 3]);
  assertOk(r);
  assert.deepEqual(r[1], [1, 2, 3]);
});

test("array() rejects non-array", () => {
  assertErr(Validator.array(Validator.number())({}));
});

test("array() rejects array with invalid element and includes index in path", () => {
  const v = Validator.array(Validator.number());
  const e = assertErr(v([1, "bad", 3]));
  assert.equal(e.path, "1");
});

// --- record ---

test("record() validates a string-keyed object", () => {
  const v = Validator.record(Validator.number());
  const r = v({ a: 1, b: 2 });
  assertOk(r);
  assert.deepEqual(r[1], { a: 1, b: 2 });
});

test("record() rejects when a value fails", () => {
  const v = Validator.record(Validator.number());
  const e = assertErr(v({ a: 1, b: "bad" }));
  assert.equal(e.path, "b");
});

test("record() rejects array", () => {
  assertErr(Validator.record(Validator.number())([1, 2]));
});

test("record() skips inherited enumerable properties", () => {
  const proto = { inherited: "ignored" };
  const obj = Object.create(proto) as Record<string, unknown>;
  obj["own"] = 42;
  const v = Validator.record(Validator.number());
  const r = v(obj);
  assert.ok(r[0]);
  assert.deepEqual(r[1], { own: 42 });
});

// --- tuple ---

test("tuple() validates a matching tuple", () => {
  const v = Validator.tuple([Validator.string(), Validator.number()] as const);
  const r = v(["hello", 42]);
  assertOk(r);
  assert.deepEqual(r[1], ["hello", 42]);
});

test("tuple() rejects wrong length", () => {
  const v = Validator.tuple([Validator.string(), Validator.number()] as const);
  assertErr(v(["hello"]));
  assertErr(v(["hello", 1, 2]));
});

test("tuple() rejects non-array", () => {
  assertErr(Validator.tuple([Validator.number()] as const)(42));
});

test("tuple() includes element index in error path", () => {
  const v = Validator.tuple([Validator.string(), Validator.number()] as const);
  const e = assertErr(v(["ok", "bad"]));
  assert.equal(e.path, "1");
});

// --- optional ---

test("optional() passes through undefined", () => {
  const v = Validator.optional(Validator.string());
  const r = v(undefined);
  assertOk(r);
  assert.equal(r[1], undefined);
});

test("optional() validates when value is present", () => {
  const v = Validator.optional(Validator.string());
  assertOk(v("hello"));
  assertErr(v(42));
});

// --- nullable ---

test("nullable() passes through null", () => {
  const v = Validator.nullable(Validator.string());
  const r = v(null);
  assertOk(r);
  assert.equal(r[1], null);
});

test("nullable() validates when value is present", () => {
  const v = Validator.nullable(Validator.string());
  assertOk(v("hello"));
  assertErr(v(42));
});

// --- union ---

test("union() returns first matching result", () => {
  const v = Validator.union([Validator.string(), Validator.number()] as const);
  assertOk(v("hello"));
  assertOk(v(42));
});

test("union() rejects when no variant matches", () => {
  const v = Validator.union([Validator.string(), Validator.number()] as const);
  assertErr(v(true));
});

// --- map ---

test("map() transforms Ok value", () => {
  const v = Validator.map(Validator.string(), (s) => s.toUpperCase());
  const r = v("hello");
  assertOk(r);
  assert.equal(r[1], "HELLO");
});

test("map() passes Err through", () => {
  const v = Validator.map(Validator.string(), (s) => s.length);
  assertErr(v(42));
});

// --- toGuard ---

test("toGuard() returns true for valid input", () => {
  const isString = Validator.toGuard(Validator.string());
  assert.equal(isString("hello"), true);
});

test("toGuard() returns false for invalid input", () => {
  const isString = Validator.toGuard(Validator.string());
  assert.equal(isString(42), false);
});

test("toGuard() narrows type (compiles with filter)", () => {
  const isNumber = Validator.toGuard(Validator.number());
  const mixed: unknown[] = [1, "two", 3];
  const nums: number[] = mixed.filter(isNumber);
  assert.deepEqual(nums, [1, 3]);
});

// --- toAssertion ---

test("toAssertion() does not throw for valid input", () => {
  const assertString = Validator.toAssertion(Validator.string());
  assert.doesNotThrow(() => assertString("hello"));
});

test("toAssertion() throws ValidationError for invalid input", () => {
  const assertString = Validator.toAssertion(Validator.string());
  assert.throws(() => assertString(42), ValidationError);
});

// --- ValidationError ---

test("ValidationError has correct fields", () => {
  const e = new ValidationError("string", 42, "user.name");
  assert.equal(e.name, "ValidationError");
  assert.equal(e.path, "user.name");
  assert.equal(e.expected, "string");
  assert.equal(e.received, 42);
  assert.ok(e instanceof Error);
  assert.ok(e instanceof ValidationError);
});

test("ValidationError with empty path says 'value' in message", () => {
  const e = new ValidationError("string", 42);
  assert.ok(e.message.includes("value"));
});

// --- positiveNumber ---

test("positiveNumber() accepts positive numbers", () => {
  const v = Validator.positiveNumber();
  assertOk(v(1));
  assertOk(v(0.5));
  assertOk(v(Infinity));
});

test("positiveNumber() rejects non-positive", () => {
  const v = Validator.positiveNumber();
  assertErr(v(0));
  assertErr(v(-1));
  assertErr(v(NaN));
  assertErr(v("1"));
});

// --- integer ---

test("integer() accepts safe integers", () => {
  const v = Validator.integer();
  assertOk(v(0));
  assertOk(v(-1));
  assertOk(v(42));
});

test("integer() rejects non-integers", () => {
  const v = Validator.integer();
  assertErr(v(1.5));
  assertErr(v(NaN));
  assertErr(v(Infinity));
  assertErr(v("1"));
});

// --- positiveInteger ---

test("positiveInteger() accepts positive integers", () => {
  const v = Validator.positiveInteger();
  assertOk(v(1));
  assertOk(v(100));
});

test("positiveInteger() rejects non-positive-integers", () => {
  const v = Validator.positiveInteger();
  assertErr(v(0));
  assertErr(v(-1));
  assertErr(v(1.5));
  assertErr(v(NaN));
  assertErr(v("1"));
});

// --- nonNegativeInteger ---

test("nonNegativeInteger() accepts non-negative integers", () => {
  const v = Validator.nonNegativeInteger();
  assertOk(v(0));
  assertOk(v(1));
  assertOk(v(100));
});

test("nonNegativeInteger() rejects negative or non-integers", () => {
  const v = Validator.nonNegativeInteger();
  assertErr(v(-1));
  assertErr(v(1.5));
  assertErr(v(NaN));
  assertErr(v("0"));
});
