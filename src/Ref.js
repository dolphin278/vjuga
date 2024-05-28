/**
 * RefCell used to provide immutable container for mutable data.
 * Using it enables passing by reference for primitive types.
 * @template T
 * @typedef RefCell
 * @property {T} contents
 */

/**
 * Creates a new RefCell with given contents.
 *
 * @template T
 * @param {T} contents
 * @returns {RefCell<T>}
 */
export function make(contents) {
  return { contents };
}

/**
 * Sets the value of the RefCell.
 *
 * @template T
 * @param {RefCell<T>} ref
 * @param {T} value
 * @returns {void}
 */
export function set(ref, value) {
  ref.contents = value;
}

/**
 * Gets the value of the RefCell.
 *
 * @template T
 * @param {RefCell<T>} ref
 * @returns
 */
export function get(ref) {
  return ref.contents;
}
