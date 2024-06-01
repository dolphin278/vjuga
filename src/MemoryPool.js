import { Queue } from "./Queue.js";

/**
 * @template T
 * @typedef {import("./FunctionUtils.js").Fn0<T>} Fn0
 */

/**
 * @template T
 * @template [R=void]
 * @typedef {import("./FunctionUtils.js").Fn1<T, R>} Fn1
 */

/**
 * @template T
 * @typedef MemoryPoolConfig
 * @property {Fn0<T>} factory
 * @property {Fn1<T>} [dispose]
 * @property {number} [maxSize]
 * @property {number} [minSize]
 */

/**
 * `MemoryPool` is a simple memory pool for objects. Using it allows you to
 * avoid allocating new objects when can reuse them.
 *
 * Pool uses our double-ended Queue for perfomant object storage. This pool
 * implementation tracks objects it lent out and does not allow to dispose
 * objects that does not belong to it.
 *
 * This implementation has no guardrails to prevent you from releasing same
 * object multiple times or releasing object that does not belong to this pool.
 *
 * Such measures are not taken because this pool is intended to be used in
 * performance critical code and we want to avoid any overhead.
 *
 * Safer implementation may be added in the future.
 *
 * Usage example:
 * ```ts
 * const pool = make({
 *  factory: () => ({ x: 0, y: 0 }),
 *  dispose: (obj) => { obj.x = obj.y = 0; })
 * });
 *
 * // Get an object from the pool.
 * const obj1 = acquire(pool);
 *
 * // Use the object.
 * obj1.x = 1;
 *
 * // Return the object to the pool (it will be passed to `dispose`
 * // function if it was provided).
 * release(pool, obj1);
 *
 * // Get another object from the pool.
 * const obj2 = acquire(pool); // obj2 === obj1, obj2 === {x: 0, y: 0}
 * ```
 *
 * @template {{}} T
 * @typedef MemoryPool
 * @property {Fn0<T>} factory
 * @property {Fn1<T, void>} [dispose]
 * @property {number} maxSize
 * @property {Queue<T>} freeList
 * @property {Set<T>} acquiredSet
 */

/**
 *
 * @template {{}} T
 * @param {MemoryPoolConfig<T>} options
 * @returns {MemoryPool<T>}
 */
export function make({ factory, dispose, maxSize: _maxSize, minSize }) {
  const freeList = new Queue();
  const acquiredSet = new Set();

  const maxSize = _maxSize ?? 1024;
  if (minSize !== undefined && minSize > maxSize) {
    throw new Error("minSize cannot be greater than maxSize");
  }

  if (minSize !== undefined) {
    for (let i = 0; i < minSize; i++) {
      freeList.push(Reflect.apply(factory, null, []));
    }
  }

  return {
    factory,
    dispose,
    maxSize,
    freeList,
    acquiredSet,
  };
}

/**
 * Get a new instance from the pool
 *
 * @template {{}} T
 * @param {MemoryPool<T>} pool
 */
export function acquire({ freeList, acquiredSet, maxSize, factory }) {
  if (freeList.size > 0) {
    const instance = freeList.pop();

    if (instance !== undefined) {
      acquiredSet.add(instance);
      return instance;
    }
  }

  if (acquiredSet.size >= maxSize) {
    throw new Error("MemoryPool is full");
  }

  /** @type {T} */
  const instance = Reflect.apply(factory, void 0, []);
  acquiredSet.add(instance);
  return instance;
}

/**
 * @template {{}} T
 * @param {MemoryPool<T>} pool
 * @param {T} instance
 */
export function release({ acquiredSet, dispose, freeList }, instance) {
  if (!acquiredSet.has(instance)) {
    throw new Error("Instance does not belong to this pool");
  }

  if (dispose !== undefined) {
    Reflect.apply(dispose, void 0, [instance]);
  }

  acquiredSet.delete(instance);
  freeList.push(instance);
}

export const ArrayPool = make({
  factory: () => /** @type {any[]} */ ([]),
  dispose: (arr) => (arr.length = 0),
});

export const MapPool = make({
  factory: () => new Map(),
  dispose: (map) => map.clear(),
});

export const SetPool = make({
  factory: () => new Set(),
  dispose: (set) => set.clear(),
});
