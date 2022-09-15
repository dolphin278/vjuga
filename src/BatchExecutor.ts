import { make as makeBufferizedFn } from "./BufferizedFunction.js";
import * as Deferred from "./Deferred.js";
import { Fn1 } from "./FunctionUtils.js";
import { MemoryPool } from "./MemoryPool.js";

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
 */
export function make<T, R>(fn: Fn1<T[], Promise<PromiseSettledResult<R>[]>>) {
  const RequestPool = new MemoryPool<{
    arg: T | null;
    deferred: Deferred.Deferred<R> | null;
  }>({
    factory: () => ({
      arg: null,
      deferred: null,
    }),
    dispose: (request) => {
      request.arg = null;
      request.deferred = null;
    },
  });

  const worker = makeBufferizedFn(
    async (args: { arg: T; deferred: Deferred.Deferred<R> }[]) => {
      let i = 0;
      try {
        const result = await fn(args.map((x) => x.arg));

        if (result.length !== args.length) {
          throw new Error(
            `BatchExecutor: fn returned ${result.length} results, but expected ${args.length}`
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
        for (i = 0; i < args.length; i++) {
          RequestPool.release(args[i]);
        }
      }
    }
  );

  return function (arg: T) {
    const deferred = Deferred.make<R>();
    const request = RequestPool.acquire();
    request.arg = arg;
    request.deferred = deferred;
    worker(request as NonNullableProperties<typeof request>);
    return deferred.promise;
  };
}

type NonNullableProperties<T> = {
  [K in keyof T]: NonNullable<T[K]>;
};
