import { benchAsync } from "./harness.js";
import * as BatchExecutor from "../../src/BatchExecutor.js";

// 3, not 16: under scriptc 0.4.4 a batch of 4 or more items rejects with
// "TypeError: expected array | undefined at $[0], got object" (unfiled; the
// smoke suite only sends batches of 2). Raise to 16 once that is fixed.
const BATCH = 3;

const load = BatchExecutor.make(
  async (ids: number[]) => ids.map((id) => ({ status: "fulfilled" as const, value: id * 2 })),
  "io",
);

// BATCH loads coalesce into one batch, flushed by setImmediate.
await benchAsync(`${BATCH} loads -> 1 batch (io)`, async (i) => {
  const ps: Promise<number>[] = [];
  for (let k = 0; k < BATCH; k++) ps.push(load(i + k));
  const rs = await Promise.all(ps);
  let s = 0;
  for (const r of rs) s += r;
  return s;
});
