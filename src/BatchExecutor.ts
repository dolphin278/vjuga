/**
 * BatchExecutor — dataloader-style batching with per-item promise results.
 *
 * When to use: N concurrent callers each need an individual async result, but
 * the underlying work (DB query, HTTP call, RPC) is more efficient when
 * executed as a single batch. Unlike `BufferizedFunction`, each caller gets a
 * `Promise<R>` that resolves or rejects independently. Use `BufferizedFunction`
 * when callers do not need return values (fire-and-forget). No deduplication of
 * identical arguments — intentional side effects are supported.
 *
 * Options (`make(fn, "io")` or `make(fn, { schedule, maxBatchSize, maxInFlight })`):
 *   - `schedule`: `"macrotask"` (default, `setTimeout(0)`) or `"io"`
 *     (`setImmediate`, lower latency) — when a tick's items are collected.
 *   - `maxBatchSize`: split a tick's items into chunks of at most this size.
 *   - `maxInFlight`: at most this many concurrent `fn` invocations; further
 *     items queue in strict FIFO order and are dispatched as invocations
 *     settle, coalescing items from several ticks into chunks of up to
 *     `maxBatchSize` (so batching survives sustained backpressure).
 *   Both limits default to unbounded (`Infinity`); without limits the original
 *   single-batch-per-tick code path runs unchanged.
 *
 * Contract: `fn` must return exactly as many `PromiseSettledResult` items as it
 * received. On a length mismatch, or if `fn` throws or rejects, every promise of
 * that invocation (one chunk, possibly spanning ticks) rejects with the error;
 * other chunks are unaffected. The returned function never throws
 * synchronously. An invocation that never settles holds its `maxInFlight` slot
 * forever.
 *
 * @example
 * ```ts
 * import { make } from "@dolphin278/vjuga/BatchExecutor";
 * const getUser = make(
 *   async (ids: string[]) => ids.map((id) => ({ status: "fulfilled" as const, value: id })),
 *   { maxBatchSize: 100, maxInFlight: 4 },
 * );
 * ```
 */

import { make as makeBufferizedFn, type ScheduleMode } from "./BufferizedFunction.js";
import type { Fn1 } from "./FunctionUtils.js";
import * as Queue from "./Queue.js";

/** Options for {@link make}. Both limits default to unbounded. */
export interface Options {
  /** Batch timing; see `BufferizedFunction.ScheduleMode`. Default `"macrotask"`. */
  readonly schedule?: ScheduleMode;
  /** Maximum items per `fn` invocation: integer >= 1 or `Infinity`. */
  readonly maxBatchSize?: number;
  /** Maximum concurrent `fn` invocations: integer >= 1 or `Infinity`. */
  readonly maxInFlight?: number;
}

/** Lifted to module scope — no inner interfaces in TS. */
interface Request<T, R> {
  readonly arg: T;
  readonly resolve: (value: R) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * BatchExecutor is an implementation of dataloader pattern.
 * Caching and key transformations are done by user.
 *
 * Slight difference is that we do not deduplicate requests,
 * with same arguments that happened during same batch. Contrary
 * to dataloader, our batch executor may have intended side effects.
 *
 * Compared to BufferizedFunction, BatchExecutor allows returning values
 * to original caller using deferred objects and allows wrapped function to
 * return rejections for some of the arguments.
 *
 * `options` is either a `ScheduleMode` string (backward compatible) or an
 * {@link Options} object. `maxBatchSize` / `maxInFlight` must be integers >= 1
 * or `Infinity`; anything else throws `RangeError` from `make`. A failure
 * (throw, rejection, length mismatch) rejects only the items of that chunk.
 *
 * @example
 * ```ts
 * import { make } from "@dolphin278/vjuga/BatchExecutor";
 * // At most 2 concurrent calls of up to 50 ids each; extra ids wait FIFO.
 * const load = make(
 *   async (ids: number[]) => ids.map((id) => ({ status: "fulfilled" as const, value: id * 2 })),
 *   { schedule: "io", maxBatchSize: 50, maxInFlight: 2 },
 * );
 * const doubled = await load(21); // 42
 * ```
 */
export function make<T, R>(
  fn: Fn1<T[], Promise<PromiseSettledResult<R>[]>>,
  options?: ScheduleMode | Options,
): (arg: T) => Promise<R> {
  let schedule: ScheduleMode | undefined;
  if (typeof options === "object" && options !== null) {
    schedule = options.schedule;
    const maxBatchSize = validateLimit("maxBatchSize", options.maxBatchSize);
    const maxInFlight = validateLimit("maxInFlight", options.maxInFlight);
    if (maxBatchSize !== Infinity || maxInFlight !== Infinity) {
      return makeLimited(fn, schedule, maxBatchSize, maxInFlight);
    }
  } else {
    schedule = options as ScheduleMode | undefined;
  }

  const worker = makeBufferizedFn(async (args: Request<T, R>[]): Promise<void> => {
    let i = 0;
    try {
      const invocationArgs = Array<T>(args.length);
      for (let i = 0; i < args.length; i++) {
        invocationArgs[i] = args[i].arg;
      }

      const result = await Reflect.apply(fn, void 0, [invocationArgs]);

      if (result.length !== args.length) {
        throw new Error(
          `BatchExecutor: fn returned ${result.length} results, but expected ${args.length}`,
        );
      }

      for (i = 0; i < result.length; i++) {
        const res = result[i];
        // external API boundary: PromiseSettledResult discriminant
        if (res.status === "fulfilled") {
          args[i].resolve(res.value);
        } else {
          args[i].reject(res.reason);
        }
      }
    } catch (err) {
      // Reject rest of the requests
      for (let k = i; k < args.length; k++) {
        args[k].reject(err);
      }
    }
  }, schedule);

  return function (arg: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      (worker as (req: Request<T, R>) => void)({ arg, resolve, reject });
    });
  };
}

/** Returns the limit (`Infinity` when undefined) or throws `RangeError`. */
function validateLimit(name: string, value: number | undefined): number {
  if (value === undefined || value === Infinity) return Infinity;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `BatchExecutor: ${name} must be an integer >= 1 or Infinity, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Invokes `fn` with one chunk and settles its requests. Never rejects: any
 * failure (sync throw, rejection, malformed result) rejects the chunk's
 * remaining requests instead.
 */
async function runChunk<T, R>(
  fn: Fn1<T[], Promise<PromiseSettledResult<R>[]>>,
  args: Request<T, R>[],
): Promise<void> {
  let i = 0;
  try {
    const invocationArgs = Array<T>(args.length);
    for (let k = 0; k < args.length; k++) {
      invocationArgs[k] = args[k].arg;
    }

    const result = await Reflect.apply(fn, void 0, [invocationArgs]);

    if (result.length !== args.length) {
      throw new Error(
        `BatchExecutor: fn returned ${result.length} results, but expected ${args.length}`,
      );
    }

    for (i = 0; i < result.length; i++) {
      const res = result[i];
      if (res.status === "fulfilled") {
        args[i].resolve(res.value);
      } else {
        args[i].reject(res.reason);
      }
    }
  } catch (err) {
    for (let k = i; k < args.length; k++) {
      args[k].reject(err);
    }
  }
}

/**
 * Limited path: requests are appended to one FIFO queue at each tick; while
 * fewer than `maxInFlight` invocations run, the next `min(maxBatchSize,
 * queued)` requests are dispatched as one chunk. Without backpressure this
 * splits each tick into `maxBatchSize` chunks; under backpressure requests
 * queued from several ticks coalesce into full chunks. A slot is released
 * synchronously in the settlement callback of its chunk, so "queue non-empty
 * implies inFlight === maxInFlight" holds and later requests never overtake
 * queued ones.
 */
function makeLimited<T, R>(
  fn: Fn1<T[], Promise<PromiseSettledResult<R>[]>>,
  schedule: ScheduleMode | undefined,
  maxBatchSize: number,
  maxInFlight: number,
): (arg: T) => Promise<R> {
  // Each tick's request array is queued whole; `head` is the offset of the
  // first undispatched request in the front array, `queued` the total count.
  const pending: Queue.Queue<Request<T, R>[]> = Queue.make();
  let head = 0;
  let queued = 0;
  let inFlight = 0;

  const release = (): void => {
    inFlight--;
    pump();
  };

  /** Dequeues the next `n` requests (n <= queued), spanning ticks if needed. */
  const take = (n: number): Request<T, R>[] => {
    queued -= n;
    let front = Queue.peekFront(pending)!;
    if (front.length - head >= n) {
      const chunk = head === 0 && n === front.length ? front : front.slice(head, head + n);
      head += n;
      if (head === front.length) {
        Queue.shift(pending);
        head = 0;
      }
      return chunk;
    }
    const chunk = Array<Request<T, R>>(n);
    for (let k = 0; k < n; head = 0) {
      front = Queue.peekFront(pending)!;
      const end = front.length - head <= n - k ? front.length : head + n - k;
      while (head < end) chunk[k++] = front[head++];
      if (head === front.length) Queue.shift(pending);
      else break;
    }
    return chunk;
  };

  const pump = (): void => {
    while (inFlight < maxInFlight && queued > 0) {
      inFlight++;
      void runChunk(fn, take(queued < maxBatchSize ? queued : maxBatchSize)).then(release);
    }
  };

  const worker = makeBufferizedFn((args: Request<T, R>[]): void => {
    Queue.push(pending, args);
    queued += args.length;
    pump();
  }, schedule);

  return function (arg: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      (worker as (req: Request<T, R>) => void)({ arg, resolve, reject });
    });
  };
}
