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

/** Tagged union type. */
export type TaggedUnion<T> = {
  [P in keyof T]: { readonly tag: P; readonly value: T[P] };
}[keyof T];

/**
 * Branded type — attaches a phantom brand to `Base` so that two values of the
 * same underlying type but different brands are not assignable to each other.
 *
 * `Kind` is constrained to `PropertyKey` so it can serve as a mapped-type key.
 * The brand uses a mapped type `{ [K in Kind]: true }` so that intersecting two
 * branded types merges their brands, enabling compound types:
 *
 * ```ts
 * type PositiveNumber  = Branded<number, 'PositiveNumber'>
 * type Integer         = Branded<number, 'Integer'>
 * type PositiveInteger = PositiveNumber & Integer
 * // = number & { __brand: { PositiveNumber: true; Integer: true } }
 * // A PositiveInteger is assignable to both PositiveNumber and Integer ✓
 * ```
 */
export type Branded<Base, Kind extends PropertyKey> = Base & {
  readonly __brand: { readonly [K in Kind]: true };
};

/**
 * Zero-runtime-cost cast that asserts `value` is a `Branded<Base, Kind>`.
 *
 * The caller is responsible for ensuring the invariant holds at the call site.
 * This function compiles away entirely — it emits no instructions.
 */
export function brand<Base, Kind extends PropertyKey>(value: Base): Branded<Base, Kind> {
  return value as Branded<Base, Kind>;
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
export function pipe(...fns: ((...args: any) => any)[]): Fn<unknown[], unknown>;
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
    default: {
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
  }
}
