import { Queue } from "./Queue.js";

/**
 * @template T
 * @typedef {import("./FunctionUtils.js").Fn0<T>} Fn0
 */

/**
 * @template T
 * @typedef {import("./FunctionUtils.js").Fn1<T>} Fn1
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
 * const pool = new MemoryPool({
 *  factory: () => ({ x: 0, y: 0 }),
 *  dispose: (obj) => { obj.x = obj.y = 0; })
 * });
 *
 * // Get an object from the pool.
 * const obj1 = pool.acquire();
 *
 * // Use the object.
 * obj1.x = 1;
 *
 * // Return the object to the pool (it will be passed to `dispose` function if it was provided).
 * pool.release(obj1);
 *
 * // Get another object from the pool.
 * const obj2 = pool.acquire(); // obj2 === obj1, obj2 === {x: 0, y: 0}
 * ```
 *
 * @template {{}} T
 */
export class MemoryPool {
  #minSize = 0;
  #maxSize = 0;

  /** @type {Fn0<T>} */
  #factory;
  #dispose;

  /** @type {Queue<T>} */
  #freeInstances = new Queue();

  #acquiredInstancesCount = 0;

  /**
   * @param {MemoryPoolConfig<T>} options
   */
  constructor(options) {
    this.#maxSize = options.maxSize ?? 1024;
    this.#minSize = options.minSize ?? 0;
    this.#factory = options.factory;
    this.#dispose = options.dispose;

    if (this.#minSize > this.#maxSize) {
      throw new Error("minSize must be less than or equal to maxSize");
    }

    if (this.#minSize > 0) {
      for (let i = 0; i < this.#minSize; i++) {
        this.#freeInstances.push(
          /** @type {T} */ Reflect.apply(this.#factory, null, [])
        );
      }
    }
  }

  /**
   * Get a new instance from the pool
   * @returns {T}
   */
  acquire() {
    if (this.#freeInstances.size > 0) {
      const instance = this.#freeInstances.pop();
      this.#acquiredInstancesCount++;
      if (instance !== undefined) return instance;
    }

    if (this.#acquiredInstancesCount >= this.#maxSize) {
      throw new Error("MemoryPool is full");
    }

    /** @type {T} */
    const instance = Reflect.apply(this.#factory, null, []);
    this.#acquiredInstancesCount++;
    return instance;
  }

  /**
   * Release instance back to the pool
   * @param {T} instance
   */
  release(instance) {
    this.#dispose?.(instance);
    this.#acquiredInstancesCount--;
    this.#freeInstances.push(instance);
  }

  /**
   * Get number of instances that are currently lent
   */
  get acquiredInstancesCount() {
    return this.#acquiredInstancesCount;
  }

  /**
   * Get number of instances that are currently free
   */
  get freeInstancesCount() {
    return this.#freeInstances.size;
  }
}

/**
 * @type {MemoryPool<any[]>}
 */
export const ArrayPool = new MemoryPool({
  /**
   * @type {Fn0<any[]>}
   *
   */
  factory: () => [],
  /**
   *
   * @param {any[]} arr
   * @returns {void}
   */
  dispose: (arr) => ((arr.length = 0), void 0),
});

/**
 * @type {MemoryPool<Map<any, any>>}
 */
export const MapPool = new MemoryPool({
  factory: () => new Map(),
  dispose: (/** @type {Map<unknown, unknown>} */ map) => map.clear(),
});

/**
 * @type {MemoryPool<Set<any>>}
 */
export const SetPool = new MemoryPool({
  factory: () => new Set(),
  dispose: (/** @type {Set<unknown>} */ set) => set.clear(),
});
