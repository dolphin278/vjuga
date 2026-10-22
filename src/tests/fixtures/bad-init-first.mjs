import { workerData } from "node:worker_threads";

// Counts startups in a SharedArrayBuffer (workerData); only the FIRST startup
// fails, later workers echo their input.
if (Atomics.add(new Int32Array(workerData.userData), 0, 1) === 0) {
  throw new Error("init failed");
}
export default (x) => x;
