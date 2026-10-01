/** Main → Worker message tags. */
export const MSG_TASK = 0 as const;
export const MSG_SHUTDOWN = 1 as const;

/** Worker → Main message tags. */
export const MSG_RESULT = 0 as const;
export const MSG_ERROR = 1 as const;
export const MSG_READY = 2 as const;

/** Main → Worker: execute a task. */
export interface TaskMessage {
  readonly tag: typeof MSG_TASK;
  readonly taskId: number;
  readonly data: unknown;
}

/** Main → Worker: graceful shutdown. */
export interface ShutdownMessage {
  readonly tag: typeof MSG_SHUTDOWN;
}

/** Messages sent from main thread to worker. */
export type InboundMessage = TaskMessage | ShutdownMessage;

/** Worker → Main: task result. */
export interface ResultMessage {
  readonly tag: typeof MSG_RESULT;
  readonly taskId: number;
  readonly data: unknown;
}

/** Worker → Main: task error. */
export interface ErrorMessage {
  readonly tag: typeof MSG_ERROR;
  readonly taskId: number;
  readonly error: SerializedThrown;
}

/** Worker → Main: worker is ready. */
export interface ReadyMessage {
  readonly tag: typeof MSG_READY;
}

/** Messages sent from worker to main thread. */
export type OutboundMessage = ResultMessage | ErrorMessage | ReadyMessage;

// ---------------------------------------------------------------------------
// Thrown-value (de)serialization. Shared by worker (encode) and main (decode).
// Every field is tolerated missing/malformed on decode; encode never throws.
// ---------------------------------------------------------------------------

/** Discriminant for SerializedThrown. */
export const SER_ERROR = 0 as const;
export const SER_VALUE = 1 as const;

/** An `Error` instance thrown in the worker. */
export interface SerializedError {
  readonly kind: typeof SER_ERROR;
  message: string;
  name: string;
  stack: string | undefined;
  cause: SerializedThrown | undefined;
  properties: Record<string, unknown>;
}

/** A non-Error throwable (structured-cloned, or its string form if uncloneable). */
export interface SerializedValue {
  readonly kind: typeof SER_VALUE;
  readonly value: unknown;
}

export type SerializedThrown = SerializedError | SerializedValue;

const MAX_CAUSE_DEPTH = 16;
const RESERVED = new Set(["message", "stack", "name", "cause"]);

function cloneable(value: unknown): boolean {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unserializable]";
  }
}

function safeRead(obj: object, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Reduced payload: strings only, always structured-cloneable. */
export function reducedError(thrown: unknown): SerializedError {
  const isErr = thrown instanceof Error;
  const name = isErr ? safeRead(thrown, "name") : undefined;
  return {
    kind: SER_ERROR,
    message: safeString(isErr ? safeRead(thrown, "message") : thrown),
    name: typeof name === "string" ? name : "Error",
    stack: undefined,
    cause: undefined,
    properties: {},
  };
}

/** Encodes anything thrown. Never throws; the result is structured-cloneable. */
export function serializeThrown(thrown: unknown, depth = 0): SerializedThrown {
  if (!(thrown instanceof Error)) {
    return { kind: SER_VALUE, value: cloneable(thrown) ? thrown : safeString(thrown) };
  }
  const out = reducedError(thrown);
  const stack = safeRead(thrown, "stack");
  if (typeof stack === "string") out.stack = stack;
  const cause = safeRead(thrown, "cause");
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = serializeThrown(cause, depth + 1);
  }
  let keys: string[] = [];
  try {
    keys = Object.keys(thrown);
  } catch {
    // Proxy trap threw — ship no custom properties.
  }
  for (const key of keys) {
    if (RESERVED.has(key)) continue;
    const value = safeRead(thrown, key);
    if (cloneable(value)) out.properties[key] = value;
  }
  return out;
}

/** Decodes a serialized throwable. Tolerates malformed input; never throws. */
export function deserializeThrown(serialized: unknown, depth = 0): unknown {
  if (typeof serialized !== "object" || serialized === null) {
    return new Error("WorkerPool: malformed error payload");
  }
  const s = serialized as Record<string, unknown>;
  if (s.kind === SER_VALUE) return s.value;
  if (s.kind !== SER_ERROR) return new Error("WorkerPool: malformed error payload");

  const cause =
    s.cause !== undefined && depth < MAX_CAUSE_DEPTH
      ? deserializeThrown(s.cause, depth + 1)
      : undefined;
  const message = typeof s.message === "string" ? s.message : safeString(s.message ?? "");
  const err = cause !== undefined ? new Error(message, { cause }) : new Error(message);
  if (typeof s.name === "string") err.name = s.name;
  if (typeof s.stack === "string") err.stack = s.stack;
  const props = s.properties;
  if (typeof props === "object" && props !== null) {
    for (const key of Object.keys(props)) {
      if (RESERVED.has(key)) continue;
      Object.defineProperty(err, key, {
        value: (props as Record<string, unknown>)[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return err;
}
