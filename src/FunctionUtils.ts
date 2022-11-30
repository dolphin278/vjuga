export type Fn<T extends readonly unknown[], R = void> = (
  this: void,
  ...args: T
) => R;

export type Fn0<R> = Fn<[], R>;

export type Fn1<T, R = void> = Fn<[T], R>;

export type Predicate<T> = Fn1<T, boolean>;

export type Fn2<T1, T2, R = void> = Fn<[T1, T2], R>;

export type Lazy<T> = Fn0<T>;

export type TaggedUnion<T> = {
  [P in keyof T]: {
    readonly tag: P;
    readonly value: T[P];
  };
}[keyof T];

export function partial<T1 extends unknown[], T2 extends unknown[], R>(
  fn: Fn<[...T1, ...T2], R>,
  ...args: T1
): Fn<T2, R> {
  return (fn as any).bind(void 0, ...args);
}

export function partialNamed<T, U extends keyof T, R>(
  fn: Fn1<T, R>,
  args: Pick<T, U>
) {
  return (rest: Omit<T, U>) => fn({ ...args, ...rest } as T);
}

export function tuple<T extends unknown[]>(...args: T) {
  return args;
}

export function tupled<T extends unknown[], R>(fn: Fn<T, R>): Fn1<T, R> {
  return (args) => Reflect.apply(fn, void 0, args);
}

export function spread<T extends unknown[], R>(fn: Fn1<T, R>): Fn<T, R> {
  return (...args) => fn(args);
}

/**
 * `unreachable` is a function that can be used to mark unreachable code paths
 * to trigger compiler errors if the code becomes possible to reach.
 *
 * For example, placing call to `unreachable` in default case of switch statement
 * will cause compiler error if the switch statement in not exhaustive.
 *
 * ```ts
 * declare const x: 'a' | 'b' | 'c';
 *
 * switch (x) {
 *   case 'a':
 *     return 'a';
 *   case 'b':
 *     return 'b';
 *   default:
 *     unreachable(x); // Error: Argument of type 'string' is not assignable to parameter of type 'never'.
 * }
 * ```
 */
export function unreachable(_: never): never {
  throw new Error("unreachable");
}

/**
 * Pipe describes type of left-to-right function composition.
 */
export type Pipe<T> = T extends [infer U]
  ? U
  : T extends [Fn<infer A, infer B>, Fn1<infer B, infer C>, ...infer Rest]
  ? Pipe<[Fn<A, C>, ...Rest]>
  : never;

export function pipe<T extends any[]>(...fns: T): Pipe<T> {
  switch (fns.length) {
    case 0:
      throw new Error("pipe: no functions provided");
    case 1:
      return fns[0];
    case 2:
      return ((...x: any[]) => fns[1](fns[0](...x))) as any;
    case 3:
      return ((...x: any[]) => fns[2](fns[1](fns[0](...x)))) as any;
    case 4:
      return ((...x: any[]) => fns[3](fns[2](fns[1](fns[0](...x))))) as any;
    case 5:
      return ((...x: any[]) =>
        fns[4](fns[3](fns[2](fns[1](fns[0](...x)))))) as any;
    default:
      return ((...x: any[]) => {
        let result = Reflect.apply(fns[0], void 0, x);
        for (let i = 1; i < fns.length; i++) {
          result = Reflect.apply(fns[i], void 0, [result]);
        }
        return result;
      }) as any;
  }
}
