import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as Result from "../Result.js";

// --- ok / err / isOk / isErr ---

test("ok() creates an Ok tuple", () => {
  const r = Result.ok(42);
  assert.equal(r[0], true);
  assert.equal(r[1], 42);
});

test("err() creates an Err tuple", () => {
  const r = Result.err("oops");
  assert.equal(r[0], false);
  assert.equal(r[1], "oops");
});

test("isOk() returns true for Ok, false for Err", () => {
  assert.equal(Result.isOk(Result.ok(1)), true);
  assert.equal(Result.isOk(Result.err("e")), false);
});

test("isErr() returns true for Err, false for Ok", () => {
  assert.equal(Result.isErr(Result.err("e")), true);
  assert.equal(Result.isErr(Result.ok(1)), false);
});

// --- map ---

test("map() transforms Ok value", () => {
  const r = Result.map(Result.ok(2), (x) => x * 3);
  assert.deepEqual(r, [true, 6]);
});

test("map() passes Err through unchanged", () => {
  const r = Result.map(Result.err("e") as Result.Result<number, string>, (x) => x * 3);
  assert.deepEqual(r, [false, "e"]);
});

// --- mapErr ---

test("mapErr() transforms Err value", () => {
  const r = Result.mapErr(Result.err(42), (e) => String(e));
  assert.deepEqual(r, [false, "42"]);
});

test("mapErr() passes Ok through unchanged", () => {
  const r = Result.mapErr(Result.ok("v") as Result.Result<string, number>, (e) => String(e));
  assert.deepEqual(r, [true, "v"]);
});

// --- flatMap ---

test("flatMap() chains Ok through another Result-returning fn", () => {
  const r = Result.flatMap(Result.ok(4), (x) => Result.ok(x + 1));
  assert.deepEqual(r, [true, 5]);
});

test("flatMap() propagates inner Err", () => {
  const r = Result.flatMap(Result.ok(4), (_x) => Result.err("bad"));
  assert.deepEqual(r, [false, "bad"]);
});

test("flatMap() passes outer Err through without calling fn", () => {
  let called = false;
  const r = Result.flatMap(Result.err("outer") as Result.Result<number, string>, (x) => {
    /* c8 ignore next 2 -- this callback is intentionally never invoked; the test verifies that */
    called = true;
    return Result.ok(x + 1);
  });
  assert.deepEqual(r, [false, "outer"]);
  assert.equal(called, false);
});

// --- unwrapOr ---

test("unwrapOr() returns Ok value", () => {
  assert.equal(Result.unwrapOr(Result.ok(7), 0), 7);
});

test("unwrapOr() returns fallback for Err", () => {
  assert.equal(Result.unwrapOr(Result.err("e") as Result.Result<number, string>, 99), 99);
});

// --- unwrap ---

test("unwrap() returns Ok value", () => {
  assert.equal(Result.unwrap(Result.ok("hello")), "hello");
});

test("unwrap() throws Error payload when Err contains Error", () => {
  const cause = new Error("boom");
  assert.throws(() => Result.unwrap(Result.err(cause)), cause);
});

test("unwrap() wraps non-Error Err payload in Error", () => {
  assert.throws(() => Result.unwrap(Result.err("fail") as Result.Result<number, string>), {
    message: "fail",
  });
});

// Shared mapErrFn used across fromThrowable/fromPromise/fromAsyncThrowable tests.
// Defined once so V8 tracks branch coverage on a single function object — both
// the Error path (e.message) and the non-Error path (String(e)) are covered
// across the test suite.
function mapErrToString(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- fromThrowable ---

test("fromThrowable() wraps successful call in Ok", () => {
  const r = Result.fromThrowable(() => JSON.parse('{"a":1}') as unknown);
  assert.deepEqual(r, [true, { a: 1 }]);
});

test("fromThrowable() wraps thrown error in Err", () => {
  const r = Result.fromThrowable(() => JSON.parse("bad json"));
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof SyntaxError);
});

test("fromThrowable() applies mapErrFn to caught Error", () => {
  const r = Result.fromThrowable(() => {
    throw new Error("raw");
  }, mapErrToString);
  assert.deepEqual(r, [false, "raw"]);
});

test("fromThrowable() mapErrFn handles non-Error thrown values", () => {
  const r = Result.fromThrowable(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw "non-error string";
  }, mapErrToString);
  assert.deepEqual(r, [false, "non-error string"]);
});

// --- fromPromise ---

test("fromPromise() resolves Ok for fulfilled promise", async () => {
  const r = await Result.fromPromise(Promise.resolve(42));
  assert.deepEqual(r, [true, 42]);
});

test("fromPromise() resolves Err for rejected promise", async () => {
  const r = await Result.fromPromise(Promise.reject(new Error("boom")));
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof Error);
});

test("fromPromise() applies mapErrFn on Error rejection", async () => {
  const r = await Result.fromPromise(Promise.reject(new Error("raw")), mapErrToString);
  assert.deepEqual(r, [false, "raw"]);
});

test("fromPromise() applies mapErrFn on non-Error rejection", async () => {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  const r = await Result.fromPromise(Promise.reject("non-error"), mapErrToString);
  assert.deepEqual(r, [false, "non-error"]);
});

// --- fromAsyncThrowable ---

test("fromAsyncThrowable() wraps resolved promise in Ok", async () => {
  const safe = Result.fromAsyncThrowable(async (x: number) => x * 2);
  const r = await safe(5);
  assert.deepEqual(r, [true, 10]);
});

test("fromAsyncThrowable() wraps rejected promise in Err", async () => {
  const safe = Result.fromAsyncThrowable(async (_x: number) => {
    throw new Error("async fail");
  });
  const r = await safe(1);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof Error);
});

test("fromAsyncThrowable() applies mapErrFn on Error rejection", async () => {
  const safe = Result.fromAsyncThrowable(async (_x: number) => {
    throw new Error("async fail");
  }, mapErrToString);
  const r = await safe(1);
  assert.deepEqual(r, [false, "async fail"]);
});

test("fromAsyncThrowable() mapErrFn handles non-Error rejection", async () => {
  const safe = Result.fromAsyncThrowable(async (_x: number) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw "non-error string";
  }, mapErrToString);
  const r = await safe(1);
  assert.deepEqual(r, [false, "non-error string"]);
});

// --- TypeScript narrowing (compile-time check via assignment) ---

test("discriminant at [0] narrows the union correctly", () => {
  const r: Result.Result<number, string> = Result.ok(1);
  if (r[0]) {
    const v: number = r[1]; // must compile — r is Ok<number> here
    assert.equal(v, 1);
    /* c8 ignore next 5 -- Err branch is unreachable; kept to verify TypeScript narrowing compiles */
  } else {
    assert.equal(typeof (r[1] satisfies string), "string");
    assert.fail("should not reach Err branch");
  }
});
