import { workerData } from "node:worker_threads";

// Counts worker startups in a SharedArrayBuffer passed as workerData.
Atomics.add(new Int32Array(workerData.userData), 0, 1);
throw new Error("init failed");
