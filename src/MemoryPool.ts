import * as Queue from "./Queue.js";
import type { Fn0, Fn1 } from "./FunctionUtils.js";

export interface MemoryPoolConfig<T> {
  factory: Fn0<T>;
  dispose?: Fn1<T, void>;
  maxSize?: number;
  minSize?: number;
}

/**
 * `MemoryPool` is a simple memory pool for objects. Using it allows you to
 * avoid allocating new objects when you can reuse them.
 *
 * Pool uses our double-ended Queue for performant object storage. This pool
 * implementation tracks objects it lent out and does not allow to dispose
 * objects that do not belong to it.
 *
 * This implementation has no guardrails to prevent you from releasing same
 * object multiple times or releasing object that does not belong to this pool.
 *
 * Such measures are not taken because this pool is intended to be used in
 * performance critical code and we want to avoid any overhead.
 */
export interface MemoryPool<T> {
  factory: Fn0<T>;
  dispose?: Fn1<T, void>;
  maxSize: number;
  freeList: Queue.Queue<T>;
  acquiredSet: Set<T>;
}

export function make<T extends object>(
  options: MemoryPoolConfig<T>,
): MemoryPool<T> {
  const { factory, dispose, maxSize: _maxSize, minSize } = options;
  const freeList = Queue.make<T>();
  const acquiredSet = new Set<T>();

  const maxSize = _maxSize ?? 1024;
  if (minSize !== undefined && minSize > maxSize) {
    throw new Error("minSize cannot be greater than maxSize");
  }

  if (minSize !== undefined) {
    for (let i = 0; i < minSize; i++) {
      Queue.push(freeList, Reflect.apply(factory, null, []));
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

export function acquire<T extends object>({
  freeList,
  acquiredSet,
  maxSize,
  factory,
}: MemoryPool<T>): T {
  if (Queue.size(freeList) > 0) {
    const instance = Queue.pop(freeList);

    if (instance !== undefined) {
      acquiredSet.add(instance);
      return instance;
    }
  }

  if (acquiredSet.size >= maxSize) {
    throw new Error("MemoryPool is full");
  }

  const instance: T = Reflect.apply(factory, void 0, []) as T;
  acquiredSet.add(instance);
  return instance;
}

export function release<T extends object>(
  { acquiredSet, dispose, freeList }: MemoryPool<T>,
  instance: T,
): void {
  if (!acquiredSet.has(instance)) {
    throw new Error("Instance does not belong to this pool");
  }

  if (dispose !== undefined) {
    Reflect.apply(dispose, void 0, [instance]);
  }

  acquiredSet.delete(instance);
  Queue.push(freeList, instance);
}

export const ArrayPool: MemoryPool<unknown[]> = make({
  factory: () => [],
  dispose: (arr) => {
    arr.length = 0;
  },
});

export const MapPool: MemoryPool<Map<unknown, unknown>> = make({
  factory: () => new Map(),
  dispose: (map) => map.clear(),
});

export const SetPool: MemoryPool<Set<unknown>> = make({
  factory: () => new Set(),
  dispose: (set) => set.clear(),
});
