import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "../FunctionReference.js";

test("FunctionReference", async function () {
  const fn = await resolve("./src/FunctionReference.js#resolve");
  assert.equal(typeof fn, "function");
  assert.equal(fn.name, "resolve");
  assert.equal(fn.toString(), resolve.toString());
  assert.deepStrictEqual(fn.toString(), resolve.toString());
});

test("attempt to resolve invalid module triggers error", async () => {
  await assert.rejects(
    resolve("NON_EXISTENT_MODULE#default"),
    /Failed to import module/,
  );
});

test("referencing non-function export throws an error", async () => {
  await assert.rejects(
    resolve("./src/FunctionReference.js#test"),
    /Resolving (.*) failed - module loaded but exported symbol is not a function/,
  );
});
