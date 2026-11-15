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
  positiveNumberExn,
  integerExn,
  positiveIntegerExn,
  nonNegativeIntegerExn,
} from "../FunctionUtils.js";
import type { Branded, Integer, NonNegativeInteger, PositiveNumber } from "../FunctionUtils.js";
import { isoTimestampExn, type ISOTimestamp } from "../ISOTimestamp.js";
import * as FU from "../FunctionUtils.js";

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
    assert.equal(positiveNumberExn(1), 1);
    assert.equal(positiveNumberExn(0.5), 0.5);
    assert.equal(positiveNumberExn(Infinity), Infinity);
  });

  it("positiveNumber rejects invalid values", () => {
    assert.throws(() => positiveNumberExn(0), RangeError);
    assert.throws(() => positiveNumberExn(-1), RangeError);
    assert.throws(() => positiveNumberExn(NaN), RangeError);
  });

  it("integer accepts valid values", () => {
    assert.equal(integerExn(0), 0);
    assert.equal(integerExn(-1), -1);
    assert.equal(integerExn(42), 42);
  });

  it("integer rejects invalid values", () => {
    assert.throws(() => integerExn(1.5), RangeError);
    assert.throws(() => integerExn(NaN), RangeError);
    assert.throws(() => integerExn(Infinity), RangeError);
  });

  it("positiveInteger accepts valid values", () => {
    assert.equal(positiveIntegerExn(1), 1);
    assert.equal(positiveIntegerExn(100), 100);
  });

  it("positiveInteger rejects invalid values", () => {
    assert.throws(() => positiveIntegerExn(0), RangeError);
    assert.throws(() => positiveIntegerExn(-1), RangeError);
    assert.throws(() => positiveIntegerExn(1.5), RangeError);
    assert.throws(() => positiveIntegerExn(NaN), RangeError);
  });

  it("nonNegativeInteger accepts valid values", () => {
    assert.equal(nonNegativeIntegerExn(0), 0);
    assert.equal(nonNegativeIntegerExn(1), 1);
    assert.equal(nonNegativeIntegerExn(100), 100);
  });

  it("nonNegativeInteger rejects invalid values", () => {
    assert.throws(() => nonNegativeIntegerExn(-1), RangeError);
    assert.throws(() => nonNegativeIntegerExn(1.5), RangeError);
    assert.throws(() => nonNegativeIntegerExn(NaN), RangeError);
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
    const nn: NonNegativeInteger = positiveIntegerExn(1);
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
    const ts = isoTimestampExn("2024-01-01T00:00:00Z");
    const s: string = ts;
    // @ts-expect-error a plain string is not an ISOTimestamp
    const bad: ISOTimestamp = s;
    const n: number = positiveIntegerExn(3);
    assert.equal(s + bad + n, "2024-01-01T00:00:00Z2024-01-01T00:00:00Z3");
  });

  it("stacked brands are assignable to every layer and their base", () => {
    const utc = brand<ISOTimestamp, "UtcTimestamp">(isoTimestampExn("2024-01-01T00:00:00Z"));
    const iso: ISOTimestamp = utc;
    const s: string = utc;
    // @ts-expect-error an ISOTimestamp is not a UtcTimestamp
    const bad: UtcTimestamp = iso;
    const pi = positiveIntegerExn(2);
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

// The standard set per branded number: x() → Result, xExn() → value or throw,
// isX(unknown) guard, assertX(unknown) assertion.
describe("branded numbers: standard set", () => {
  const cases: Array<[unknown, boolean, boolean, boolean, boolean]> = [
    // value, PositiveNumber, Integer, PositiveInteger, NonNegativeInteger
    [1, true, true, true, true],
    [0, false, true, false, true],
    [-0, false, true, false, true],
    [-1, false, true, false, false],
    [0.5, true, false, false, false],
    [Infinity, true, false, false, false],
    [-Infinity, false, false, false, false],
    [NaN, false, false, false, false],
    [2 ** 53, true, false, false, false],
    [Number.MAX_SAFE_INTEGER, true, true, true, true],
    [-(2 ** 53), false, false, false, false],
    ["1", false, false, false, false],
    [null, false, false, false, false],
    [undefined, false, false, false, false],
    [1n, false, false, false, false],
  ];

  it("guards accept exactly the documented values, from unknown", () => {
    for (const [v, pn, int, pi, nni] of cases) {
      assert.equal(FU.isPositiveNumber(v), pn, `isPositiveNumber(${String(v)})`);
      assert.equal(FU.isInteger(v), int, `isInteger(${String(v)})`);
      assert.equal(FU.isPositiveInteger(v), pi, `isPositiveInteger(${String(v)})`);
      assert.equal(FU.isNonNegativeInteger(v), nni, `isNonNegativeInteger(${String(v)})`);
    }
  });

  it("Result constructors name the first failed rule", () => {
    assert.deepEqual(FU.positiveNumber(2), [true, 2]);
    assert.deepEqual(FU.positiveNumber(0), [false, "not-positive"]);
    assert.deepEqual(FU.positiveNumber(NaN), [false, "not-positive"]);
    assert.deepEqual(FU.integer(-7), [true, -7]);
    assert.deepEqual(FU.integer(0.5), [false, "not-integer"]);
    assert.deepEqual(FU.integer(NaN), [false, "not-integer"]);
    assert.deepEqual(FU.integer(Infinity), [false, "not-integer"]);
    assert.deepEqual(FU.integer(2 ** 53), [false, "unsafe-integer"]);
    assert.deepEqual(FU.positiveInteger(3), [true, 3]);
    assert.deepEqual(FU.positiveInteger(0), [false, "not-positive"]);
    assert.deepEqual(FU.positiveInteger(-4), [false, "not-positive"]);
    assert.deepEqual(FU.positiveInteger(1.5), [false, "not-integer"]);
    assert.deepEqual(FU.positiveInteger(2 ** 60), [false, "unsafe-integer"]);
    assert.deepEqual(FU.nonNegativeInteger(0), [true, 0]);
    assert.deepEqual(FU.nonNegativeInteger(-1), [false, "negative"]);
    assert.deepEqual(FU.nonNegativeInteger(-0.5), [false, "not-integer"]);
    assert.deepEqual(FU.nonNegativeInteger(-(2 ** 60)), [false, "unsafe-integer"]);
  });

  it("Exn constructors throw RangeError with the Result's literal as cause", () => {
    const pairs: Array<[(n: number) => unknown, (n: number) => FU_Result, number]> = [
      [FU.positiveNumberExn, FU.positiveNumber, -1],
      [FU.integerExn, FU.integer, 0.5],
      [FU.integerExn, FU.integer, 2 ** 53],
      [FU.positiveIntegerExn, FU.positiveInteger, 0],
      [FU.positiveIntegerExn, FU.positiveInteger, 1.5],
      [FU.nonNegativeIntegerExn, FU.nonNegativeInteger, -1],
      [FU.nonNegativeIntegerExn, FU.nonNegativeInteger, 2 ** 53],
    ];
    for (const [exn, make, n] of pairs) {
      const [, code] = make(n);
      assert.throws(
        () => exn(n),
        (e: unknown) =>
          e instanceof RangeError && e.cause === code && e.message.includes(`(${code})`),
      );
    }
    assert.equal(FU.positiveIntegerExn(5), 5);
    assert.equal(FU.nonNegativeIntegerExn(0), 0);
    assert.equal(FU.integerExn(-2), -2);
    assert.equal(FU.positiveNumberExn(0.25), 0.25);
  });

  it("assertions: TypeError for a non-number, RangeError with cause otherwise", () => {
    const asserts = [
      FU.assertPositiveNumber,
      FU.assertInteger,
      FU.assertPositiveInteger,
      FU.assertNonNegativeInteger,
    ] as const;
    for (const a of asserts) {
      assert.throws(() => a("1"), TypeError);
      assert.throws(() => a(null), /got null/);
      assert.throws(() => a(NaN), RangeError);
    }
    assert.throws(() => FU.assertPositiveNumber(0), { cause: "not-positive" });
    assert.throws(() => FU.assertInteger(1.5), { cause: "not-integer" });
    assert.throws(() => FU.assertPositiveInteger(0), { cause: "not-positive" });
    assert.throws(() => FU.assertNonNegativeInteger(-1), { cause: "negative" });
    const x: unknown = 3;
    FU.assertPositiveInteger(x);
    const narrowed: FU.PositiveInteger = x; // compile-time: asserts narrowed unknown
    FU.assertPositiveNumber(1.5);
    FU.assertInteger(-1);
    FU.assertNonNegativeInteger(0);
    assert.equal(narrowed, 3);
  });

  it("brandError: TypeError without a code, RangeError with code, long strings cut", () => {
    const t = FU.brandError("K", undefined, 1);
    assert.ok(t instanceof TypeError);
    assert.equal(t.message, "Expected K, got number");
    const r = FU.brandError("K", "bad", "x".repeat(100));
    assert.ok(r instanceof RangeError);
    assert.equal(r.cause, "bad");
    assert.equal(r.message, `Expected K (bad), got "${"x".repeat(64)}…"`);
    assert.equal(FU.brandError("K", "bad", "ab").message, 'Expected K (bad), got "ab"');
  });
});

type FU_Result = readonly [boolean, unknown];

describe("refine", () => {
  type Slug = Branded<string, "Slug">;
  type SlugError = "empty" | "bad-char";
  const slugError = (v: string): SlugError | undefined =>
    v.length === 0 ? "empty" : /^[a-z0-9-]+$/.test(v) ? undefined : "bad-char";

  it("derives make / makeExn / is / assert from one check", () => {
    const Slug: FU.Refinement<string, Slug, SlugError> = FU.refine("Slug", slugError);
    assert.equal(Slug.kind, "Slug");
    assert.equal(Slug.check, slugError);
    assert.deepEqual(Slug.make("a-1"), [true, "a-1"]);
    assert.deepEqual(Slug.make(""), [false, "empty"]);
    assert.deepEqual(Slug.make("A"), [false, "bad-char"]);
    assert.equal(Slug.makeExn("a"), "a");
    assert.throws(() => Slug.makeExn("A"), { name: "RangeError", cause: "bad-char" });
    assert.equal(Slug.is("ok"), true);
    assert.equal(Slug.is("no way"), false);
    const raw: string = "fine";
    Slug.assert(raw);
    const s: Slug = raw;
    assert.throws(() => Slug.assert(""), {
      cause: "empty",
      message: 'Expected Slug (empty), got ""',
    });
    assert.equal(s, "fine");
  });

  it("normalize applies to make / makeExn only", () => {
    const Slug = FU.refine("Slug", slugError, (v: string) => v.toLowerCase());
    assert.deepEqual(Slug.make("Hello-1"), [true, "hello-1"]);
    assert.deepEqual(Slug.make("x y"), [false, "bad-char"]);
    assert.equal(Slug.makeExn("ABC"), "abc");
    assert.throws(() => Slug.makeExn(""), { cause: "empty" });
    assert.equal(Slug.is("Hello-1"), false);
  });

  it("infers the brand from the kind and keeps the error literals (type-level)", () => {
    const R = FU.refine("Slug", slugError);
    const typed: FU.Refinement<string, Slug, SlugError> = R;
    const [ok, v] = R.make("a");
    if (ok) {
      const slug: Slug = v;
      // @ts-expect-error a Slug is not another brand over string
      const other: Branded<string, "Other"> = slug;
      assert.equal(other, "a");
    } else {
      const e: SlugError = v;
      // @ts-expect-error the error is the literal union, not a narrower literal
      const only: "empty" = v;
      assert.fail(`${e}${only}`);
    }
    assert.equal(typed.kind, "Slug");
  });

  it("an assertion through an unannotated name is a compile error (TS2775)", () => {
    const R = FU.refine("Slug", slugError);
    const raw: string = "ok";
    // @ts-expect-error TS2775: assertions need an explicitly typed call target
    R.assert(raw);
    const assertSlug: FU.Assertion<string, Slug> = R.assert;
    assertSlug(raw);
    const s: Slug = raw;
    assert.equal(s, "ok");
  });

  it("stacks on a branded base and stays assignable to it", () => {
    type Revision = Branded<FU.PositiveInteger, "Revision">;
    const Revision: FU.Refinement<FU.PositiveInteger, Revision, "too-large"> = FU.refine(
      "Revision",
      (n: FU.PositiveInteger) => (n > 1000 ? "too-large" : undefined),
    );
    const n = FU.positiveIntegerExn(7);
    const r = Revision.makeExn(n);
    const base: FU.PositiveInteger = r;
    const num: number = r;
    const nn: NonNegativeInteger = r;
    // @ts-expect-error a PositiveInteger is not a Revision
    const back: Revision = n;
    assert.deepEqual(Revision.make(FU.positiveIntegerExn(2000)), [false, "too-large"]);
    assert.equal(base + num + nn + back, 28);
  });
});

describe("guards and assertions fit the Guard / Assertion types (type-level)", () => {
  it("an unknown-accepting guard narrows unknown and base-typed values", () => {
    const g: FU.Guard<number, FU.PositiveInteger> = FU.isPositiveInteger;
    const a: FU.Assertion<number, FU.Integer> = FU.assertInteger;
    const n: number = 4;
    if (g(n)) {
      const p: FU.PositiveInteger = n;
      assert.equal(p, 4);
    }
    a(n);
    const i: FU.Integer = n;
    const u: unknown = 2;
    if (FU.isNonNegativeInteger(u)) {
      const v: FU.NonNegativeInteger = u;
      // @ts-expect-error a NonNegativeInteger is not a PositiveInteger
      const w: FU.PositiveInteger = v;
      assert.equal(v + w, 4);
    }
    // @ts-expect-error a plain number is not an Integer
    const bad: FU.Integer = 5 as number;
    assert.equal(i + bad, 9);
  });
});
