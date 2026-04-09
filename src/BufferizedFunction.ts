/**
 * BufferizedFunction — batches individual calls into a single deferred
 * invocation.
 *
 * Returns a function that accumulates arguments from individual calls into a
 * Queue and fires `fn` with the collected batch on the next macrotask
 * (`setTimeout(worker, 0)`). Using a macrotask (not `queueMicrotask`) ensures
 * the batch collects all synchronous calls in the current turn before firing.
 *
 * When to use: fire-and-forget batching where callers do not need per-item
 * results (logging, analytics, telemetry). When callers need per-item return
 * values or per-item rejection, use BatchExecutor instead.
 *
 * Note: error handling is the caller's responsibility — if `fn` throws, the
 * exception becomes unhandled. Handle errors inside `fn` itself.
 *
 * @example
 * ```ts
 * import * as BufferizedFunction from "vjuga/BufferizedFunction";
 * const log = BufferizedFunction.make((batch: string[]) => sendLogs(batch));
 * log("a");
 * log("b");
 * // fn called once on next macrotask with ["a", "b"]
 * ```
 */

import * as Queue from "./Queue.js";
import * as Ref from "./Ref.js";
import type { Fn, Fn1 } from "./FunctionUtils.js";
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
