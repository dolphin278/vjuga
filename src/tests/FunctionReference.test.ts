export {};
// ----------------------------------------------------------------------
// This module is temporary excluded because import() compilation
// for cjs modules do not code similar enough.
// ----------------------------------------------------------------------

// import { resolve } from "../FunctionReference";
// import { test } from "node:test";
// import * as assert from "node:assert/strict";

// test("FunctionReference", async function () {
//   const fn = await resolve("./dist/tsc/FunctionReference.js#resolve");
//   assert.equal(typeof fn, "function");
//   assert.equal(fn.name, "resolve");
//   assert.equal(fn.toString(), resolve.toString());
//   assert.deepStrictEqual(fn, resolve);
// });

// test("attempt to resolve invalid module triggers error", async () => {
//   await assert.rejects(
//     resolve("NON_EXISTENT_MODULE#default"),
//     /Failed to import module/
//   );
// });

// test("referencing non-function export throws an error", async () => {
//   await assert.rejects(
//     resolve("./dist/tsc/FunctionReference.js#test"),
//     /Resolving (.*) failed - module loaded but exported symbol is not a function/
//   );
// });
