import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  partial,
  partialNamed,
  pipe,
  spread,
  tuple,
  tupled,
} from "../FunctionUtils.js";

describe("FunctionUtils", () => {
  it("partial", () => {
    /**
     * @param {number} a
     * @param {number} b
     */
    const fn = (a, b) => a + b;
    const sum5 = partial(fn, 5);
    assert.equal(sum5(2), 7);
  });

  it("partialNamed", () => {
    /**
     * @param {{ a: number; b: number }} param0
     */
    const fn = ({ a, b }) => a + b;
    const sum5 = partialNamed(fn, { b: 5 });
    assert.equal(sum5({ a: 2 }), 7);
  });

  it("tuple", () => {
    assert.deepEqual(tuple(1, 2), [1, 2]);
  });

  it("tupled", () => {
    /**
     * @param {number} a
     * @param {number} b
     */
    const fn = (a, b) => a + b;
    const tupledFn = tupled(fn);
    assert.deepEqual(tupledFn([1, 2]), 3);
  });

  it("spread", () => {
    /**
     * @param {[a: number, b: number ]} param0
     */
    const fn = ([a, b]) => a + b;
    const spreadFn = spread(fn);
    assert.deepEqual(spreadFn(1, 2), 3);
  });

  describe("pipe composition", (t) => {
    it("should throw if no functions are passed", () => {
      assert.throws(() => pipe(), Error);
    });

    it("should return the first function if only one is passed", () => {
      const fn = () => "hello";
      assert.equal(pipe(fn)(), "hello");
      assert.equal(pipe(fn), fn);
    });

    it("should return composed function of two", () => {
      /** @param {number} a */
      const fn1 = (a) => a + 1;
      /** @param {number} a */
      const fn2 = (a) => a * 2;
      const composed = pipe(fn1, fn2);
      assert.equal(composed(1), 4);
    });

    it("should return composed function of three", () => {
      /** @param {number} a */
      const fn1 = (a) => a + 1;
      /** @param {number} a */
      const fn2 = (a) => a * 2;
      /** @param {number} a */
      const fn3 = (a) => a * 3;
      const composed = pipe(fn1, fn2, fn3);
      assert.equal(composed(1), 12);
    });

    it("should return composed function of four", () => {
      /** @param {number} a */
      const fn1 = (a) => a + 1;
      /** @param {number} a */
      const fn2 = (a) => a * 2;
      /** @param {number} a */
      const fn3 = (a) => a * 3;
      /** @param {number} a */
      const fn4 = (a) => a * 4;
      const composed = pipe(fn1, fn2, fn3, fn4);
      assert.equal(composed(1), 48);
    });

    it("should return composed function of five", () => {
      /** @param {number} a */
      const fn1 = (a) => a + 1;
      /** @param {number} a */
      const fn2 = (a) => a * 2;
      /** @param {number} a */
      const fn3 = (a) => a * 3;
      /** @param {number} a */
      const fn4 = (a) => a * 4;
      /** @param {number} a */
      const fn5 = (a) => a * 5;
      const composed = pipe(fn1, fn2, fn3, fn4, fn5);
      assert.equal(composed(1), 240);
    });

    it("should return composed function of N > 6", () => {
      /**
       * @param {number} a
       * @param {number} b
       */
      const fn1 = (a, b) => b + a;
      /** @param {number} a */
      const fn2 = (a) => a + 1;
      /** @param {number} a */
      const fn3 = (a) => a + 1;
      /** @param {number} a */
      const fn4 = (a) => a + 1;
      /** @param {number} a */
      const fn5 = (a) => a + 1;
      /** @param {number} a */
      const fn6 = (a) => a + 1;
      /** @param {number} a */
      const fn7 = (a) => a + 1;
      const composed = pipe(fn1, fn2, fn3, fn4, fn5, fn6, fn7);
      assert.equal(composed(1, 1), 8);
    });
  });
});
