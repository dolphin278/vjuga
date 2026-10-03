/**
 * SOA — Structure of Arrays with zero-copy element views.
 *
 * Stores each field of a record type as a separate contiguous array, enabling
 * cache-line-friendly iteration over individual fields. Views are getter/setter
 * proxy objects backed by shared property descriptors (cached per SOA instance
 * via WeakMap). The `idxSymbol` field on each view holds the current row index;
 * changing it repoints all property accesses without copying data.
 *
 * Notes:
 *   - Columns are the SOA's own enumerable keys; inherited keys are ignored.
 *   - `index` is reserved on views: `createView` throws a TypeError if the SOA
 *     has a column named `index`.
 *   - Views bind the column arrays that exist when the view is created. If a
 *     column array is later replaced (`soa.x = [...]`), existing views keep
 *     reading the old array; views created afterwards see the new one.
 *   - `get`/`pop` build rows with a per-SOA generated factory (fast-properties
 *     plain objects). The set of column names must not change after first use.
 *   - `set` writes only the SOA's own columns present in `item` (extra item
 *     keys are ignored) and throws a RangeError unless 0 <= index < length.
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

// Columns are the SOA's own enumerable keys; `for…in` also visits enumerable
// keys inherited from the prototype chain, so every loop skips those with
// `hasOwn.call(soa, key)`. Inside a `for…in` over the same object TurboFan
// reduces `Object.prototype.hasOwnProperty.call` to an enum-cache check
// (measured free on push); `Object.hasOwn` is not reduced (~2× on push).
const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Cached per-SOA property descriptors. Sharing getter/setter function objects across
 * all views from the same SOA instance ensures their hidden classes are identical,
 * keeping V8 ICs for property accesses monomorphic. Each getter also captures the
 * array reference directly (rather than going through soa[key] on every access), so
 * the entry remembers which arrays it captured and is revalidated (O(columns)) on
 * every createView — replacing a column array rebuilds the descriptors.
 */
interface ViewCacheEntry {
  keys: string[];
  arrays: unknown[][];
  descriptors: PropertyDescriptorMap;
}

const viewDescriptorCache = new WeakMap<object, ViewCacheEntry>();

function isFresh(entry: ViewCacheEntry, soa: Record<string, unknown[]>): boolean {
  let n = 0;
  for (const key in soa) {
    if (!hasOwn.call(soa, key)) continue;
    if (entry.keys[n] !== key || entry.arrays[n] !== soa[key]) return false;
    n++;
  }
  return n === entry.keys.length;
}

function getOrCreateDescriptors<T>(soa: SOA<T>): PropertyDescriptorMap {
  const cols = soa as Record<string, unknown[]>;
  const cached = viewDescriptorCache.get(soa as object);
  if (cached !== undefined && isFresh(cached, cols)) return cached.descriptors;
  // Null prototype: assigning descriptors["__proto__"] must create an own key.
  const descriptors: PropertyDescriptorMap = Object.create(null);
  const keys: string[] = [];
  const arrays: unknown[][] = [];
  for (const key in cols) {
    if (!hasOwn.call(cols, key)) continue;
    if (key === "index") {
      throw new TypeError("SOA.createView: column name 'index' is reserved by views");
    }
    const arr = cols[key];
    keys.push(key);
    arrays.push(arr);
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
  viewDescriptorCache.set(soa as object, { keys, arrays, descriptors });
  return descriptors;
}

/**
 * Per-SOA row factory used by get/pop. Generated code builds a plain object
 * literal `{x: soa.x[i], ...}` so rows have fast properties and a stable hidden
 * class (an `Object.create(null)` + keyed stores yields dictionary-mode objects).
 * A column named `__proto__` is emitted as a computed key, which defines an own
 * property instead of setting the prototype. Columns are read from `soa` on every
 * call, so replacing a column array is fine; the factory is only keyed by the
 * column-name list, which must not change after first use.
 */
type RowFactory = (soa: object, i: number) => unknown;

const rowFactoryCache = new WeakMap<object, RowFactory>();

// Factories are also shared across SOAs with the same column names, so
// short-lived SOAs don't pay for code generation each time. Bounded: cleared
// when it grows past MAX_SHARED_FACTORIES distinct shapes.
const MAX_SHARED_FACTORIES = 64;
const sharedRowFactories = new Map<string, RowFactory>();

function makeRowFactory(keys: string[]): RowFactory {
  try {
    let body = "";
    for (let n = 0; n < keys.length; n++) {
      const lit = JSON.stringify(keys[n]);
      body += (n > 0 ? "," : "") + (keys[n] === "__proto__" ? `[${lit}]` : lit) + `:s[${lit}][i]`;
    }
    return new Function("s", "i", `return {${body}};`) as RowFactory;
  } catch {
    // Code generation unavailable (e.g. CSP without 'unsafe-eval'): slower but equivalent.
    return (soa, i) => {
      const row = {};
      for (const key of keys) {
        Object.defineProperty(row, key, {
          value: (soa as Record<string, unknown[]>)[key][i],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return row;
    };
  }
}

function getRowFactory<T>(soa: SOA<T>): RowFactory {
  let factory = rowFactoryCache.get(soa as object);
  if (factory === undefined) {
    const keys: string[] = [];
    for (const key in soa) if (hasOwn.call(soa, key)) keys.push(key);
    const signature = JSON.stringify(keys);
    factory = sharedRowFactories.get(signature);
    if (factory === undefined) {
      if (sharedRowFactories.size >= MAX_SHARED_FACTORIES) sharedRowFactories.clear();
      factory = makeRowFactory(keys);
      sharedRowFactories.set(signature, factory);
    }
    rowFactoryCache.set(soa as object, factory);
  }
  return factory;
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
 *
 * The initial `index` is normalized with `| 0`, exactly like the `view.index`
 * setter (so `createView(soa, 1.5).index === 1`).
 */
export function createView<T extends object>(soa: SOA<T>, index = 0): T & { index: number } {
  index |= 0;
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
    if (!hasOwn.call(soa, key)) continue;
    const k = key as keyof T & string;
    (soa as Record<string, unknown[]>)[k].push((item as Record<string, unknown>)[k]);
  }
}

export function pop<T>(soa: SOA<T>): T {
  const item = getRowFactory(soa)(soa, length(soa) - 1) as T;
  for (const key in soa) {
    if (!hasOwn.call(soa, key)) continue;
    (soa as Record<string, unknown[]>)[key].pop();
  }
  return item;
}

export function get<T>(soa: SOA<T>, index: number): T {
  return getRowFactory(soa)(soa, index) as T;
}

/**
 * Overwrites row `index` with the columns present in `item`. Only the SOA's own
 * columns are written (extra keys on `item` are ignored; columns missing from
 * `item` keep their value), so the co-length invariant cannot be broken. Throws a RangeError unless 0 <= index < length.
 */
export function set<T>(soa: SOA<T>, index: number, item: T): void {
  // Bounds are checked against the first column on the first iteration (all
  // columns are co-length), before anything is written. `>>> 0` rejects
  // negatives, fractions, NaN and Infinity.
  let checked = false;
  for (const key in soa) {
    if (!hasOwn.call(soa, key)) continue;
    const arr = (soa as Record<string, unknown[]>)[key];
    if (!checked) {
      if (index >>> 0 !== index || index >= arr.length) throw setRangeError(index, arr.length);
      checked = true;
    }
    const v = (item as Record<string, unknown>)[key];
    // Columns absent from `item` are left untouched (partial update); the `in`
    // check only runs for undefined values, keeping full-row writes fast.
    if (v !== undefined || key in (item as object)) arr[index] = v;
  }
  if (!checked) throw setRangeError(index, 0);
}

function setRangeError(index: number, len: number): RangeError {
  return new RangeError(`set: index ${index} out of bounds (length ${len})`);
}

export function getSlice<T, K extends keyof T>(soa: SOA<T>, sliceName: K): T[K][] {
  return soa[sliceName];
}

/**
 * Returns the number of elements currently stored in the SOA.
 * All slices are co-length, so the length of the first slice is authoritative.
 * Returns 0 for an empty SOA (no own keys).
 */
export function length<T>(soa: SOA<T>): number {
  for (const key in soa) {
    if (hasOwn.call(soa, key)) return (soa as Record<string, unknown[]>)[key].length;
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
  // `>>> 0` rejects negatives, fractions, NaN and Infinity (they would create named properties).
  if (index >>> 0 !== index || index > last) {
    throw new RangeError(`swapRemove: index ${index} out of bounds (length ${last + 1})`);
  }
  if (index !== last) {
    for (const key in soa) {
      if (!hasOwn.call(soa, key)) continue;
      const arr = (soa as Record<string, unknown[]>)[key];
      arr[index] = arr[last];
    }
  }
  for (const key in soa) {
    if (!hasOwn.call(soa, key)) continue;
    (soa as Record<string, unknown[]>)[key].pop();
  }
}

/**
 * Removes all elements from every slice, resetting the SOA to length 0.
 */
export function clear<T>(soa: SOA<T>): void {
  for (const key in soa) {
    if (!hasOwn.call(soa, key)) continue;
    (soa as Record<string, unknown[]>)[key].length = 0;
  }
}
