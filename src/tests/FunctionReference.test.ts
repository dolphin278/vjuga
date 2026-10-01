import * as assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  resolve,
  ModuleResolutionError,
  ReferencedSymbolIsNotAFunction,
} from "../FunctionReference.js";

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

const fixtures = "./src/tests/fixtures";

test("file: URL string form resolves", async () => {
  const url = pathToFileURL(`${fixtures}/ref-target.mjs`).href;
  const fn = await resolve(`${url}#greet`);
  assert.equal(fn.name, "greet");
});

test("URL object form resolves", async () => {
  const url = pathToFileURL(`${fixtures}/ref-target.mjs`);
  url.hash = "greet";
  assert.equal((await resolve(url)).name, "greet");
});

test("paths with %, ? and # resolve", async () => {
  // Bun's import() cannot load file URLs containing an encoded "?" (%3F), a
  // runtime limitation unrelated to this module, so that case is Node-only.
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  for (const dir of isBun ? ["100%dir", "hash#dir"] : ["100%dir", "q?dir", "hash#dir"]) {
    const fn = await resolve(`${fixtures}/${dir}/target.mjs#greet`);
    assert.equal(fn("x"), "hello x", dir);
  }
});

test("absolute path resolves", async () => {
  const fn = await resolve(`${process.cwd()}/src/tests/fixtures/ref-target.mjs#greet`);
  assert.equal(fn("x"), "hello x");
});

test("hash is percent-decoded; default export when no hash", async () => {
  assert.equal((await resolve(`${fixtures}/ref-special.mjs#my%20fn`))(), "special");
  assert.equal((await resolve(`${fixtures}/ref-special.mjs`))(), "special");
  // Malformed escape: raw text is used, so the lookup fails cleanly.
  await assert.rejects(
    resolve(`${fixtures}/ref-special.mjs#%E0%A4%A`),
    ReferencedSymbolIsNotAFunction,
  );
});

test("error classes set name and keep the original reference", async () => {
  const ref = `${fixtures}/ref-target.mjs#VERSION`;
  await assert.rejects(resolve(ref), (e: ReferencedSymbolIsNotAFunction) => {
    return (
      e.name === "ReferencedSymbolIsNotAFunction" &&
      e.reference === ref &&
      e.typeFound === "string" &&
      e.url.hash === "#VERSION"
    );
  });
  await assert.rejects(resolve(`${fixtures}/missing.mjs#x`), (e: ModuleResolutionError) => {
    return e.name === "ModuleResolutionError" && e.cause instanceof Error;
  });
});
