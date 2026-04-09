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
  readonly error: SerializedError;
}

/** Worker → Main: worker is ready. */
export interface ReadyMessage {
  readonly tag: typeof MSG_READY;
}

/** Messages sent from worker to main thread. */
export type OutboundMessage = ResultMessage | ErrorMessage | ReadyMessage;

export interface SerializedError {
  message: string;
  name: string;
  stack: string | undefined;
  cause: SerializedError | unknown | undefined;
  properties: Record<string, unknown>;
}
