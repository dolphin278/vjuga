/**
 * BatchExecutor — dataloader-style batching with per-item promise results.
 *
 * When to use: N concurrent callers each need an individual async result, but
 * the underlying work (DB query, HTTP call, RPC) is more efficient when
 * executed as a single batch. Unlike `BufferizedFunction`, each caller gets a
 * `Promise<R>` that resolves or rejects independently. Use `BufferizedFunction`
 * when callers do not need return values (fire-and-forget).
 *
 * Unlike the original dataloader pattern, BatchExecutor does not deduplicate
 * requests with identical arguments — intentional side effects are supported.
 *
 * The `schedule` parameter controls batch timing:
 *   - `"macrotask"` (default): fires via `setTimeout(0)` on next macrotask.
 *   - `"io"`: fires via `setImmediate` after the I/O poll phase (lower latency).
 *
 * Contract: the batch function must return exactly as many `PromiseSettledResult`
 * items as it received — a length mismatch throws at runtime.
 *
 * @example
 * ```ts
 * import { make } from "@dolphin278/vjuga/BatchExecutor";
 * const getUser = make(async (ids: string[]) =>
 *   ids.map((id) => ({ status: "fulfilled" as const, value: id })),
 * );
 * ```
 */

import { make as makeBufferizedFn, type ScheduleMode } from "./BufferizedFunction.js";
import * as MemoryPool from "./MemoryPool.js";
import type { Fn1 } from "./FunctionUtils.js";

/** Lifted to module scope — no inner interfaces in TS. */
interface Request<T, R> {
  arg: T | null;
  deferred: PromiseWithResolvers<R> | null;
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
 * The optional `schedule` parameter controls batch timing:
 * - `"macrotask"` (default): fires on next macrotask via `setTimeout(0)`
 * - `"io"`: fires via `setImmediate` at end of I/O poll phase (lower latency)
 */
export function make<T, R>(
  fn: Fn1<T[], Promise<PromiseSettledResult<R>[]>>,
  schedule?: ScheduleMode,
): (arg: T) => Promise<R> {
  const RequestPool = MemoryPool.make<Request<T, R>>({
    factory: () => ({
      arg: null,
      deferred: null,
    }),
    reset: (request) => {
      request.arg = null;
      request.deferred = null;
    },
  });

  const worker = makeBufferizedFn(async (args: Request<T, R>[]): Promise<void> => {
    let i = 0;
    try {
      const invocationArgs = Array<T>(args.length);
      for (let i = 0; i < args.length; i++) {
        invocationArgs[i] = args[i].arg as T;
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
          args[i].deferred!.resolve(res.value);
        } else {
          args[i].deferred!.reject(res.reason);
        }
      }
    } catch (err) {
      // Reject rest of the requests
      for (let k = i; k < args.length; k++) {
        args[k].deferred!.reject(err);
      }
    } finally {
      for (let i = 0; i < args.length; i++) {
        MemoryPool.release(RequestPool, args[i]);
      }
    }
  }, schedule);

  return function (arg: T): Promise<R> {
    const deferred = Promise.withResolvers<R>();
    const request = MemoryPool.acquire(RequestPool);
    request.arg = arg;
    request.deferred = deferred;
    (worker as (req: Request<T, R>) => void)(request);
    return deferred.promise;
  };
}
