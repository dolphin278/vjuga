import { test } from "node:test";
import * as assert from "node:assert/strict";
import { ValidationError } from "../../schema/ValidationError.js";

test("ValidationError message with no path", () => {
  const e = new ValidationError("string", 42);
  assert.ok(e instanceof ValidationError);
  assert.ok(e.message.includes("value"));
  assert.equal(e.path, "");
  assert.equal(e.expected, "string");
  assert.equal(e.received, 42);
});

test("ValidationError message with path", () => {
  const e = new ValidationError("number", "x", "user.age");
  assert.ok(e.message.includes('"user.age"'));
  assert.equal(e.path, "user.age");
});

test("ValidationError received null shows 'null'", () => {
  const e = new ValidationError("string", null);
  assert.ok(e.message.includes("null"));
});

test("ValidationError received array shows 'array'", () => {
  const e = new ValidationError("string", [1, 2, 3]);
  assert.ok(e.message.includes("array"));
});
