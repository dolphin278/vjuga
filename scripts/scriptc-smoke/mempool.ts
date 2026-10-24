import * as MemoryPool from "../../src/MemoryPool.js";
const pool = MemoryPool.make({
  factory: (): number[] => [],
  reset: (a: number[]) => {
    a.length = 0;
  },
});
const arr = MemoryPool.acquire(pool);
arr.push(1, 2);
MemoryPool.release(pool, arr);
console.log(MemoryPool.acquire(pool).length);
