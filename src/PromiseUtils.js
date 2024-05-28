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
 *
 * ```
 *
 * @template {object} T
 * @param {T} obj
 * @returns {Promise<{ [K in keyof T]: Awaited<T[K]>; }>}
 */
export async function props(obj) {
  const keys = [];
  const promises = [];

  for (var key in obj) {
    keys.push(key);
    promises.push(obj[key]);
  }

  const values = await Promise.all(promises);
  const result = Object.create(null);

  for (var i = 0; i < keys.length; i++) {
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
 *
 * @template K
 * @template V
 * @param {Map<K, V>} map
 * @returns {Promise<Map<K, Awaited<V>>>}
 */
export async function propsMap(map) {
  const keys = [];
  const promises = [];

  for (var [key, value] of map) {
    keys.push(key);
    promises.push(value);
  }

  const values = await Promise.all(promises);
  const result = new Map();

  for (var i = 0; i < keys.length; i++) {
    result.set(keys[i], values[i]);
  }

  return result;
}
