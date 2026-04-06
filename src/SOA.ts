/**
 * Structure Of Arrays
 *
 * @see https://en.wikipedia.org/wiki/AoS_and_SoA
 */

/** Structure of Arrays type. */
export type SOA<T> = { [K in keyof T]: T[K][] };

const idxSymbol: unique symbol = Symbol("index");

/**
 * Cached per-SOA property descriptors. Sharing getter/setter function objects across
 * all views from the same SOA instance ensures their hidden classes are identical,
 * keeping V8 ICs for property accesses monomorphic. Each getter also captures the
 * array reference directly (rather than going through soa[key] on every access).
 */
const viewDescriptorCache = new WeakMap<object, PropertyDescriptorMap>();

function getOrCreateDescriptors<T>(soa: SOA<T>): PropertyDescriptorMap {
  let descriptors = viewDescriptorCache.get(soa as object);
  if (descriptors !== undefined) return descriptors;
  descriptors = {};
  for (const key in soa) {
    const arr = (soa as Record<string, unknown[]>)[key];
    descriptors[key] = {
      get(this: { [idxSymbol]: number }) {
        return arr[this[idxSymbol]];
      },
      set(this: { [idxSymbol]: number }, v: unknown) {
        arr[this[idxSymbol]] = v;
      },
      enumerable: true,
      configurable: false,
    };
  }
  viewDescriptorCache.set(soa as object, descriptors);
  return descriptors;
}

// Shared index property descriptor — no per-instance captures, allocated once.
const indexDescriptor: PropertyDescriptor = {
  get(this: { [idxSymbol]: number }) {
    return this[idxSymbol];
  },
  set(this: { [idxSymbol]: number }, value: number) {
    this[idxSymbol] = value | 0;
  },
  enumerable: false,
  configurable: false,
};

/**
 * Function creates view-like object with the shape of aggregated entity across
 * all SOA arrays.
 *
 * Accessing properties of the view object will actually access the corresponding
 * array at the index of the view.
 *
 * Getter/setter functions are shared across all views from the same SOA instance
 * (via WeakMap cache), keeping V8 ICs monomorphic across views.
 */
export function createView<T extends object>(soa: SOA<T>, index = 0): T & { index: number } {
  const view = {
    [idxSymbol]: index,
  } as T & { [idxSymbol]: number; index: number };
  // Write idxSymbol a second time so V8 treats it as a mutable field.
  // The index setter (view.index = n) writes to idxSymbol on every call;
  // without this, the first such write causes a "field constness changed"
  // cascade deoptimization of the view's property getters/setters.
  view[idxSymbol] = index;

  Object.defineProperties(view, getOrCreateDescriptors(soa));
  Object.defineProperty(view, "index", indexDescriptor);

  return view as T & { index: number };
}

export function push<T>(soa: SOA<T>, item: T): void {
  for (const key in soa) {
    const k = key as keyof T & string;
    (soa as Record<string, unknown[]>)[k].push((item as Record<string, unknown>)[k]);
  }
}

export function pop<T>(soa: SOA<T>): T {
  const item = Object.create(null) as T;
  for (const key in soa) {
    const k = key as keyof T & string;
    (item as Record<string, unknown>)[k] = (soa as Record<string, unknown[]>)[k].pop();
  }
  return item;
}

export function get<T>(soa: SOA<T>, index: number): T {
  const item = Object.create(null) as T;
  for (const key in soa) {
    const k = key as keyof T & string;
    (item as Record<string, unknown>)[k] = (soa as Record<string, unknown[]>)[k][index];
  }
  return item;
}

export function set<T>(soa: SOA<T>, index: number, item: T): void {
  for (const key in item) {
    const k = key as keyof T & string;
    (soa as Record<string, unknown[]>)[k][index] = (item as Record<string, unknown>)[k];
  }
}

export function getSlice<T, K extends keyof T>(soa: SOA<T>, sliceName: K): T[K][] {
  return soa[sliceName];
}
