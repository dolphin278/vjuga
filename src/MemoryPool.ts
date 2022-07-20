import { Fn0, Fn1 } from "./FunctionUtils.js";
import { Queue } from "./Queue.js";

/**
 * `MemoryPool` is a simple memory pool for objects. Using it allows you to
 * avoid allocating new objects when can reuse them.
 *
 * Pool uses our double-ended Queue for perfomant object storage. This pool
 * implementation tracks objects it lent out and does not allow to dispose
 * objects that does not belong to it.
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
 */
export class MemoryPool<T extends object> {
  #minSize = 0;
  #maxSize = 0;

  #factory: Fn0<T>;

  #dispose;

  /**
   * Pool-specific symbol used to brand instances originated from the pool.
   */
  #mark = Symbol();

  #freeInstances = new Queue<T>();

  #acquiredInstancesCount = 0;

  constructor(options: MemoryPoolConfig<T>) {
    this.#maxSize = options.maxSize ?? Infinity;
    this.#minSize = options.minSize ?? 0;
    this.#factory = options.factory;
    this.#dispose = options.dispose;

    if (this.#minSize > this.#maxSize) {
      throw new Error("minSize must be less than or equal to maxSize");
    }

    if (this.#minSize > 0) {
      for (let i = 0; i < this.#minSize; i++) {
        this.#freeInstances.push(Reflect.apply(this.#factory, null, []) as T);
      }
    }
  }

  /**
   * Get a new instance from the pool
   */
  acquire() {
    if (this.#freeInstances.size > 0) {
      const instance = this.#freeInstances.pop();
      if (instance === void 0) {
        throw new Error("Unreachable");
      }
      this.#acquiredInstancesCount++;
      return instance;
    }

    if (this.#acquiredInstancesCount >= this.#maxSize) {
      throw new Error("MemoryPool is full");
    }

    const instance = Reflect.apply(this.#factory, null, []) as T;
    Reflect.set(instance, this.#mark, true);
    this.#acquiredInstancesCount++;
    return instance;
  }

  private assertInstanceBelongsToPool(instance: T) {
    if (!Reflect.get(instance, this.#mark)) {
      throw new Error("Instance does not belong to this pool");
    }
  }

  /**
   * Release an instance back to the pool
   */
  release(instance: T) {
    this.assertInstanceBelongsToPool(instance);
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

type MemoryPoolConfig<T> = {
  factory: Fn0<T>;
  dispose?: Fn1<T>;
  maxSize?: number;
  minSize?: number;
};
