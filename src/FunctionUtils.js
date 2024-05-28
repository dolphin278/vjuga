/**
 * Root function type that is independent of the context in which it is called.
 * Hence, it is a function that does not have `this` parameter.
 *
 * @template {readonly unknown[]} T
 * @template [R=void]
 * @typedef {(this: void, ...args: T) => R} Fn
 */

/**
 * Function of arity 0.
 * @template R
 * @typedef {Fn<[], R>} Fn0
 */

/**
 * Function of arity 1.
 * @template T
 * @template [R=void]
 * @typedef {Fn<[T], R>} Fn1
 */

/**
 * Widely used function for logic predicates.
 * @template T
 * @typedef {Fn1<T, boolean>} Predicate
 */

/**
 * Function of arity 2.
 * @template T1
 * @template T2
 * @template [R=void]
 * @typedef {Fn<[T1, T2], R>} Fn2
 */

/**
 * Lazily evaluated value
 * @template T
 * @typedef {Fn0<T>} Lazy
 */

/**
 * Tagged union type.
 * @template T
 * @typedef {{ [P in keyof T]: {readonly tag: P, readonly value: T[P]}}[keyof T]} TaggedUnion
 */

/**
 * Partially applied function application.
 * @template {unknown[]} T1
 * @template {unknown[]} T2
 * @template R
 * @param {Fn<[...T1, ...T2], R>} fn
 * @param {T1} args
 * @returns {Fn<T2, R>}
 */
export function partial(fn, ...args) {
  return Function.prototype.bind.call(fn, void 0, ...args);
}

/**
 * Partial application for function whose arguments are put in object. This
 * pattern often used to simulate named arguments.
 *
 * @template {{}} T
 * @template {keyof T} U
 * @template R
 * @param {Fn1<T,R>} fn
 * @param {Pick<T, U>} args
 * @returns {Fn1<Omit<T, U>, R>}
 */
export function partialNamed(fn, args) {
  return (rest) => fn(/** @type {T} */ ({ ...args, ...rest }));
}

/**
 * Variadic function that returns all of its arguments as an array (tuple).
 * This function is useful when you compose functions should take multiple
 * arguments. This way all your functions can be unary and only the first
 * function in the composition chain will be variadic.
 *
 * @template {unknown[]} T
 * @param  {T} args
 * @returns {T}
 */
export function tuple(...args) {
  return args;
}

/**
 * Function `tupled` takes a function of multiple arguments and returns a
 * function that takes a single argument of type tuple.
 *
 * @template {unknown[]} T
 * @template R
 * @param {Fn<T, R>} fn Multi-argument function
 * @returns {Fn1<T,R>}
 */
export function tupled(fn) {
  return (args) => Reflect.apply(fn, void 0, args);
}

/**
 * Function `spread` takes a function of a single argument of tuple type and
 * returns a function that takes multiple arguments, each cor
 *
 * @template {unknown[]} T
 * @template R
 * @param {Fn1<T, R>} fn
 * @returns {Fn<T, R>}
 */
export function spread(fn) {
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
 * @param {never} _
 * @returns {never}
 */
export function unreachable(_) {
  throw new Error("unreachable");
}

/**
 * Pipe describes type of left-to-right function composition.
 *
 * @template T
 * @typedef {T extends [Fn<infer A, infer B>, Fn1<infer B, infer C>, ...infer Rest] ? Pipe<[Fn<A, C>, ...Rest]> :  T extends [Fn<infer A, infer B>] ? Fn<A, B> : never} Pipe
 */

/**
 * Left to right function composition. It takes a list of functions and returns
 * a new function that is the composition of those functions. The returned
 * function takes a variable number of arguments and applies the leftmost
 * function to the arguments, then applies the next function to the result, and
 * so on.
 *
 *
 *
 * @template {Fn<any, any>[]} T
 * @param  {T} fns
 * @returns {Pipe<T>}
 */
export function pipe(...fns) {
  switch (fns.length) {
    case 0:
      throw new Error("pipe: no functions provided");
    case 1:
      return /** @type {Pipe<T>} */ (fns[0]);
    case 2: {
      const fn0 = fns[0];
      const fn1 = fns[1];
      return /** @type {Pipe<T>} */ ((...x) => fn1(fn0(...x)));
    }
    case 3: {
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      return /** @type {Pipe<T>} */ ((...x) => fn2(fn1(fn0(...x))));
    }
    case 4: {
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      const fn3 = fns[3];
      return /** @type {Pipe<T>} */ ((...x) => fn3(fn2(fn1(fn0(...x)))));
    }
    case 5: {
      const fn0 = fns[0];
      const fn1 = fns[1];
      const fn2 = fns[2];
      const fn3 = fns[3];
      const fn4 = fns[4];
      return /** @type {Pipe<T>} */ ((...x) => fn4(fn3(fn2(fn1(fn0(...x))))));
    }
    default: {
      const call = Function.prototype.call;
      const apply = Function.prototype.apply;

      return /** @type {Pipe<T>} */ (
        (...x) => {
          let result = apply.call(fns[0], void 0, x);
          for (let i = 1; i < fns.length; i++) {
            result = call.call(fns[i], void 0, result);
          }
          return result;
        }
      );
    }
  }
}
