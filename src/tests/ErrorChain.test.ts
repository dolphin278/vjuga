import * as ErrorChain from "../ErrorChain.js";
import { test } from "node:test";
import * as assert from "node:assert";

test("ErrorChain.chain", () => {
  const cause = new Error("cause");
  const error = new Error("error", { cause });
  const chain = ErrorChain.chain(error);
  assert.strictEqual(chain.next().value, error);
  assert.strictEqual(chain.next().value, cause);
  assert.strictEqual(chain.next().done, true);
});

test("ErrorChain.toArray", () => {
  const cause = new Error("cause");
  const error = new Error("error", { cause });
  const chain = ErrorChain.toArray(error);
  assert.deepStrictEqual(chain, [error, cause]);
});

test("ErrorChain.find - finds error in the chain", () => {
  const cause = new Error("cause");
  const error = new Error("error", { cause });
  const result = ErrorChain.find((err) => err instanceof Error && err.message === "cause", error);
  assert.strictEqual(result, cause);
});

test("ErrorChain.find - returns undefined if not found", () => {
  const cause = new Error("cause");
  const error = new Error("error", { cause });
  const result = ErrorChain.find(
    (err) => err instanceof Error && err.message === "not found",
    error,
  );
  assert.strictEqual(result, undefined);
});
