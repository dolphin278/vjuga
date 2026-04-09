/**
 * TaggedUnion — construct, match, and narrow discriminated `{ tag, value }` unions.
 *
 * When to use: when modelling sum types (variants / enums with payloads).
 * For two-case ok/err unions, prefer `Result` (tuple-encoded for V8 perf).
 * TaggedUnion shines when there are 3+ variants or when exhaustive `match`
 * improves readability over manual if/switch chains.
 *
 * Design tradeoffs: the `{ tag, value }` shape keeps every variant in a single
 * V8 hidden class regardless of payload type. `match` uses `Reflect.apply` for
 * call-site consistency with the rest of the library. No `constructors()`
 * factory — Proxy overhead and loss of static analyzability are not worth the
 * ergonomics. Call `variant(tag, payload)` directly.
 *
 * @example
 * ```ts
 * import { variant, match, is, type TaggedUnion } from "vjuga/TaggedUnion";
 *
 * type Shape = TaggedUnion<{ circle: { r: number }; rect: { w: number; h: number } }>;
 * const s: Shape = variant("circle", { r: 5 });
 * const area = match(s, {
 *   circle: (v) => Math.PI * v.r ** 2,
 *   rect:   (v) => v.w * v.h,
 * });
 * ```
 */

/**
 * Distributes a record of `Tag → Payload` into a union of
 * `{ readonly tag: Tag; readonly value: Payload }` members.
 */
export type TaggedUnion<T> = {
  [P in keyof T]: { readonly tag: P; readonly value: T[P] };
}[keyof T];

/**
 * Constructs a tagged-union variant.
 *
 * The returned object always has exactly two own properties (`tag`, `value`),
 * so V8 assigns the same hidden class to every variant — keeping downstream
 * property accesses monomorphic.
 */
export function variant<K extends PropertyKey, V>(
  tag: K,
  value: V,
): { readonly tag: K; readonly value: V } {
  return { tag, value };
}

/**
 * Exhaustive pattern match on a tagged union.
 *
 * The handler map must cover every variant tag — TypeScript will error at
 * compile time if a case is missing. Each handler receives the variant's
 * `value` and must return `R`.
 */
export function match<
  T extends { readonly tag: PropertyKey; readonly value: unknown },
  R,
>(
  union: T,
  handlers: {
    [K in T["tag"]]: (value: Extract<T, { readonly tag: K }>["value"]) => R;
  },
): R {
  return Reflect.apply(
    (handlers as Record<PropertyKey, (v: unknown) => R>)[union.tag],
    undefined,
    [union.value],
  );
}

/**
 * Type guard that narrows a tagged union to a single variant.
 */
export function is<
  T extends { readonly tag: PropertyKey },
  K extends T["tag"],
>(union: T, tag: K): union is Extract<T, { readonly tag: K }> {
  return union.tag === tag;
}
