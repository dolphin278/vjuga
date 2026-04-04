/**
 * Deeply immutable data type. This type supports all basic JavaScript types:
 * - primitives (number, string, boolean, null, undefined, bigint, symbols)
 * - containers (array, map, set)
 *
 * Functions are not allowed since they can modify internal state in arbitrary
 * manner. This is not decided, because having functions intact may be convenient
 * when you deal with, say, immutable instances of `Date`.
 *
 * Note: We don't include Array -> ReadonlyArray, because it's covered by the
 * object case and it turns tuples into arrays, losing the type information.
 */
export type Immutable<T> =
  T extends Map<infer K, infer V>
    ? ReadonlyMap<Immutable<K>, Immutable<V>>
    : T extends Set<infer U>
      ? ReadonlySet<Immutable<U>>
      : T extends Promise<infer U>
        ? Promise<Immutable<U>>
        : T extends object
          ? { readonly [K in keyof T]: Immutable<T[K]> }
          : T;

/**
 * Mark a value as immutable. Note - this function does not actually make the
 * value immutable, it just marks it as such from the type system perspective.
 */
export function make<T>(value: T): Immutable<T> {
  return value as Immutable<T>;
}
