import * as BatchExecutor from "../../src/BatchExecutor.js";
const load = BatchExecutor.make(
  async (ids: number[]) => ids.map((id) => ({ status: "fulfilled" as const, value: id * 2 })),
  { maxBatchSize: 10, maxInFlight: 1 },
);
console.log((await Promise.all([load(1), load(2)])).join(","));
