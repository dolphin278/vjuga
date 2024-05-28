import * as assert from "node:assert/strict";
import { test } from "node:test";
import { make } from "../Deferred.js";

test("Deferred", async () => {
  await test("resolve", async () => {
    const deferred = make();
    deferred.resolve(42);
    assert.equal(await deferred.promise, 42);
  });

  await test("reject", async () => {
    const deferred = make();
    deferred.reject(new Error("Oops"));
    assert.rejects(deferred.promise, { message: "Oops" });
  });
});
