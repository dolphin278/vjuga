import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "../FunctionReference.js";

// Dynamic-import targets use a dedicated fixture to avoid a V8 coverage bug
// where a module loaded both statically and dynamically in the same process
// gets corrupted coverage data. Every src/*.js module is statically imported
// by its own test file, so only a fixture is safe here.

test("FunctionReference", async function () {
  const fn = await resolve("./src/tests/fixtures/ref-target.mjs#greet");
  assert.equal(typeof fn, "function");
  assert.equal(fn.name, "greet");
});

test("attempt to resolve invalid module triggers error", async () => {
  await assert.rejects(resolve("NON_EXISTENT_MODULE#default"), /Failed to import module/);
});

test("referencing non-function export throws an error", async () => {
  // ref-target.mjs#VERSION is a string, not a function
  await assert.rejects(
    resolve("./src/tests/fixtures/ref-target.mjs#VERSION"),
    /Resolving (.*) failed - module loaded but exported symbol is not a function/,
  );
});

test("resolve without hash falls back to 'default' export name", async () => {
  // No '#hash' → exportName = "default"; ref-target.mjs has no default export → throws.
  await assert.rejects(
    resolve("./src/tests/fixtures/ref-target.mjs"),
    /Resolving (.*) failed - module loaded but exported symbol is not a function/,
  );
});
