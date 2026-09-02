/**
 * PromiseUtils — named-field parallel resolution for promise records.
 *
 * When to use: parallel resolution of a record of promises where you want
 * named results instead of positional. For arrays, use `Promise.all` directly.
 *
 * Prior art: Bluebird's `Promise.props()`.
 *
 * @example
 * ```ts
 * import * as PromiseUtils from "@dolphin278/vjuga/PromiseUtils";
 * const { user, posts } = await PromiseUtils.props({
 *   user: fetchUser(id),
 *   posts: fetchPosts(id),
 * });
 * ```
 */
export async function props<T extends object>(obj: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys: string[] = [];
  const promises: unknown[] = [];

  for (const key in obj) {
    keys.push(key);
    promises.push(obj[key]);
  }

  const values = await Promise.all(promises);
  const result = Object.create(null) as { [K in keyof T]: Awaited<T[K]> };

  for (let i = 0; i < keys.length; i++) {
    (result as Record<string, unknown>)[keys[i]] = values[i];
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
