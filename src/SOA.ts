/**
 * Structure Of Arrays
 *
 * @see https://en.wikipedia.org/wiki/AoS_and_SoA
 */

/** Structure of Arrays type. */
export type SOA<T> = { [K in keyof T]: T[K][] };

const idxSymbol: unique symbol = Symbol("index");

/**
 * Function creates view-like object with the shape of aggregated entity across
 * all SOA arrays.
 *
 * Accessing properties of the view object will actually access the corresponding
 * array at the index of the view.
 *
 * Note: Object.defineProperty + this = dynamic dispatch — perf trade-off; mark as profiling candidate.
 */
export function createView<T extends object>(
  soa: SOA<T>,
  index = 0,
): T & { index: number } {
  const view = {
    [idxSymbol]: index,
  } as T & { [idxSymbol]: number; index: number };

  for (const key in soa) {
    const k = key as keyof T & string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(view, k, {
      get() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (soa as Record<string, unknown[]>)[k][(this as any)[idxSymbol]];
      },
      set(value: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (soa as Record<string, unknown[]>)[k][(this as any)[idxSymbol]] = value;
      },
      enumerable: true,
      configurable: false,
    });
  }

  Object.defineProperty(view, "index", {
    get() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this as any)[idxSymbol];
    },
    set(value: number) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any)[idxSymbol] = value | 0;
    },
    enumerable: false,
    configurable: false,
  });

  return view as T & { index: number };
}

export function push<T>(soa: SOA<T>, item: T): void {
  for (const key in soa) {
    const k = key as keyof T & string;
    (soa as Record<string, unknown[]>)[k].push(
      (item as Record<string, unknown>)[k],
    );
  }
}

export function pop<T>(soa: SOA<T>): T {
  const item = Object.create(null) as T;
  for (const key in soa) {
    const k = key as keyof T & string;
    (item as Record<string, unknown>)[k] = (
      soa as Record<string, unknown[]>
    )[k].pop();
  }
  return item;
}

export function get<T>(soa: SOA<T>, index: number): T {
  const item = Object.create(null) as T;
  for (const key in soa) {
    const k = key as keyof T & string;
    (item as Record<string, unknown>)[k] = (
      soa as Record<string, unknown[]>
    )[k][index];
  }
  return item;
}

export function set<T>(soa: SOA<T>, index: number, item: T): void {
  for (const key in item) {
    const k = key as keyof T & string;
    (soa as Record<string, unknown[]>)[k][index] = (
      item as Record<string, unknown>
    )[k];
  }
}

export function getSlice<T, K extends keyof T>(
  soa: SOA<T>,
  sliceName: K,
): T[K][] {
  return soa[sliceName];
}
