/**
 * BufferizedFunction — batches individual calls into a single deferred
 * invocation.
 *
 * Returns a function that accumulates arguments from individual calls into a
 * Queue and fires `fn` with the collected batch on the next event-loop
 * boundary. The scheduling mode controls when the batch fires:
 *
 * - `"macrotask"` (default): fires on the next macrotask via `setTimeout(0)`.
 *   Collects all synchronous calls in the current turn before firing.
 *   Best for fire-and-forget batching (logging, analytics, telemetry).
 *
 * - `"io"`: fires via `setImmediate` at the end of the current I/O poll
 *   phase, before timers. Near-zero delay — fires as soon as the current
 *   batch of I/O callbacks finishes. Best for latency-sensitive batching
 *   (e.g., HTTP request handling) where `setTimeout(0)` adds 1-4ms.
 *
 * When to use: fire-and-forget batching where callers do not need per-item
 * results. When callers need per-item return values or per-item rejection,
 * use BatchExecutor instead.
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
 *
 * // Low-latency mode for I/O-bound workloads:
 * const fast = BufferizedFunction.make(processBatch, "io");
 * ```
 */

import * as Queue from "./Queue.js";
import * as Ref from "./Ref.js";
import type { Fn, Fn1 } from "./FunctionUtils.js";

/**
 * Scheduling mode for batch execution.
 * - `"macrotask"`: `setTimeout(0)` — next macrotask (default)
 * - `"io"`: `setImmediate` — end of current I/O poll phase (lower latency)
 */
export type ScheduleMode = "macrotask" | "io";

export function make<T>(fn: Fn1<T[]>, schedule?: ScheduleMode): Fn<T[]> {
  /**
   * Mutable reference to a boolean flag that indicates whether the `worker`
   * function is scheduled to be executed.
   */
  const scheduled = Ref.make(false);
  const queue: Queue.Queue<T> = Queue.make();
  const scheduler = schedule === "io" ? scheduleIO : scheduleMacrotask;

  return function bufferizedFn(...args: T[]): void {
    for (let i = 0; i < args.length; i++) {
      Queue.push(queue, args[i]);
    }
    if (!scheduled.contents) {
      scheduled.contents = true;
      scheduler(queue, fn, scheduled);
    }
  };
}

function scheduleMacrotask<T>(
  queue: Queue.Queue<T>, fn: Fn1<T[]>, scheduled: Ref.RefCell<boolean>,
): void {
  setTimeout(worker, 0, queue, fn, scheduled);
}

function scheduleIO<T>(
  queue: Queue.Queue<T>, fn: Fn1<T[]>, scheduled: Ref.RefCell<boolean>,
): void {
  setImmediate(worker, queue, fn, scheduled);
}

function worker<T>(queue: Queue.Queue<T>, fn: Fn1<T[]>, scheduled: Ref.RefCell<boolean>): void {
  scheduled.contents = false;
  fn.call(undefined, Queue.dumpToArray(queue));
}
