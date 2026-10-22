import { workerData } from "node:worker_threads";

// Counts worker startups in a SharedArrayBuffer (workerData); no default export.
Atomics.add(new Int32Array(workerData.userData), 0, 1);
export const notDefault = 1;
