/**
 * Ref — mutable reference cell for pass-by-reference semantics.
 *
 * A `RefCell<T>` is a single-field object (`{ contents: T }`) that enables
 * pass-by-reference for primitives and explicit mutation tracking for
 * closure-captured state.
 *
 * When to use: passing mutable state into closures or across module boundaries
 * where a primitive would be captured by value (used by TimedFunction,
 * BufferizedFunction). For object fields, direct mutation is simpler.
 *
 * Prior art: OCaml's `ref` type.
 *
 * @example
 * ```ts
 * import * as Ref from "@dolphin278/vjuga/Ref";
 * const counter = Ref.make(0);
 * Ref.set(counter, Ref.get(counter) + 1);
 * Ref.get(counter); // 1
 * ```
 */
export interface RefCell<T> {
  contents: T;
}

/**
 * Creates a new RefCell with given contents.
 *
 * Note: using `{}` (not `Object.create(null)`) intentionally — V8 has faster
 * property access on prototype-chain objects for fixed-key shapes like RefCell
 * which has exactly one key `contents`.
 */
export function make<T>(contents: T): RefCell<T> {
  return { contents };
}
