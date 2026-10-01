/**
 * PromiseUtils — named-field parallel resolution and a bounded async pool.
 *
 * When to use: `props`/`propsMap` resolve a record/Map of promises with named
 * results instead of positional (for arrays, use `Promise.all` directly).
 * `pool` runs an async function over many items with at most `limit` calls in
 * flight — the in-process limiter for I/O-bound work (HTTP, LLM, DB). For
 * CPU-bound work on threads use `WorkerPool`; to batch many calls into one
 * backend request use `BatchExecutor`.
 *
 * Prior art: Bluebird's `Promise.props()`; `p-map` / `async.mapLimit`.
 *
 * `props` resolves the object's OWN ENUMERABLE keys, string and symbol alike;
 * inherited keys are ignored. The result is a null-prototype object (no
 * `toString`/`hasOwnProperty`; safe for keys like `__proto__`).
 *
 * Design tradeoffs: `pool` consumes its iterable eagerly and resolves to
 * `PromiseSettledResult`s in input order, so one failure never loses the other
 * results. Cancellation is cooperative via `AbortSignal`: no new calls start
 * after abort, in-flight calls finish and are recorded.
 *
 * @example
 * ```ts
 * import * as PromiseUtils from "@dolphin278/vjuga/PromiseUtils";
 * const { user, posts } = await PromiseUtils.props({
 *   user: fetchUser(id),
 *   posts: fetchPosts(id),
 * });
 * const pages = await PromiseUtils.pool(urls, 4, (url) => fetch(url));
 * ```
 */
export async function props<T extends object>(obj: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys: (string | symbol)[] = [];
  const promises: unknown[] = [];

  for (const key of Reflect.ownKeys(obj)) {
    if (!Object.prototype.propertyIsEnumerable.call(obj, key)) continue;
    keys.push(key);
    promises.push((obj as Record<string | symbol, unknown>)[key]);
  }

  const values = await Promise.all(promises);
  const result = Object.create(null) as { [K in keyof T]: Awaited<T[K]> };

  for (let i = 0; i < keys.length; i++) {
    (result as Record<string | symbol, unknown>)[keys[i]] = values[i];
  }

  return result;
}

/**
 * Function takes a map with promise values and returns
 * a map with all values resolved.
 *
 * Keys are not awaited.
 *
 * If any of the promises rejects, the returned promise will reject.
 *
 * Example:
 * ```js
 * const arg = new Map<string, Promise<number>>([
 *  ["a", Promise.resolve(1)],
 *  ["b", Promise.resolve(2)],
 * ]);
 *
 * await propsMap(arg); // Map { "a" => 1, "b" => 2 }
 * ```
 */
export async function propsMap<K, V>(map: Map<K, V>): Promise<Map<K, Awaited<V>>> {
  const keys: K[] = [];
  const promises: V[] = [];

  for (const [key, value] of map) {
    keys.push(key);
    promises.push(value);
  }

  const values = await Promise.all(promises);
  const result = new Map<K, Awaited<V>>();

  for (let i = 0; i < keys.length; i++) {
    result.set(keys[i], values[i] as Awaited<V>);
  }

  return result;
}

/** Options for {@link pool}. */
export interface PoolOptions {
  /**
   * Once aborted, no new `fn` calls start; items not yet started settle as
   * `{ status: "rejected", reason: signal.reason }`. In-flight calls finish.
   */
  readonly signal?: AbortSignal;
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight, starting items
 * in input order. Resolves to one `PromiseSettledResult` per item, in input
 * order, once every started call has settled.
 *
 * - Never rejects because of `fn`: a rejection or a synchronous throw marks
 *   only that item `rejected`, and the pool continues with the next item.
 *   A synchronous throw does not occupy a slot.
 * - `limit` must be an integer >= 1 or `Infinity`. An invalid `limit`, a
 *   non-function `fn`, a non-iterable `items` or an iterator that throws make
 *   the returned promise reject (`RangeError` / `TypeError` / the thrown
 *   error); `pool` never throws synchronously.
 * - `items` is any `Iterable` (arrays included), copied eagerly when `pool` is
 *   called, so later mutation of it has no effect;
 *   empty input resolves to `[]`.
 * - `fn` receives `(item, index, signal)` so it can cooperate with abort.
 *   `signal.aborted` is checked before each start: aborting (even from inside
 *   `fn`) stops all later starts; an already-aborted signal starts nothing.
 *   A call that never settles keeps the result pending.
 *
 * @example
 * ```ts
 * import * as PromiseUtils from "@dolphin278/vjuga/PromiseUtils";
 * const ctrl = new AbortController();
 * let spent = 0;
 * const results = await PromiseUtils.pool(
 *   prompts,
 *   4,
 *   async (prompt, _i, signal) => {
 *     const r = await callModel(prompt, { signal });
 *     if ((spent += r.tokens) > budget) ctrl.abort(new Error("budget"));
 *     return r.text;
 *   },
 *   { signal: ctrl.signal },
 * );
 * // results[i]: { status: "fulfilled", value } | { status: "rejected", reason }
 * ```
 */
export async function pool<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal | undefined) => R | PromiseLike<R>,
  options?: PoolOptions,
): Promise<PromiseSettledResult<Awaited<R>>[]> {
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError(
      `PromiseUtils.pool: limit must be an integer >= 1 or Infinity, got ${String(limit)}`,
    );
  }
  if (typeof fn !== "function") {
    throw new TypeError("PromiseUtils.pool: fn must be a function");
  }
  const arr: readonly T[] = [...items]; // snapshot: later mutation of `items` has no effect
  const n = arr.length;
  const results = Array<PromiseSettledResult<Awaited<R>>>(n);
  if (n === 0) return results;
  const signal = options?.signal;

  return new Promise((resolve) => {
    let next = 0;
    let active = 0;
    let settled = 0;

    const launch = (): void => {
      while (active < limit && next < n) {
        if (signal !== undefined && signal.aborted) {
          const reason: unknown = signal.reason;
          for (; next < n; next++) {
            results[next] = { status: "rejected", reason };
            settled++;
          }
          break;
        }
        const i = next++;
        let r: R | PromiseLike<R>;
        try {
          r = fn(arr[i], i, signal);
        } catch (reason) {
          results[i] = { status: "rejected", reason };
          settled++;
          continue;
        }
        active++;
        Promise.resolve(r).then(
          (value) => finish(i, { status: "fulfilled", value }),
          (reason: unknown) => finish(i, { status: "rejected", reason }),
        );
      }
      if (settled === n) resolve(results);
    };

    const finish = (i: number, res: PromiseSettledResult<Awaited<R>>): void => {
      results[i] = res;
      settled++;
      active--;
      launch();
    };

    launch();
  });
}
