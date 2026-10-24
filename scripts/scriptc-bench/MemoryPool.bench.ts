// withAcquire does not compile under scriptc 0.4.4 (see README).
import { bench } from "./harness.js";
import * as MemoryPool from "../../src/MemoryPool.js";

const pool = MemoryPool.make({
  factory: (): number[] => [],
  reset: (a: number[]) => {
    a.length = 0;
  },
});

bench("acquire + push + release", (i) => {
  const a = MemoryPool.acquire(pool);
  a.push(i);
  const n = a.length;
  MemoryPool.release(pool, a);
  return n;
});
