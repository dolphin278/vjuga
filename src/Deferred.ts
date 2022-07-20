import { Fn1 } from "./FunctionUtils.js";

/**
 * Function creates Deferred object with promise and resolve/reject functions
 */
export function make<T>() {
  let resolve: Fn1<T>;
  let reject: Fn1<any>;
  const promise: Promise<T> = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve: resolve!, reject: reject!, promise };
}

export type Deferred<T> = ReturnType<typeof make<T>>;
