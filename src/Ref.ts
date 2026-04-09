/**
 * RefCell used to provide immutable container for mutable data.
 * Using it enables passing by reference for primitive types.
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
