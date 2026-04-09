/* c8 ignore start -- runs in a separate V8 isolate that c8 cannot instrument */

/**
 * WorkerPool bootstrap — loaded by each worker thread.
 *
 * Dynamically imports the user-provided handler module, signals readiness,
 * then processes task messages and returns results/errors to the main thread.
 */

import { parentPort, workerData } from "node:worker_threads";

// ---------------------------------------------------------------------------
// Message protocol (numeric tags for V8 Smi optimization)
// ---------------------------------------------------------------------------

/** Main → Worker message tags. */
const MSG_TASK = 0 as const;
const MSG_SHUTDOWN = 1 as const;

/** Worker → Main message tags. */
const MSG_RESULT = 0 as const;
const MSG_ERROR = 1 as const;
const MSG_READY = 2 as const;

/** Main → Worker: execute a task. */
interface TaskMessage {
  readonly tag: typeof MSG_TASK;
  readonly taskId: number;
  readonly data: unknown;
}

/** Main → Worker: graceful shutdown. */
interface ShutdownMessage {
  readonly tag: typeof MSG_SHUTDOWN;
}

/** Messages sent from main thread to worker. */
type InboundMessage = TaskMessage | ShutdownMessage;

/** Worker → Main: task result. */
interface ResultMessage {
  readonly tag: typeof MSG_RESULT;
  readonly taskId: number;
  readonly data: unknown;
}

/** Worker → Main: task error. */
interface ErrorMessage {
  readonly tag: typeof MSG_ERROR;
  readonly taskId: number;
  readonly error: SerializedError;
}

/** Worker → Main: worker is ready. */
interface ReadyMessage {
  readonly tag: typeof MSG_READY;
}

/** Messages sent from worker to main thread. */
type OutboundMessage = ResultMessage | ErrorMessage | ReadyMessage;

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

interface SerializedError {
  message: string;
  name: string;
  stack: string | undefined;
  cause: SerializedError | unknown | undefined;
  properties: Record<string, unknown>;
}

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

export type { InboundMessage, OutboundMessage, SerializedError };

/* c8 ignore stop */
