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
  const result = ErrorChain.find((err) => err.message === "cause", error);
  assert.strictEqual(result, cause);
});

test("ErrorChain.find - returns undefined if not found", () => {
  const cause = new Error("cause");
  const error = new Error("error", { cause });
  const result = ErrorChain.find((err) => err.message === "not found", error);
  assert.strictEqual(result, undefined);
});

// --- cycles (G1-5) ---

function ring(n: number): Error[] {
  const errs = Array.from({ length: n }, (_, i) => new Error(`e${i}`));
  for (let i = 0; i < n; i++) errs[i]!.cause = errs[(i + 1) % n];
  return errs;
}

test("self-referencing cause terminates", () => {
  const e = new Error("self");
  e.cause = e;
  assert.deepEqual(ErrorChain.toArray(e), [e]);
  assert.deepEqual([...ErrorChain.chain(e)], [e]);
  assert.equal(
    ErrorChain.find(() => false, e),
    undefined,
  );
});

test("rings of every small size yield each error once", () => {
  for (let n = 2; n <= 40; n++) {
    const errs = ring(n);
    assert.deepEqual(ErrorChain.toArray(errs[0]!), errs, `toArray n=${n}`);
    assert.deepEqual([...ErrorChain.chain(errs[0]!)], errs, `chain n=${n}`);
    assert.equal(
      ErrorChain.find(() => false, errs[0]!),
      undefined,
      `find n=${n}`,
    );
    assert.equal(
      ErrorChain.find((e) => e === errs[n - 1], errs[0]!),
      errs[n - 1],
    );
  }
});

test("tail leading into a ring yields tail and ring once each", () => {
  for (let tail = 1; tail <= 12; tail++) {
    for (let n = 1; n <= 12; n++) {
      const t = Array.from({ length: tail }, (_, i) => new Error(`t${i}`));
      const r = ring(n);
      for (let i = 0; i < tail - 1; i++) t[i]!.cause = t[i + 1];
      t[tail - 1]!.cause = r[0];
      const expected = [...t, ...r];
      assert.deepEqual(ErrorChain.toArray(t[0]!), expected, `toArray tail=${tail} n=${n}`);
      assert.deepEqual([...ErrorChain.chain(t[0]!)], expected, `chain tail=${tail} n=${n}`);
      assert.equal(
        ErrorChain.find(() => false, t[0]!),
        undefined,
      );
    }
  }
});

test("non-Error terminator ends the chain", () => {
  const e = new Error("a", { cause: "string cause" });
  assert.deepEqual(ErrorChain.toArray(e), [e]);
  assert.deepEqual([...ErrorChain.chain(e)], [e]);
});
