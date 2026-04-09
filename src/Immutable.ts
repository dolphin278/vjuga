/**
 * Immutable — deeply immutable data type for compile-time mutation prevention.
 *
 * Recursively applies `readonly` to all properties, Map → ReadonlyMap,
 * Set → ReadonlySet. Supports primitives, containers, and Promises.
 *
 * Functions are excluded since they can modify internal state in arbitrary
 * ways. Array → ReadonlyArray is handled by the object case to preserve
 * tuple type information.
 *
 * When to use: marking API boundaries where callers should not mutate returned
 * data. Purely a type-level construct — `make()` is a zero-cost identity cast
 * with no runtime overhead.
 *
 * @example
 * ```ts
 * import * as Immutable from "vjuga/Immutable";
 * const config = Immutable.make({ host: "localhost", port: 3000 });
 * // config.port = 8080;  // TS error: Cannot assign to 'port' — readonly
 * ```
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
