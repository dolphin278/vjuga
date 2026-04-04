/**
 * Function creates Deferred object with promise and resolve/reject
 * functions.
 *
 * This is an equivalent of the `Promise.withResolvers` proposal.
 */
export function make<T>(): {
  resolve: (v: T) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<T>;
} {
  // definite assignment assertion — assigned synchronously inside Promise constructor
  let resolve!: (v: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { resolve, reject, promise };
}

export type Deferred<T> = ReturnType<typeof make<T>>;
