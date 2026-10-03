import {
  MSG_SHUTDOWN,
  MSG_RESULT,
  MSG_ERROR,
  MSG_READY,
  serializeThrown,
  reducedError,
} from "./WorkerPool.protocol.js";
import type { InboundMessage, OutboundMessage } from "./WorkerPool.protocol.js";

export type { InboundMessage, OutboundMessage };

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Runs in a separate V8 isolate that the coverage collector cannot instrument.
/* node:coverage disable */

import { parentPort, workerData } from "node:worker_threads";

const port = parentPort!;
// workerData is `{ filename, userData }`; user code reads its own data from
// `workerData.userData` (the `workerData` option of WorkerPool.make).
const { filename } = workerData as { filename: string };

const mod = await import(filename);
const handler = mod.default as (data: unknown) => unknown;
// Fail at startup (before READY) so the pool rejects with this error instead
// of every task failing later with "handler is not a function".
if (typeof handler !== "function") {
  throw new TypeError(
    `WorkerPool: module ${filename} must export a default function, got ${typeof handler}`,
  );
}

port.postMessage({ tag: MSG_READY } satisfies OutboundMessage);

port.on("message", async (msg: InboundMessage) => {
  if (msg.tag === MSG_SHUTDOWN) {
    process.exit(0);
  }
  let out: OutboundMessage;
  try {
    const result = await handler(msg.data);
    out = { tag: MSG_RESULT, taskId: msg.taskId, data: result };
  } catch (err) {
    out = { tag: MSG_ERROR, taskId: msg.taskId, error: serializeThrown(err) };
  }
  try {
    port.postMessage(out);
  } catch (postErr) {
    // Result (or error payload) was not structured-cloneable: send a reduced,
    // strings-only error so the task settles and this worker stays usable.
    port.postMessage({
      tag: MSG_ERROR,
      taskId: msg.taskId,
      error: reducedError(postErr),
    } satisfies OutboundMessage);
  }
});

/* node:coverage enable */
