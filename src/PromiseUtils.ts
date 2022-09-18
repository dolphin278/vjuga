/**
 * Function takes an object with promise fields and returns
 * an object with all fields resolved.
 *
 * If any of the promises rejects, the returned promise will reject.
 *
 * Example:
 * ```js
 *  const arg = { a: Promise.resolve(1), b: "asdf" }
 *
 *  await props(arg); // { a: 1, b: "asdf" }
 * ```
 */
export async function props<T extends object>(
  obj: T,
  result: { [K in keyof T]: Awaited<T[K]> } = Object.create(null) as any
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(obj) as (keyof T)[];
  const values = await Promise.all(Object.values(obj));

  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i];
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
export async function propsMap<K, V>(
  map: Map<K, V>,
  result: Map<K, Awaited<V>> = new Map()
): Promise<Map<K, Awaited<V>>> {
  const keys = Array.from(map.keys());
  const values = await Promise.all(Array.from(map.values()));
  for (let i = 0; i < keys.length; i++) {
    result.set(keys[i], values[i]);
  }
  return result;
}
