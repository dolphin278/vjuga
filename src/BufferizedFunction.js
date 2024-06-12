import * as Queue from "./Queue.js";
import * as Ref from "./Ref.js";
import * as FU from "./FunctionUtils.js";

/**
 * Higher order function that returns a function that accumulates arguments from
 * individual calls and invokes `fn` with all accumulated arguments.
 *
 * Note: this functions does not do any error handling so if an exception is thrown
 * during exection of `fn` over batch of arguments, it will turn into unhandled
 * exception. Error handling should be done inside `fn` itself.
 *
 * @template T
 * @param {FU.Fn1<T[]>} fn
 * @returns {FU.Fn<T[]>}
 */
export function make(fn) {
  /**
   * Mutable reference to a boolean flag that indicates whether the `worker`
   * function is scheduled to be executed.
   */
  const scheduled = Ref.make(false);
  /** @type {Queue.Queue<T>} */
  const queue = Queue.make();

  /**
   * @param {T[]} args
   */
  return function bufferizedFn(...args) {
    for (let i = 0; i < args.length; i++) {
      Queue.push(queue, args[i]);
    }
    if (!scheduled.contents) {
      scheduled.contents = true;
      setTimeout(worker, 0, queue, fn, scheduled);
    }
  };
}

/**
 * @template T
 * @param {Queue.Queue<T>} queue
 * @param {FU.Fn1<T[]>} fn
 * @param {Ref.RefCell<boolean>} scheduled
 */
function worker(queue, fn, scheduled) {
  scheduled.contents = false;
  Reflect.apply(fn, null, [Queue.dumpToArray(queue)]);
}
