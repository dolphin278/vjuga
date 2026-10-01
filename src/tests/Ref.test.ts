import { test } from "node:test";
import * as assert from "node:assert/strict";

import * as Ref from "../Ref.js";

test("Ref.make", () => {
  const ref = Ref.make(42);
  assert.equal(typeof ref, "object");
  assert.ok(ref.hasOwnProperty("contents"));
  assert.equal(ref.contents, 42);
});

test("Ref.contents can be read and written directly", () => {
  const ref = Ref.make(42);
  assert.equal(ref.contents, 42);
  ref.contents = 43;
  assert.equal(ref.contents, 43);
});

test("Ref.get / Ref.set", () => {
  const ref = Ref.make(1);
  assert.equal(Ref.get(ref), 1);
  Ref.set(ref, 2);
  assert.equal(Ref.get(ref), 2);
  assert.equal(ref.contents, 2);
});
