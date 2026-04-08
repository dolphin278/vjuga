import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  partial,
  partialNamed,
  pipe,
  spread,
  tuple,
  tupled,
  brand,
  unreachable,
} from "../FunctionUtils.js";
import type { Branded } from "../FunctionUtils.js";

describe("FunctionUtils", () => {
  it("partial", () => {
    const fn = (a: number, b: number) => a + b;
    const sum5 = partial(fn, 5);
    assert.equal(sum5(2), 7);
  });

  it("partialNamed", () => {
    const fn = ({ a, b }: { a: number; b: number }) => a + b;
    const sum5 = partialNamed(fn, { b: 5 });
    assert.equal(sum5({ a: 2 }), 7);
  });

  it("tuple", () => {
    assert.deepEqual(tuple(1, 2), [1, 2]);
  });

  it("tupled", () => {
    const fn = (a: number, b: number) => a + b;
    const tupledFn = tupled(fn);
    assert.deepEqual(tupledFn([1, 2]), 3);
  });

  it("spread", () => {
    const fn = ([a, b]: [a: number, b: number]) => a + b;
    const spreadFn = spread(fn);
    assert.deepEqual(spreadFn(1, 2), 3);
  });

  describe("pipe composition", (_t) => {
    it("should throw if no functions are passed", () => {
      assert.throws(() => pipe(), Error);
    });

    it("should return the first function if only one is passed", () => {
      const fn = () => "hello";
      assert.equal(pipe(fn)(), "hello");
      assert.equal(pipe(fn), fn);
    });

    it("should return composed function of two", () => {
      const fn1 = (a: number) => a + 1;
      const fn2 = (a: number) => a * 2;
      const composed = pipe(fn1, fn2);
      assert.equal(composed(1), 4);
    });

    it("should return composed function of three", () => {
      const fn1 = (a: number) => a + 1;
      const fn2 = (a: number) => a * 2;
      const fn3 = (a: number) => a * 3;
      const composed = pipe(fn1, fn2, fn3);
      assert.equal(composed(1), 12);
    });

    it("should return composed function of four", () => {
      const fn1 = (a: number) => a + 1;
      const fn2 = (a: number) => a * 2;
      const fn3 = (a: number) => a * 3;
      const fn4 = (a: number) => a * 4;
      const composed = pipe(fn1, fn2, fn3, fn4);
      assert.equal(composed(1), 48);
    });

    it("should return composed function of five", () => {
      const fn1 = (a: number) => a + 1;
      const fn2 = (a: number) => a * 2;
      const fn3 = (a: number) => a * 3;
      const fn4 = (a: number) => a * 4;
      const fn5 = (a: number) => a * 5;
      const composed = pipe(fn1, fn2, fn3, fn4, fn5);
      assert.equal(composed(1), 240);
    });

    it("should return composed function of N > 6", () => {
      const fn1 = (a: number, b: number) => b + a;
      const fn2 = (a: number) => a + 1;
      const fn3 = (a: number) => a + 1;
      const fn4 = (a: number) => a + 1;
      const fn5 = (a: number) => a + 1;
      const fn6 = (a: number) => a + 1;
      const fn7 = (a: number) => a + 1;
      const composed = pipe(fn1, fn2, fn3, fn4, fn5, fn6, fn7);
      assert.equal(composed(1, 1), 8);
    });
  });
});

describe("unreachable", () => {
  it("throws 'unreachable'", () => {
    assert.throws(() => unreachable(undefined as never), /unreachable/);
  });
});

describe("Branded", () => {
  it("brand() returns the same value at runtime", () => {
    type UserId = Branded<number, "UserId">;
    const id: UserId = brand<number, "UserId">(42);
    assert.equal(id, 42);
  });

  it("Branded compound type: PositiveNumber & Integer merge correctly", () => {
    type PositiveNumber = Branded<number, "PositiveNumber">;
    type Integer = Branded<number, "Integer">;
    type PositiveInteger = PositiveNumber & Integer;
    // If this compiles, the intersection works as expected.
    const n: PositiveInteger = brand<number, "PositiveNumber">(
      brand<number, "Integer">(3) as number,
    ) as PositiveInteger;
    assert.equal(n, 3);
  });
});
