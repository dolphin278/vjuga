/**
 * FunctionUtils — foundational function types, branded-type utilities, and
 * left-to-right function composition.
 *
 * All function types (`Fn`, `Fn0`, `Fn1`, `Fn2`, `Predicate`, `Lazy`) bind
 * `this: void` to prevent accidental context leaks. `Branded<Base, Kind>`
 * attaches a phantom brand under a module-private `unique symbol` key, so no
 * object literal outside this module can forge one, and intersecting two
 * branded types merges their brands — enabling compound types like
 * `PositiveInteger` (= `PositiveNumber & Integer`).
 *
 * Every branded type in vjuga has the same four functions, here for
 * `PositiveInteger`: `positiveInteger(n)` → `Result<PositiveInteger,
 * PositiveIntegerError>` (one string literal per rule), `positiveIntegerExn(n)`
 * → the value or a RangeError whose `cause` is that literal,
 * `isPositiveInteger(x: unknown)` guard, `assertPositiveInteger(x: unknown)`.
 * Guards and assertions never normalise; constructors may. `refine` derives
 * the same set for your own brand from one check function.
 *
 * When to use: `Fn` / `Fn1` / `Fn2` as callback types throughout the library.
 * Branded types for domain values that need compile-time distinction. `pipe`
 * for left-to-right composition of 2–5 functions with full type inference.
 *
 * @example
 * ```ts
 * import { pipe, positiveIntegerExn, type Fn1 } from "@dolphin278/vjuga/FunctionUtils";
 * const inc: Fn1<number, number> = (n) => n + 1;
 * pipe(inc, inc)(3); // 5
 * const id = positiveIntegerExn(42); // PositiveInteger (branded number)
 * ```
 */

import { type Result, ok, err } from "./Result.js";

/**
 * Root function type that is independent of the context in which it is called.
 * Hence, it is a function that does not have `this` parameter.
 */
export type Fn<T extends readonly unknown[], R = void> = (this: void, ...args: T) => R;

/** Function of arity 0. */
export type Fn0<R> = Fn<[], R>;

/** Function of arity 1. */
export type Fn1<T, R = void> = Fn<[T], R>;

/** Widely used function for logic predicates. */
export type Predicate<T> = Fn1<T, boolean>;

/** Function of arity 2. */
export type Fn2<T1, T2, R = void> = Fn<[T1, T2], R>;

/** Lazily evaluated value. */
export type Lazy<T> = Fn0<T>;

/**
 * Phantom key of every brand. Declared, never defined or exported: it has no
 * runtime value and code outside this module cannot import it. Its type is
 * still reachable through `keyof`, but a value of that type needs a cast or a
 * `declare`, so a branded value always comes from an explicit assertion
 * (`brand()`, a constructor, a type guard, or `as`). Each installed copy of vjuga declares its own symbol, so brands from
 * two copies of the package in one dependency tree are mutually unassignable.
 */
declare const brandKey: unique symbol;

/**
 * Branded type — attaches a phantom brand to `Base` so that two values of the
 * same underlying type but different brands are not assignable to each other.
 *
 * The brand is a record of kinds under the private `brandKey` symbol, so
 * intersecting two branded types merges their records, enabling compound types:
 *
 * ```ts
 * type PositiveNumber  = Branded<number, 'PositiveNumber'>
 * type Integer         = Branded<number, 'Integer'>
 * type PositiveInteger = PositiveNumber & Integer
 * // = number & { [brandKey]: { PositiveNumber: true } & { Integer: true } }
 * // A PositiveInteger is assignable to both PositiveNumber and Integer ✓
 * ```
 *
 * Why a symbol key: a string key (`__brand_<Kind>: true`, used up to v12) lets
 * an object literal forge the brand of an object base with no cast. Why a
 * record rather than `[brandKey]: Kind`: `"A" & "B"` is `never`, so compound
 * brands would collapse. Spreading a branded object (`{ ...f, id: "y" }`) keeps
 * the key and so keeps the brand; re-validate if a spread can break the
 * invariant. scriptc 0.4.9 compiles this shape for primitive, object and
 * stacked brands (scripts/scriptc-smoke/brands.ts).
 */
export type Branded<Base, Kind extends string> = Base & {
  readonly [brandKey]: { readonly [K in Kind]: true };
};

/**
 * Zero-runtime-cost cast that asserts `value` is a `Branded<Base, Kind>`.
 *
 * The caller is responsible for ensuring the invariant holds at the call site.
 * At runtime it is an identity function; the call is trivially inlined by the
 * JIT but is not erased from the emitted JavaScript.
 */
export function brand<Base, Kind extends string>(value: Base): Branded<Base, Kind> {
  return value as Branded<Base, Kind>;
}

/**
 * A type guard: `true` exactly when `value` is a `T`. Checks, never repairs.
 * A guard that accepts `unknown` (every built-in one does) fits any `Base`.
 *
 * @example
 * ```ts
 * import { isPositiveInteger, type Guard, type PositiveInteger } from "@dolphin278/vjuga/FunctionUtils";
 * const g: Guard<number, PositiveInteger> = isPositiveInteger;
 * ```
 */
export type Guard<Base, T extends Base> = (this: void, value: Base) => value is T;

/**
 * An assertion function: returns when `value` is a `T`, throws otherwise.
 *
 * TypeScript honours `asserts` only through a name declared with an explicit
 * type (error TS2775 otherwise), so annotate a stored assertion:
 * `const assertSlug: Assertion<string, Slug> = Slug.assert`.
 *
 * @example
 * ```ts
 * import { assertPositiveInteger, type Assertion, type PositiveInteger } from "@dolphin278/vjuga/FunctionUtils";
 * const check: Assertion<unknown, PositiveInteger> = assertPositiveInteger;
 * ```
 */
export type Assertion<Base, T extends Base> = (this: void, value: Base) => asserts value is T;

/**
 * The error an assertion throws for a value that is not a `kind`:
 * `TypeError` when `code` is `undefined` (the value has the wrong base type),
 * else `RangeError` whose message names the failed rule and whose `cause` is
 * that rule's literal (the `Err` payload of the matching Result constructor). A string value is
 * quoted and cut to 64 characters. Use it in hand-written assertions so they
 * throw what the built-in ones do.
 *
 * @example
 * ```ts
 * import { brandError } from "@dolphin278/vjuga/FunctionUtils";
 * const e = brandError("PositiveInteger", "not-positive", 0);
 * e.message; // "Expected PositiveInteger (not-positive), got 0"
 * e.cause;   // "not-positive"
 * brandError("PositiveInteger", undefined, "1") instanceof TypeError; // true
 * ```
 */
export function brandError(
  kind: string,
  code: string | undefined,
  value: unknown,
): TypeError | RangeError {
  if (code === undefined) {
    return new TypeError(`Expected ${kind}, got ${value === null ? "null" : typeof value}`);
  }
  return new RangeError(`Expected ${kind} (${code}), got ${describe(value)}`, { cause: code });
}

/** A value for an error message; called only with the base types of brands. */
function describe(value: unknown): string {
  if (typeof value !== "string") return String(value);
  return JSON.stringify(value.length > 64 ? value.slice(0, 64) + "…" : value);
}

/**
 * The standard functions of a refined (branded) type, built by `refine`.
 * `check` is the one rule set; the others are derived from it.
 */
export interface Refinement<Base, T extends Base, E extends string> {
  /** The brand kind, used in assertion messages. */
  readonly kind: string;
  /** The first failed rule for `value`, or `undefined` when it is a `T`. */
  readonly check: (this: void, value: Base) => E | undefined;
  /** Guard: `check(value) === undefined`. Never normalises. */
  readonly is: Guard<Base, T>;
  /** Assertion: throws `brandError(kind, check(value), value)` (a RangeError). Never normalises. */
  readonly assert: Assertion<Base, T>;
  /** Result constructor: Ok with the (normalised, if `normalize` was given) value, or Err with the failed rule. */
  readonly make: (this: void, value: Base) => Result<T, E>;
  /** Throwing constructor: the value `make` would return, or the RangeError `assert` throws. */
  readonly makeExn: (this: void, value: Base) => T;
}

/**
 * Derives the standard set of a brand (Result constructor `make`, throwing
 * constructor `makeExn`, guard `is`, assertion `assert`) from one check
 * function that returns the first failed rule (a string literal) or
 * `undefined`. The brand is `Branded<Base, Kind>`; `Base` may itself be
 * branded (a check on `PositiveInteger` gives a type assignable to
 * `PositiveInteger`). With `normalize` (trim, case-fold), `make` and
 * `makeExn` normalise before checking; `is` and `assert` never do.
 *
 * Performance: the derived functions are closures made once, here, and every
 * refinement's `is` shares one `check(value)` call site. With one refinement
 * in use it runs as fast as a hand-written guard; with six in use that site is
 * polymorphic and V8 stops inlining `check` (`src/benchmarks/Brands.bench.ts`:
 * ~3.8x slower than six hand-written guards on Node 26, ~2.5x on Bun 1.4). On
 * a hot path write the guard as a top-level function over the same check:
 * `function isSlug(v: string): v is Slug { return slugError(v) === undefined; }`.
 *
 * Annotate the result with its type: TypeScript refuses an assertion called
 * through an unannotated name (TS2775).
 *
 * @example
 * ```ts
 * import { refine, type Branded, type Refinement } from "@dolphin278/vjuga/FunctionUtils";
 * type Slug = Branded<string, "Slug">;
 * type SlugError = "empty" | "bad-char";
 * const slugError = (v: string): SlugError | undefined =>
 *   v.length === 0 ? "empty" : /^[a-z0-9-]+$/.test(v) ? undefined : "bad-char";
 * const Slug: Refinement<string, Slug, SlugError> = refine("Slug", slugError, (v) => v.toLowerCase());
 * Slug.make("Hello-1");  // [true, "hello-1"]
 * Slug.makeExn("x y");   // throws RangeError, cause "bad-char"
 * Slug.is("Hello-1");    // false: guards never normalise
 * Slug.assert(input);    // narrows `input: string` to Slug, or throws RangeError
 * ```
 */
export function refine<Base, const Kind extends string, E extends string>(
  kind: Kind,
  check: (value: Base) => E | undefined,
  normalize?: (value: Base) => Base,
): Refinement<Base, Branded<Base, Kind>, E> {
  type T = Branded<Base, Kind>;
  const is = (value: Base): value is T => check(value) === undefined;
  const assert: Assertion<Base, T> = (value) => {
    const e = check(value);
    if (e !== undefined) throw brandError(kind, e, value);
  };
  // `check(v) === undefined` is the guard, so the casts restate it (narrowing
  // through `is` would run `check` twice). Two closures rather than a
  // `normalize === undefined` test on every call.
  const make =
    normalize === undefined
      ? (value: Base): Result<T, E> => {
          const e = check(value);
          return e === undefined ? ok(value as T) : err(e);
        }
      : (value: Base): Result<T, E> => {
          const v = normalize(value);
          const e = check(v);
          return e === undefined ? ok(v as T) : err(e);
        };
  const makeExn =
    normalize === undefined
      ? (value: Base): T => {
          const e = check(value);
          if (e !== undefined) throw brandError(kind, e, value);
          return value as T;
        }
      : (value: Base): T => {
          const v = normalize(value);
          const e = check(v);
          if (e !== undefined) throw brandError(kind, e, value);
          return v as T;
        };
  return { kind, check, is, assert, make, makeExn };
}

// ---------------------------------------------------------------------------
// Branded numbers. Per type X: `x(number)` → Result<X, XError>,
// `xExn(number)` → X or throw, `isX(unknown)` guard, `assertX(unknown)`
// assertion. All are hand-written top-level
// functions (not `refine`), so each call site stays monomorphic and the guard
// inlines. Failures are classified only after the guard says no.
// ---------------------------------------------------------------------------

/** A number that is strictly greater than zero (`Infinity` included, NaN not). */
export type PositiveNumber = Branded<number, "PositiveNumber">;

/** A number that is a safe integer (no fractional part, |n| <= 2^53 - 1). */
export type Integer = Branded<number, "Integer">;

/** A number that is both positive and a safe integer (>= 1). */
export type PositiveInteger = PositiveNumber & Integer & NonNegativeInteger;

/** A number that is a non-negative safe integer (>= 0). */
export type NonNegativeInteger = Branded<number, "NonNegativeInteger"> & Integer;

/** Why a number is not a `PositiveNumber`: it is `<= 0` or NaN. */
export type PositiveNumberError = "not-positive";

/** Why a number is not an `Integer`: a fraction, NaN or ±Infinity; or an integer beyond ±(2^53 - 1). */
export type IntegerError = "not-integer" | "unsafe-integer";

/** Why a number is not a `NonNegativeInteger`. */
export type NonNegativeIntegerError = IntegerError | "negative";

/** Why a number is not a `PositiveInteger` (`0` is `"not-positive"`). */
export type PositiveIntegerError = IntegerError | "not-positive";

/**
 * Guard: `value` is a number `> 0`. Accepts `unknown`, so it also checks
 * input at a boundary.
 *
 * @example
 * ```ts
 * import { isPositiveNumber } from "@dolphin278/vjuga/FunctionUtils";
 * isPositiveNumber(0.5); // true
 * isPositiveNumber(0);   // false
 * isPositiveNumber("1"); // false
 * ```
 */
export function isPositiveNumber(value: unknown): value is PositiveNumber {
  return typeof value === "number" && value > 0;
}

/**
 * Guard: `value` is a safe integer.
 *
 * @example
 * ```ts
 * import { isInteger } from "@dolphin278/vjuga/FunctionUtils";
 * isInteger(-3);      // true
 * isInteger(1.5);     // false
 * isInteger(2 ** 53); // false: not safe
 * ```
 */
export function isInteger(value: unknown): value is Integer {
  return Number.isSafeInteger(value);
}

/**
 * Guard: `value` is a safe integer `>= 1` (a natural number counted from 1).
 *
 * @example
 * ```ts
 * import { isPositiveInteger } from "@dolphin278/vjuga/FunctionUtils";
 * isPositiveInteger(1); // true
 * isPositiveInteger(0); // false
 * ```
 */
export function isPositiveInteger(value: unknown): value is PositiveInteger {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Guard: `value` is a safe integer `>= 0`.
 *
 * @example
 * ```ts
 * import { isNonNegativeInteger } from "@dolphin278/vjuga/FunctionUtils";
 * isNonNegativeInteger(0);  // true
 * isNonNegativeInteger(-1); // false
 * ```
 */
export function isNonNegativeInteger(value: unknown): value is NonNegativeInteger {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The rule a number that is not a safe integer breaks. */
function integerError(n: number): IntegerError {
  return Number.isInteger(n) ? "unsafe-integer" : "not-integer";
}

function positiveIntegerError(n: number): PositiveIntegerError {
  return Number.isSafeInteger(n) ? "not-positive" : integerError(n);
}

function nonNegativeIntegerError(n: number): NonNegativeIntegerError {
  return Number.isSafeInteger(n) ? "negative" : integerError(n);
}

/**
 * Result constructor for `PositiveNumber`.
 *
 * @example
 * ```ts
 * import { positiveNumber } from "@dolphin278/vjuga/FunctionUtils";
 * positiveNumber(2);  // [true, 2]
 * positiveNumber(-1); // [false, "not-positive"]
 * ```
 */
export function positiveNumber(n: number): Result<PositiveNumber, PositiveNumberError> {
  return isPositiveNumber(n) ? ok(n) : err("not-positive");
}

/**
 * Result constructor for `Integer`.
 *
 * @example
 * ```ts
 * import { integer } from "@dolphin278/vjuga/FunctionUtils";
 * integer(-7);      // [true, -7]
 * integer(0.5);     // [false, "not-integer"]
 * integer(2 ** 53); // [false, "unsafe-integer"]
 * ```
 */
export function integer(n: number): Result<Integer, IntegerError> {
  return isInteger(n) ? ok(n) : err(integerError(n));
}

/**
 * Result constructor for `PositiveInteger`.
 *
 * @example
 * ```ts
 * import { positiveInteger } from "@dolphin278/vjuga/FunctionUtils";
 * positiveInteger(3);   // [true, 3]
 * positiveInteger(0);   // [false, "not-positive"]
 * positiveInteger(1.5); // [false, "not-integer"]
 * ```
 */
export function positiveInteger(n: number): Result<PositiveInteger, PositiveIntegerError> {
  return isPositiveInteger(n) ? ok(n) : err(positiveIntegerError(n));
}

/**
 * Result constructor for `NonNegativeInteger`.
 *
 * @example
 * ```ts
 * import { nonNegativeInteger } from "@dolphin278/vjuga/FunctionUtils";
 * nonNegativeInteger(0);  // [true, 0]
 * nonNegativeInteger(-1); // [false, "negative"]
 * ```
 */
export function nonNegativeInteger(n: number): Result<NonNegativeInteger, NonNegativeIntegerError> {
  return isNonNegativeInteger(n) ? ok(n) : err(nonNegativeIntegerError(n));
}

/**
 * Assertion for `PositiveNumber`: TypeError for a non-number, RangeError
 * naming the failed rule otherwise.
 *
 * @example
 * ```ts
 * import { assertPositiveNumber } from "@dolphin278/vjuga/FunctionUtils";
 * const x: unknown = 2.5;
 * assertPositiveNumber(x); // x: PositiveNumber from here on
 * ```
 */
export function assertPositiveNumber(value: unknown): asserts value is PositiveNumber {
  if (!isPositiveNumber(value)) {
    throw brandError(
      "PositiveNumber",
      typeof value === "number" ? "not-positive" : undefined,
      value,
    );
  }
}

/**
 * Assertion for `Integer`.
 *
 * @example
 * ```ts
 * import { assertInteger } from "@dolphin278/vjuga/FunctionUtils";
 * assertInteger(1.5); // throws RangeError: Expected Integer (not-integer), got 1.5
 * ```
 */
export function assertInteger(value: unknown): asserts value is Integer {
  if (!isInteger(value)) {
    throw brandError("Integer", typeof value === "number" ? integerError(value) : undefined, value);
  }
}

/**
 * Assertion for `PositiveInteger`.
 *
 * @example
 * ```ts
 * import { assertPositiveInteger } from "@dolphin278/vjuga/FunctionUtils";
 * assertPositiveInteger(0); // throws RangeError: Expected PositiveInteger (not-positive), got 0
 * ```
 */
export function assertPositiveInteger(value: unknown): asserts value is PositiveInteger {
  if (!isPositiveInteger(value)) {
    const code = typeof value === "number" ? positiveIntegerError(value) : undefined;
    throw brandError("PositiveInteger", code, value);
  }
}

/**
 * Assertion for `NonNegativeInteger`.
 *
 * @example
 * ```ts
 * import { assertNonNegativeInteger } from "@dolphin278/vjuga/FunctionUtils";
 * assertNonNegativeInteger(-1); // throws RangeError: Expected NonNegativeInteger (negative), got -1
 * ```
 */
export function assertNonNegativeInteger(value: unknown): asserts value is NonNegativeInteger {
  if (!isNonNegativeInteger(value)) {
    const code = typeof value === "number" ? nonNegativeIntegerError(value) : undefined;
    throw brandError("NonNegativeInteger", code, value);
  }
}

/**
 * Throwing constructor for `PositiveNumber`: returns `n`, or throws the
 * RangeError `assertPositiveNumber` throws (`cause` is the rule literal).
 *
 * @example
 * ```ts
 * import { positiveNumberExn } from "@dolphin278/vjuga/FunctionUtils";
 * positiveNumberExn(0.5); // 0.5 as PositiveNumber
 * positiveNumberExn(0);   // throws RangeError: Expected PositiveNumber (not-positive), got 0
 * ```
 */
export function positiveNumberExn(n: number): PositiveNumber {
  if (!isPositiveNumber(n)) throw brandError("PositiveNumber", "not-positive", n);
  return n;
}

/**
 * Throwing constructor for `Integer`.
 *
 * @example
 * ```ts
 * import { integerExn } from "@dolphin278/vjuga/FunctionUtils";
 * integerExn(-3);  // -3 as Integer
 * integerExn(0.5); // throws RangeError: Expected Integer (not-integer), got 0.5
 * ```
 */
export function integerExn(n: number): Integer {
  if (!isInteger(n)) throw brandError("Integer", integerError(n), n);
  return n;
}

/**
 * Throwing constructor for `PositiveInteger`.
 *
 * @example
 * ```ts
 * import { positiveIntegerExn } from "@dolphin278/vjuga/FunctionUtils";
 * positiveIntegerExn(42); // 42 as PositiveInteger
 * positiveIntegerExn(0);  // throws RangeError: Expected PositiveInteger (not-positive), got 0
 * ```
 */
export function positiveIntegerExn(n: number): PositiveInteger {
  if (!isPositiveInteger(n)) throw brandError("PositiveInteger", positiveIntegerError(n), n);
  return n;
}

/**
 * Throwing constructor for `NonNegativeInteger`.
 *
 * @example
 * ```ts
 * import { nonNegativeIntegerExn } from "@dolphin278/vjuga/FunctionUtils";
 * nonNegativeIntegerExn(0);  // 0 as NonNegativeInteger
 * nonNegativeIntegerExn(-1); // throws RangeError: Expected NonNegativeInteger (negative), got -1
 * ```
 */
export function nonNegativeIntegerExn(n: number): NonNegativeInteger {
  if (!isNonNegativeInteger(n)) {
    throw brandError("NonNegativeInteger", nonNegativeIntegerError(n), n);
  }
  return n;
}

/**
 * Partially applied function application.
 */
export function partial<T1 extends unknown[], T2 extends unknown[], R>(
  fn: Fn<[...T1, ...T2], R>,
  ...args: T1
): Fn<T2, R> {
  return Function.prototype.bind.call(fn, void 0, ...args) as Fn<T2, R>;
}

/**
 * Partial application for function whose arguments are put in object. This
 * pattern often used to simulate named arguments.
 */
export function partialNamed<T extends object, U extends keyof T, R>(
  fn: Fn1<T, R>,
  args: Pick<T, U>,
): Fn1<Omit<T, U>, R> {
  return (rest) => fn({ ...args, ...rest } as T);
}

/**
 * Variadic function that returns all of its arguments as an array (tuple).
 */
export function tuple<T extends unknown[]>(...args: T): T {
  return args;
}

/**
 * Function `tupled` takes a function of multiple arguments and returns a
 * function that takes a single argument of type tuple.
 */
export function tupled<T extends unknown[], R>(fn: Fn<T, R>): Fn1<T, R> {
  return (args) => Reflect.apply(fn, void 0, args);
}

/**
 * Function `spread` takes a function of a single argument of tuple type and
 * returns a function that takes multiple arguments.
 */
export function spread<T extends unknown[], R>(fn: Fn1<T, R>): Fn<T, R> {
  return (...args) => fn(args);
}

/**
 * `unreachable` is a function that can be used to mark unreachable code paths
 * to trigger compiler errors if the code becomes possible to reach.
 */
export function unreachable(_: never): never {
  throw new Error("unreachable");
}

/**
 * Pipe describes type of left-to-right function composition.
 */
export type Pipe<T> = T extends [
  Fn<infer A, infer _B>, // _B is unified across both infer positions to constrain fn chaining
  Fn1<infer _B, infer C>,
  ...infer Rest,
]
  ? Pipe<[Fn<A, C>, ...Rest]>
  : T extends [Fn<infer A, infer B>]
    ? Fn<A, B>
    : never;

/**
 * Left to right function composition.
 */
// prettier-ignore
export function pipe<A extends unknown[], B>(fn0: Fn<A, B>): Fn<A, B>;
// prettier-ignore
export function pipe<A extends unknown[], B, C>(fn0: Fn<A, B>, fn1: Fn1<B, C>): Fn<A, C>;
// prettier-ignore
export function pipe<A extends unknown[], B, C, D>(fn0: Fn<A, B>, fn1: Fn1<B, C>, fn2: Fn1<C, D>): Fn<A, D>;
// prettier-ignore
export function pipe<A extends unknown[], B, C, D, E>(fn0: Fn<A, B>, fn1: Fn1<B, C>, fn2: Fn1<C, D>, fn3: Fn1<D, E>): Fn<A, E>;
// prettier-ignore
export function pipe<A extends unknown[], B, C, D, E, F>(fn0: Fn<A, B>, fn1: Fn1<B, C>, fn2: Fn1<C, D>, fn3: Fn1<D, E>, fn4: Fn1<E, F>): Fn<A, F>;
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pipe(...fns: [((...args: any) => any), ...((...args: any) => any)[]]): Fn<unknown[], unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pipe(...fns: ((...args: any[]) => any)[]): (...args: unknown[]) => unknown {
  switch (fns.length) {
    case 0:
      throw new Error("pipe: no functions provided");
    case 1:
      return fns[0] as Fn<unknown[], unknown>;
    case 2: {
      // (...x) => spread allocates Array per call; supports multi-arity first fn
      const fn0 = fns[0];
      const fn1 = fns[1];
      return (...x) => fn1(fn0(...x));
    }
    case 3: {
      // (...x) => spread allocates Array per call; supports multi-arity first fn
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      return (...x) => fn2(fn1(fn0(...x)));
    }
    case 4: {
      // (...x) => spread allocates Array per call; supports multi-arity first fn
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      const fn3 = fns[3];
      return (...x) => fn3(fn2(fn1(fn0(...x))));
    }
    case 5: {
      // (...x) => spread allocates Array per call; supports multi-arity first fn
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      const fn3 = fns[3];
      const fn4 = fns[4];
      return (...x) => fn4(fn3(fn2(fn1(fn0(...x)))));
    }
    default:
      // Extracted to avoid a `{}` block — Bun's coverage instrument marks the
      // closing `}` of a default: block as uncovered when the block only contains
      // a `return` statement (oven-sh/bun#16148).
      return pipeVariadic(fns);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pipeVariadic(fns: ((...args: any) => any)[]): (...args: unknown[]) => unknown {
  const call = Function.prototype.call;
  const apply = Function.prototype.apply;
  return (...x) => {
    let result: unknown = apply.call(fns[0], void 0, x);
    for (let i = 1; i < fns.length; i++) {
      result = call.call(fns[i], void 0, result);
    }
    return result;
  };
}
