/**
 * RefCell used to provide immutable container for mutable data.
 * Using it enables passing by reference for primitive types.
 */

export type RefCell<T> = {
  contents: T;
};

export function make<T>(contents: T): RefCell<T> {
  return { contents };
}

export function set<T>(ref: RefCell<T>, value: T) {
  ref.contents = value;
}

export function get<T>(ref: RefCell<T>) {
  return ref.contents;
}
