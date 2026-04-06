import * as Ref from "./Ref.js";
import type { Fn } from "./FunctionUtils.js";

/**
 * TimedFunction — leading-edge throttle and trailing-edge debounce.
 *
 * Both use a `Ref<ReturnType<typeof setTimeout> | undefined>` to hold timer
 * state rather than a plain closure variable. This keeps the timer handle
 * outside the returned function's closure, making the state mutation explicit
 * and the returned function itself allocation-free after construction.
 */

/**
 * Returns a throttled version of `fn` that fires at most once per `ms`
 * milliseconds (leading-edge: the first call in a quiet period fires
 * immediately; subsequent calls within the same window are dropped).
 *
 * @param fn - Function to throttle. Must not rely on `this`.
 * @param ms - Minimum interval between invocations, in milliseconds.
 */
export function throttle<T extends unknown[]>(fn: Fn<T>, ms: number): Fn<T> {
  const timer: Ref.RefCell<ReturnType<typeof setTimeout> | undefined> = Ref.make(void 0);

  return function throttled(...args: T): void {
    if (timer.contents !== undefined) return;
    Reflect.apply(fn, undefined, args);
    timer.contents = setTimeout(clearTimer, ms, timer);
  };
}

/**
 * Returns a debounced version of `fn` that fires only after `ms` milliseconds
 * of silence (trailing-edge: the call is postponed until no further calls
 * arrive within the window).
 *
 * @param fn - Function to debounce. Must not rely on `this`.
 * @param ms - Quiet-period duration in milliseconds.
 */
export function debounce<T extends unknown[]>(fn: Fn<T>, ms: number): Fn<T> {
  const timer: Ref.RefCell<ReturnType<typeof setTimeout> | undefined> = Ref.make(void 0);

  return function debounced(...args: T): void {
    if (timer.contents !== undefined) {
      clearTimeout(timer.contents);
    }
    timer.contents = setTimeout(fire, ms, fn, args, timer);
  };
}

function clearTimer(timer: Ref.RefCell<ReturnType<typeof setTimeout> | undefined>): void {
  timer.contents = void 0;
}

function fire<T extends unknown[]>(
  fn: Fn<T>,
  args: T,
  timer: Ref.RefCell<ReturnType<typeof setTimeout> | undefined>,
): void {
  timer.contents = void 0;
  Reflect.apply(fn, undefined, args);
}
