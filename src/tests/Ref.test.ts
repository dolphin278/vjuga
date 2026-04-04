import { test } from "node:test";
import * as assert from "node:assert/strict";

import * as Ref from "../Ref.js";

test("Ref.make", () => {
  const ref = Ref.make(42);
  assert.equal(typeof ref, "object");
  assert.ok(ref.hasOwnProperty("contents"));
  assert.equal(ref.contents, 42);
});

test("Ref.set", () => {
  const ref = Ref.make(42);
  Ref.set(ref, 43);
  assert.equal(ref.contents, 43);
});

test("Ref.get", () => {
  const ref = Ref.make(42);
  assert.equal(Ref.get(ref), 42);
  assert.equal(ref.contents, 42);
});
