import { Fn, Fn1 } from "./FunctionUtils.js";
import { Queue } from "./Queue.js";
import * as Ref from "./Ref.js";

/**
 * Higher order function that returns a function that will only be called once per tick
 * with an array of all arguments passed to the returned function.
 *
 * Note: this functions does not do any error handling so if an exception is thrown
 * during exection of `fn` over batch of arguments, it will turn into unhandled
 * exception.
 */
export function make<T>(fn: Fn1<T[]>): Fn<T[]> {
  const scheduled = Ref.make<NodeJS.Timeout | null>(null);
  const queue = new Queue<T>();

  return function bufferizedFn(...args: T[]) {
    for (let i = 0; i < args.length; i++) {
      queue.push(args[i]);
    }
    if (scheduled.contents === null) {
      scheduled.contents = setTimeout(worker, 0, queue, fn, scheduled);
    }
  };
}

function worker<T>(
  queue: Queue<T>,
  fn: Fn1<T[]>,
  scheduled: Ref.RefCell<NodeJS.Timeout | null>
) {
  scheduled.contents = null;
  Reflect.apply(fn, null, [queue.dumpToArray()]);
}
