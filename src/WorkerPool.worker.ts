import { MSG_SHUTDOWN, MSG_RESULT, MSG_ERROR, MSG_READY } from "./WorkerPool.protocol.js";
import type { InboundMessage, OutboundMessage, SerializedError } from "./WorkerPool.protocol.js";

export type { InboundMessage, OutboundMessage, SerializedError };

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

function serializeError(err: unknown): SerializedError {
  if (!(err instanceof Error)) {
    return {
      message: String(err),
      name: "Error",
      stack: undefined,
      cause: undefined,
      properties: {},
    };
  }
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(err)) {
    if (key !== "message" && key !== "stack" && key !== "name" && key !== "cause") {
      props[key] = (err as unknown as Record<string, unknown>)[key];
    }
  }
  return {
    message: err.message,
    name: err.name,
    stack: err.stack,
    cause: err.cause instanceof Error ? serializeError(err.cause) : err.cause,
    properties: props,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Runs in a separate V8 isolate that the coverage collector cannot instrument.
/* node:coverage disable */

import { parentPort, workerData } from "node:worker_threads";

const port = parentPort!;
const { filename } = workerData as { filename: string };

const mod = await import(filename);
const handler = mod.default as (data: unknown) => unknown;

port.postMessage({ tag: MSG_READY } satisfies OutboundMessage);

port.on("message", async (msg: InboundMessage) => {
  if (msg.tag === MSG_SHUTDOWN) {
    process.exit(0);
  }
  try {
    const result = await handler(msg.data);
    port.postMessage({
      tag: MSG_RESULT,
      taskId: msg.taskId,
      data: result,
    } satisfies OutboundMessage);
  } catch (err) {
    port.postMessage({
      tag: MSG_ERROR,
      taskId: msg.taskId,
      error: serializeError(err),
    } satisfies OutboundMessage);
  }
});

/* node:coverage enable */
