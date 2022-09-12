/**
 * Structure Of Arrays
 *
 * @see https://en.wikipedia.org/wiki/AoS_and_SoA
 *
 */

type SOA<T> = {
  [K in keyof T]: T[K][];
};

const idxSymbol = Symbol("index");

/**
 * Function creates view-like object with the shape of aggregated entity across
 * all SOA arrays.
 *
 * Accessing properties of the view object will actually access the corresponding
 * array at the index of the view.
 */
export function createView<T>(
  soa: SOA<T>,
  index: number = 0
): T & { index: number } {
  const view = { [idxSymbol]: index } as T & {
    [idxSymbol]: number;
    index: number;
  };

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

export function push<T>(soa: SOA<T>, item: T) {
  for (const key in item) {
    soa[key].push(item[key]);
  }
}

export function pop<T>(soa: SOA<T>): T {
  const item = {} as T;
  for (const key in soa) {
    item[key] = soa[key].pop()!;
  }
  return item;
}

export function get<T>(soa: SOA<T>, index: number) {
  const item = {} as T;
  for (const key in soa) {
    item[key] = soa[key][index];
  }
  return item;
}

export function set<T>(soa: SOA<T>, index: number, item: T) {
  for (const key in item) {
    soa[key][index] = item[key];
  }
}

export function getSlice<T, K extends keyof T>(
  soa: SOA<T>,
  sliceName: K
): T[K][] {
  return soa[sliceName];
}
