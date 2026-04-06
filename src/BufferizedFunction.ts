import * as Queue from "./Queue.js";
import * as Ref from "./Ref.js";
import type { Fn, Fn1 } from "./FunctionUtils.js";

/**
 * Higher order function that returns a function that accumulates arguments from
 * individual calls and invokes `fn` with all accumulated arguments.
 *
 * Note: this function does not do any error handling so if an exception is thrown
 * during execution of `fn` over batch of arguments, it will turn into unhandled
 * exception. Error handling should be done inside `fn` itself.
 */
export function make<T>(fn: Fn1<T[]>): Fn<T[]> {
  /**
   * Mutable reference to a boolean flag that indicates whether the `worker`
   * function is scheduled to be executed.
   */
  const scheduled = Ref.make(false);
  const queue: Queue.Queue<T> = Queue.make();

  return function bufferizedFn(...args: T[]): void {
    for (let i = 0; i < args.length; i++) {
      Queue.push(queue, args[i]);
    }
    if (!scheduled.contents) {
      scheduled.contents = true;
      setTimeout(worker, 0, queue, fn, scheduled);
    }
  };
}

function worker<T>(queue: Queue.Queue<T>, fn: Fn1<T[]>, scheduled: Ref.RefCell<boolean>): void {
  scheduled.contents = false;
  fn.call(undefined, Queue.dumpToArray(queue));
}
