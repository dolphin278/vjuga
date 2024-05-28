/**
 * Structure Of Arrays
 *
 * @see https://en.wikipedia.org/wiki/AoS_and_SoA
 *
 */

/**
 * @template T
 * @typedef {{[K in keyof T]: T[K][]}} SOA Structure of Arrays
 */

const idxSymbol = Symbol("index");

/**
 * Function creates view-like object with the shape of aggregated entity across
 * all SOA arrays.
 *
 * Accessing properties of the view object will actually access the corresponding
 * array at the index of the view.
 *
 * @template T
 * @param {SOA<T>} soa
 * @param {number} [index=0]
 * @returns {T & { index: number }}
 */
export function createView(soa, index = 0) {
  const view = /** @type {T & { [idxSymbol]: number; index: number; }} */ ({
    [idxSymbol]: index,
  });

  for (const key in soa) {
    Object.defineProperty(view, key, {
      get() {
        return soa[key][this[idxSymbol]];
      },
      set(value) {
        soa[key][this[idxSymbol]] = value;
      },
      enumerable: true,
      configurable: false,
    });
  }

  Object.defineProperty(view, "index", {
    get() {
      return this[idxSymbol];
    },
    set(value) {
      this[idxSymbol] = value | 0;
    },
    enumerable: false,
    configurable: false,
  });
  return view;
}

/**
 *
 * @template T
 * @param {SOA<T>} soa
 * @param {T} item
 */
export function push(soa, item) {
  for (const key in soa) {
    soa[key].push(item[key]);
  }
}

/**
 * @template T
 * @param {SOA<T>} soa
 * @returns {T}
 */
export function pop(soa) {
  const item = /** @type {T} */ (Object.create(null));
  for (const key in soa) {
    item[key] = /** @type {T[Extract<keyof T, string>]} */ (soa[key].pop());
  }
  return item;
}

/**
 * @template T
 * @param {SOA<T>} soa
 * @param {number} index
 */
export function get(soa, index) {
  const item = /** @type {T} */ (Object.create(null));
  for (const key in soa) {
    item[key] = soa[key][index];
  }
  return item;
}

/**
 * @template T
 * @param {SOA<T>} soa
 * @param {number} index
 * @param {T} item
 */
export function set(soa, index, item) {
  for (const key in item) {
    soa[key][index] = item[key];
  }
}

/**
 * @template T
 * @template {keyof T} K
 * @param {SOA<T>} soa
 * @param {K} sliceName
 * @returns {T[K][]}
 */
export function getSlice(soa, sliceName) {
  return soa[sliceName];
}
