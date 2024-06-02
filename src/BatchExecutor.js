import { make as makeBufferizedFn } from "./BufferizedFunction.js";
import * as Deferred from "./Deferred.js";
import * as MemoryPool from "./MemoryPool.js";

/**
 * @template T, U
 * @typedef {import('./FunctionUtils.js').Fn1<T, U>} Fn1
 */

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
 * @template T, R
 * @param {Fn1<T[], Promise<PromiseSettledResult<R>[]>>} fn
 */
export function make(fn) {
  /**
   * @typedef {{ arg: T | null, deferred: Deferred.Deferred<R> | null }} Request
   */

  /**
   * Pool of requests. We use MemoryPool to avoid creating new objects
   *
   * @type {MemoryPool.MemoryPool<Request>}
   */
  const RequestPool = MemoryPool.make({
    /**
     * @returns {Request}
     */
    factory: () => ({
      arg: null,
      deferred: null,
    }),
    /**
     * @param {Request} request
     */
    dispose: (request) => {
      request.arg = null;
      request.deferred = null;
    },
  });

  const worker = makeBufferizedFn(
    /**
     * @param {{ arg: T; deferred: Deferred.Deferred<R> }[]} args
     */
    async (args) => {
      let i = 0;
      try {
        const invocationArgs = Array(args.length);
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
          if (res.status === "fulfilled") {
            args[i].deferred.resolve(res.value);
          } else {
            args[i].deferred.reject(res.reason);
          }
        }
      } catch (err) {
        // Reject rest of the requests
        for (let k = i; k < args.length; k++) {
          args[k].deferred.reject(err);
        }
      } finally {
        for (let i = 0; i < args.length; i++) {
          MemoryPool.release(RequestPool, args[i]);
        }
      }
    },
  );

  /**
   * @param {T} arg
   */
  return function (arg) {
    /**
     * @type {Deferred.Deferred<R>}
     */
    const deferred = Deferred.make();
    const request = MemoryPool.acquire(RequestPool);
    request.arg = arg;
    request.deferred = deferred;
    worker(/** @type {NonNullableProperties<typeof request>} */ (request));
    return deferred.promise;
  };
}

/**
 * @template T
 * @typedef {{[K in keyof T]: NonNullable<T[K]>;}} NonNullableProperties
 */
