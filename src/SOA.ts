/**
 * SOA — Structure of Arrays with zero-copy element views.
 *
 * Stores each field of a record type as a separate contiguous array, enabling
 * cache-line-friendly iteration over individual fields. Views are getter/setter
 * proxy objects backed by shared property descriptors (cached per SOA instance
 * via WeakMap). The `idxSymbol` field on each view holds the current row index;
 * changing it repoints all property accesses without copying data.
 *
 * When to use: tight iteration over many records where cache-line utilization
 * matters (physics loops, columnar data transforms, ECS-style engines). For
 * small record counts or random-access patterns, plain Array-of-Structs
 * objects are simpler and equally fast.
 *
 * @see https://en.wikipedia.org/wiki/AoS_and_SoA
 *
 * @example
 * ```ts
 * import * as SOA from "@dolphin278/vjuga/SOA";
 * const soa: SOA.SOA<{x: number; y: number}> = { x: [1, 2, 3], y: [4, 5, 6] };
 * const view = SOA.createView(soa, 0);
 * view.x;       // 1
 * view.index = 2;
 * view.x;       // 3
 * ```
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

/**
 * Returns the number of elements currently stored in the SOA.
 * All slices are co-length, so the length of the first slice is authoritative.
 * Returns 0 for an empty SOA (no keys).
 */
export function length<T>(soa: SOA<T>): number {
  for (const key in soa) {
    return (soa as Record<string, unknown[]>)[key].length;
  }
  return 0;
}

/**
 * O(1) order-non-preserving removal. Copies the last row over `index`, then
 * pops every slice. Callers must update any external index that pointed at the
 * last element, as it now lives at `index`.
 *
 * Throws a RangeError if `index` is out of bounds.
 */
export function swapRemove<T>(soa: SOA<T>, index: number): void {
  const last = length(soa) - 1;
  if (index < 0 || index > last) {
    throw new RangeError(`swapRemove: index ${index} out of bounds (length ${last + 1})`);
  }
  if (index !== last) {
    for (const key in soa) {
      const arr = (soa as Record<string, unknown[]>)[key];
      arr[index] = arr[last];
    }
  }
  for (const key in soa) {
    (soa as Record<string, unknown[]>)[key].pop();
  }
}

/**
 * Removes all elements from every slice, resetting the SOA to length 0.
 */
export function clear<T>(soa: SOA<T>): void {
  for (const key in soa) {
    (soa as Record<string, unknown[]>)[key].length = 0;
  }
}
