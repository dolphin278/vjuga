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
  positiveNumber,
  integer,
  positiveInteger,
  nonNegativeInteger,
} from "../FunctionUtils.js";
import type { Branded, Integer, NonNegativeInteger, PositiveNumber } from "../FunctionUtils.js";
import { isoTimestamp, type ISOTimestamp } from "../ISOTimestamp.js";

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
      // @ts-expect-error pipe() requires at least one function at the type level
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

  it("positiveNumber accepts valid values", () => {
    assert.equal(positiveNumber(1), 1);
    assert.equal(positiveNumber(0.5), 0.5);
    assert.equal(positiveNumber(Infinity), Infinity);
  });

  it("positiveNumber rejects invalid values", () => {
    assert.throws(() => positiveNumber(0), RangeError);
    assert.throws(() => positiveNumber(-1), RangeError);
    assert.throws(() => positiveNumber(NaN), RangeError);
  });

  it("integer accepts valid values", () => {
    assert.equal(integer(0), 0);
    assert.equal(integer(-1), -1);
    assert.equal(integer(42), 42);
  });

  it("integer rejects invalid values", () => {
    assert.throws(() => integer(1.5), RangeError);
    assert.throws(() => integer(NaN), RangeError);
    assert.throws(() => integer(Infinity), RangeError);
  });

  it("positiveInteger accepts valid values", () => {
    assert.equal(positiveInteger(1), 1);
    assert.equal(positiveInteger(100), 100);
  });

  it("positiveInteger rejects invalid values", () => {
    assert.throws(() => positiveInteger(0), RangeError);
    assert.throws(() => positiveInteger(-1), RangeError);
    assert.throws(() => positiveInteger(1.5), RangeError);
    assert.throws(() => positiveInteger(NaN), RangeError);
  });

  it("nonNegativeInteger accepts valid values", () => {
    assert.equal(nonNegativeInteger(0), 0);
    assert.equal(nonNegativeInteger(1), 1);
    assert.equal(nonNegativeInteger(100), 100);
  });

  it("nonNegativeInteger rejects invalid values", () => {
    assert.throws(() => nonNegativeInteger(-1), RangeError);
    assert.throws(() => nonNegativeInteger(1.5), RangeError);
    assert.throws(() => nonNegativeInteger(NaN), RangeError);
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

// G1-11: PositiveInteger is assignable to NonNegativeInteger (type-level).
describe("brands (type-level)", () => {
  it("PositiveInteger is assignable to NonNegativeInteger", () => {
    const nn: NonNegativeInteger = positiveInteger(1);
    assert.equal(nn, 1);
  });
});

// The brand key is a module-private unique symbol: no literal outside
// FunctionUtils can name it, so a brand is only minted by a cast or a guard.
describe("Branded key is unforgeable (type-level)", () => {
  type Fragment = Branded<{ id: string }, "Fragment">;
  type UtcTimestamp = Branded<ISOTimestamp, "UtcTimestamp">;

  it("an object literal cannot forge an object brand", () => {
    // Non-fresh sources, so the excess-property check cannot be what rejects them.
    const legacyNested = { id: "x", __brand: { Fragment: true as const } };
    const legacyFlat = { id: "x", __brand_Fragment: true as const };
    // @ts-expect-error the v<=11 nested string-key shape no longer forges a brand
    const a: Fragment = legacyNested;
    // @ts-expect-error the v12 flat string-key shape no longer forges a brand
    const b: Fragment = legacyFlat;
    // @ts-expect-error the v12 forgery as a fresh literal
    const c: Fragment = { id: "x", __brand_Fragment: true };
    assert.equal(a.id + b.id + c.id, "xxx");
  });

  it("the brand key is not exported", () => {
    // @ts-expect-error brandKey is declared but not exported
    type Key = typeof import("../FunctionUtils.js").brandKey;
    const k: Key | undefined = undefined;
    assert.equal(k, undefined);
  });

  it("a branded primitive is assignable to its base, the base is not branded", () => {
    const ts = isoTimestamp("2024-01-01T00:00:00Z");
    const s: string = ts;
    // @ts-expect-error a plain string is not an ISOTimestamp
    const bad: ISOTimestamp = s;
    const n: number = positiveInteger(3);
    assert.equal(s + bad + n, "2024-01-01T00:00:00Z2024-01-01T00:00:00Z3");
  });

  it("stacked brands are assignable to every layer and their base", () => {
    const utc = brand<ISOTimestamp, "UtcTimestamp">(isoTimestamp("2024-01-01T00:00:00Z"));
    const iso: ISOTimestamp = utc;
    const s: string = utc;
    // @ts-expect-error an ISOTimestamp is not a UtcTimestamp
    const bad: UtcTimestamp = iso;
    const pi = positiveInteger(2);
    const pn: PositiveNumber = pi;
    const int: Integer = pi;
    assert.equal(`${iso}${s}${bad}${pn}${int}`.length, 62);
  });

  it("different kinds are mutually unassignable", () => {
    type A = Branded<string, "A">;
    type B = Branded<string, "B">;
    const a = brand<string, "A">("a");
    const b = brand<string, "B">("b");
    // @ts-expect-error A is not B
    const ab: B = a;
    // @ts-expect-error B is not A
    const ba: A = b;
    assert.equal(ab + ba, "ab");
  });

  it("type-guard predicates narrow string and object bases without casts", () => {
    type Slug = Branded<string, "Slug">;
    const isSlug = (v: string): v is Slug => /^[a-z-]+$/.test(v);
    const isFragment = (v: { id: string }): v is Fragment => v.id.length > 0;
    const raw: string = "a-b";
    const obj = { id: "x" };
    if (!isSlug(raw) || !isFragment(obj)) assert.fail("guards rejected valid input");
    const slug: Slug = raw;
    const frag: Fragment = obj;
    const spread: Fragment = { ...frag, id: "y" }; // documented: spread keeps the brand
    assert.equal(slug + frag.id + spread.id, "a-bxy");
  });
});
