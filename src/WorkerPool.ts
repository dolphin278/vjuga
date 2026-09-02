/**
 * WorkerPool — thread pool using `node:worker_threads`.
 *
 * Distributes CPU-intensive work across real OS threads with message-passing,
 * structured cloning, and lifecycle management. Tasks are dispatched via a
 * PriorityQueue (lower priority number = higher priority).
 *
 * Hot-path optimizations:
 * - Idle workers stored as WorkerEntry refs (avoids Map lookup on dispatch)
 * - Fast path in run(): default-priority tasks bypass PQ when idle workers exist
 * - Reusable message object in sendTask() avoids per-call object allocation
 * - maybeResolveDrain() is only called when a drain deferred is pending
 *
 * When to use: CPU-bound tasks that block the event loop — image processing,
 * cryptography, compression, compute-heavy parsing. Thread creation and
 * structured-clone serialization make WorkerPool counterproductive for tasks
 * shorter than ~1ms. For I/O-bound concurrency, async/await +
 * `PromiseUtils.props` is simpler. The worker module must export a `default`
 * function and be a separate file.
 *
 * @example
 * ```ts
 * import * as WorkerPool from "@dolphin278/vjuga/WorkerPool";
 * const pool = WorkerPool.make({ filename: new URL("./worker.js", import.meta.url) });
 * ```
 */

import { Worker, type Transferable } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import * as PQ from "./PriorityQueue.js";
import { positiveInteger, nonNegativeInteger } from "./FunctionUtils.js";
import type { PositiveInteger, NonNegativeInteger } from "./FunctionUtils.js";
import { MSG_TASK, MSG_SHUTDOWN, MSG_RESULT, MSG_ERROR, MSG_READY } from "./WorkerPool.protocol.js";
import type { InboundMessage, OutboundMessage, SerializedError } from "./WorkerPool.protocol.js";

export class WorkerPoolDestroyedError extends Error {
  constructor() {
    super("WorkerPool is destroyed");
    this.name = "WorkerPoolDestroyedError";
  }
}

export class WorkerExitError extends Error {
  constructor() {
    super("Worker exited unexpectedly");
    this.name = "WorkerExitError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkerPoolConfig {
  /** Path to the worker module. Must export a default function. */
  filename: string | URL;
  /** Minimum number of threads to keep alive. Default: 0. */
  minThreads?: number;
  /** Maximum number of threads. Default: os.availableParallelism(). */
  maxThreads?: number;
  /** Idle timeout in ms before terminating excess threads. Default: 30000. 0 = no timeout. */
  idleTimeout?: number;
  /** Static data passed to all workers via workerData. */
  workerData?: unknown;
}

export interface RunOptions {
  /** Lower number = higher priority. Default: 0. */
  priority?: number;
  /** Transferable objects to transfer ownership. */
  transferList?: Transferable[];
  /** AbortSignal to cancel a queued or in-flight task. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Task<I = unknown, O = unknown> {
  readonly taskId: number;
  readonly data: I;
  readonly priority: number;
  readonly transferList: Transferable[] | undefined;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: O) => void;
  readonly reject: (reason: unknown) => void;
  aborted: boolean;
}

interface WorkerEntry {
  readonly worker: Worker;
  readonly threadId: number;
  ready: boolean;
  currentTask: Task | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const kFilename: unique symbol = Symbol("filename");
const kWorkers: unique symbol = Symbol("workers");
const kIdleWorkers: unique symbol = Symbol("idleWorkers");
const kTaskQueue: unique symbol = Symbol("taskQueue");
const kNextTaskId: unique symbol = Symbol("nextTaskId");
const kPendingTasks: unique symbol = Symbol("pendingTasks");
const kMinThreads: unique symbol = Symbol("minThreads");
const kMaxThreads: unique symbol = Symbol("maxThreads");
const kIdleTimeout: unique symbol = Symbol("idleTimeout");
const kDestroyed: unique symbol = Symbol("destroyed");
const kWorkerData: unique symbol = Symbol("workerData");
const kDrainDeferred: unique symbol = Symbol("drainDeferred");
const kBootstrapPath: unique symbol = Symbol("bootstrapPath");

// ---------------------------------------------------------------------------
// WorkerPool interface
// ---------------------------------------------------------------------------

export interface WorkerPool<I, O> {
  [kFilename]: string;
  [kWorkers]: Map<number, WorkerEntry>;
  [kIdleWorkers]: WorkerEntry[];
  [kTaskQueue]: PQ.PriorityQueue<Task<I, O>>;
  [kNextTaskId]: number;
  [kPendingTasks]: Map<number, Task<I, O>>;
  [kMinThreads]: NonNegativeInteger;
  [kMaxThreads]: PositiveInteger;
  [kIdleTimeout]: number;
  [kDestroyed]: boolean;
  [kWorkerData]: unknown;
  [kDrainDeferred]: PromiseWithResolvers<void> | undefined;
  [kBootstrapPath]: string;
}

// ---------------------------------------------------------------------------
// Task comparator: lower priority number = higher priority
// ---------------------------------------------------------------------------

const taskCmp: PQ.Comparator<Task> = (a, b) => a.priority - b.priority;

// ---------------------------------------------------------------------------
// Reusable message object — mutated in sendTask() to avoid allocation per call.
// Safe because postMessage() serializes synchronously before returning.
// ---------------------------------------------------------------------------

const taskMsg = { tag: MSG_TASK, taskId: 0, data: undefined as unknown };

// ---------------------------------------------------------------------------
// Bootstrap path resolution
// ---------------------------------------------------------------------------

const bootstrapUrl = new URL("./WorkerPool.worker.js", import.meta.url);
// protocol is always file: in Node.js tests
/* node:coverage ignore next 2 */
const defaultBootstrapPath =
  bootstrapUrl.protocol === "file:" ? fileURLToPath(bootstrapUrl) : bootstrapUrl.href;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new WorkerPool.
 */
export function make<I, O>(config: WorkerPoolConfig): WorkerPool<I, O> {
  const filename = config.filename instanceof URL ? config.filename.href : config.filename;
  const minThreads =
    config.minThreads !== undefined ? nonNegativeInteger(config.minThreads) : nonNegativeInteger(0);
  const maxThreads =
    config.maxThreads !== undefined
      ? positiveInteger(config.maxThreads)
      : positiveInteger(availableParallelism());
  const idleTimeout = config.idleTimeout !== undefined ? config.idleTimeout : 30_000;

  if (minThreads > maxThreads) {
    throw new RangeError(`minThreads (${minThreads}) must not exceed maxThreads (${maxThreads})`);
  }

  const pool: WorkerPool<I, O> = {
    [kFilename]: filename,
    [kWorkers]: new Map(),
    [kIdleWorkers]: [],
    [kTaskQueue]: PQ.make<Task<I, O>>(taskCmp as PQ.Comparator<Task<I, O>>),
    [kNextTaskId]: 0,
    [kPendingTasks]: new Map(),
    [kMinThreads]: minThreads,
    [kMaxThreads]: maxThreads,
    [kIdleTimeout]: idleTimeout,
    [kDestroyed]: false,
    [kWorkerData]: config.workerData,
    [kDrainDeferred]: undefined,
    [kBootstrapPath]: defaultBootstrapPath,
  };

  // Pre-spawn minThreads workers.
  for (let i = 0; i < minThreads; i++) {
    spawnWorker(pool);
  }

  return pool;
}

/**
 * Submits a task to the pool. Returns a promise that resolves with the result.
 */
export function run<I, O>(pool: WorkerPool<I, O>, data: I, options?: RunOptions): Promise<O> {
  if (pool[kDestroyed]) {
    return Promise.reject(new WorkerPoolDestroyedError());
  }

  const signal = options?.signal;

  // Fast path: already aborted.
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<O>((resolve, reject) => {
    const taskId = pool[kNextTaskId]++;
    const priority = options?.priority ?? 0;
    const transferList = options?.transferList;
    const task: Task<I, O> = {
      taskId,
      data,
      priority,
      transferList,
      signal,
      resolve,
      reject,
      aborted: false,
    };

    if (signal) {
      const onAbort = () => {
        task.aborted = true;
        // If it's still in the pending map (in-flight), reject immediately.
        if (pool[kPendingTasks].has(taskId)) {
          pool[kPendingTasks].delete(taskId);
          reject(signal.reason);
        } else {
          // Queued — it will be skipped by dequeueNextValid.
          reject(signal.reason);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Fast path: default priority, idle worker available, no queued tasks.
    // Bypasses PQ push+pop entirely — the common case for pre-warmed pools.
    if (priority === 0 && PQ.size(pool[kTaskQueue]) === 0) {
      const entry = popIdleWorker(pool);
      if (entry) {
        dispatchTask(pool, entry, task);
        return;
      }
      // No idle worker — try to spawn one.
      if (pool[kWorkers].size < pool[kMaxThreads]) {
        const newEntry = spawnWorker(pool);
        newEntry.currentTask = task as Task;
        pool[kPendingTasks].set(task.taskId, task);
        return;
      }
    }

    PQ.push(pool[kTaskQueue], task);
    tryDispatch(pool);
  });
}

/**
 * Returns the number of tasks currently being executed by workers.
 */
export function activeCount<I, O>(pool: WorkerPool<I, O>): number {
  return pool[kPendingTasks].size;
}

/**
 * Returns the number of tasks waiting in the queue.
 */
export function pendingCount<I, O>(pool: WorkerPool<I, O>): number {
  return PQ.size(pool[kTaskQueue]);
}

/**
 * Returns a promise that resolves when all active and queued tasks are done.
 * Resolves immediately if the pool is already idle.
 */
export function drain<I, O>(pool: WorkerPool<I, O>): Promise<void> {
  if (pool[kPendingTasks].size === 0 && PQ.size(pool[kTaskQueue]) === 0) {
    return Promise.resolve();
  }
  if (!pool[kDrainDeferred]) {
    pool[kDrainDeferred] = Promise.withResolvers<void>();
  }
  return pool[kDrainDeferred].promise;
}

/**
 * Terminates all workers and rejects any pending/queued tasks.
 */
export async function destroy<I, O>(pool: WorkerPool<I, O>): Promise<void> {
  pool[kDestroyed] = true;

  // Reject all queued tasks.
  const destroyError = new WorkerPoolDestroyedError();
  let task: Task<I, O> | undefined;
  while ((task = PQ.pop(pool[kTaskQueue])) !== undefined) {
    if (!task.aborted) {
      task.reject(destroyError);
    }
  }

  // Reject all in-flight tasks.
  for (const pending of pool[kPendingTasks].values()) {
    if (!pending.aborted) {
      pending.reject(destroyError);
    }
  }
  pool[kPendingTasks].clear();

  // Terminate all workers.
  const terminatePromises: Promise<number>[] = [];
  for (const entry of pool[kWorkers].values()) {
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    terminatePromises.push(entry.worker.terminate());
  }
  pool[kWorkers].clear();
  pool[kIdleWorkers].length = 0;

  await Promise.all(terminatePromises);

  // Resolve drain if anyone is waiting. Worker exit handlers normally resolve
  // the drain via maybeResolveDrain, but this is a defensive fallback in case
  // all workers were already removed or terminate didn't fire exit.
  // defensive: exit handlers resolve drain before this runs
  /* node:coverage ignore next 5 */
  if (pool[kDrainDeferred]) {
    const deferred = pool[kDrainDeferred];
    pool[kDrainDeferred] = undefined;
    deferred.resolve();
  }
}

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

function spawnWorker<I, O>(pool: WorkerPool<I, O>): WorkerEntry {
  const worker = new Worker(pool[kBootstrapPath], {
    workerData: {
      filename: pool[kFilename],
      userData: pool[kWorkerData],
    },
  });

  const entry: WorkerEntry = {
    worker,
    threadId: worker.threadId,
    ready: false,
    currentTask: undefined,
    idleTimer: undefined,
  };

  pool[kWorkers].set(worker.threadId, entry);

  worker.on("message", (msg: OutboundMessage) => {
    handleWorkerMessage(pool, entry, msg);
  });
  worker.on("error", (err: Error) => {
    handleWorkerError(pool, entry, err);
  });
  worker.on("exit", (code: number) => {
    handleWorkerExit(pool, entry, code);
  });

  return entry;
}

function tryDispatch<I, O>(pool: WorkerPool<I, O>): void {
  while (PQ.size(pool[kTaskQueue]) > 0) {
    const task = dequeueNextValid(pool);
    // defensive: all queued tasks aborted synchronously
    /* node:coverage ignore next 2 */
    if (!task) break;

    // Try to find an idle worker.
    const entry = popIdleWorker(pool);
    if (entry) {
      dispatchTask(pool, entry, task);
      continue;
    }

    // Try to spawn a new worker if below maxThreads.
    if (pool[kWorkers].size < pool[kMaxThreads]) {
      const newEntry = spawnWorker(pool);
      // Worker not ready yet — store the task and it will be dispatched on READY.
      newEntry.currentTask = task as Task;
      pool[kPendingTasks].set(task.taskId, task);
      continue;
    }

    // No workers available — push back and wait.
    PQ.push(pool[kTaskQueue], task);
    break;
  }
}

function popIdleWorker<I, O>(pool: WorkerPool<I, O>): WorkerEntry | undefined {
  const idleWorkers = pool[kIdleWorkers];
  while (idleWorkers.length > 0) {
    const entry = idleWorkers.pop()!;
    if (entry.ready && !entry.currentTask) {
      if (entry.idleTimer !== undefined) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = undefined;
      }
      return entry;
    }
  }
  return undefined;
}

/**
 * Sends a task message to a worker. Uses the reusable `taskMsg` object —
 * postMessage() serializes synchronously, so mutation between calls is safe.
 */
function sendTask(entry: WorkerEntry, task: Task): void {
  taskMsg.taskId = task.taskId;
  taskMsg.data = task.data;
  if (task.transferList) {
    entry.worker.postMessage(taskMsg, task.transferList);
  } else {
    entry.worker.postMessage(taskMsg);
  }
  // Clear data reference so we don't retain it after postMessage serialized it.
  taskMsg.data = undefined;
}

function dispatchTask<I, O>(pool: WorkerPool<I, O>, entry: WorkerEntry, task: Task<I, O>): void {
  entry.currentTask = task as Task;
  pool[kPendingTasks].set(task.taskId, task);
  sendTask(entry, task as Task);
}

function handleWorkerMessage<I, O>(
  pool: WorkerPool<I, O>,
  entry: WorkerEntry,
  msg: OutboundMessage,
): void {
  if (msg.tag === MSG_READY) {
    entry.ready = true;
    // If a task was stored before worker was ready, dispatch it now.
    if (entry.currentTask) {
      const task = entry.currentTask as Task<I, O>;
      // Check if the task was aborted while waiting for the worker.
      if (task.aborted) {
        entry.currentTask = undefined;
        pool[kPendingTasks].delete(task.taskId);
        markWorkerIdle(pool, entry);
      } else {
        sendTask(entry, task as Task);
      }
    } else {
      markWorkerIdle(pool, entry);
    }
    return;
  }

  if (msg.tag === MSG_RESULT) {
    const task = pool[kPendingTasks].get(msg.taskId) as Task<I, O> | undefined;
    pool[kPendingTasks].delete(msg.taskId);
    entry.currentTask = undefined;
    if (task && !task.aborted) {
      task.resolve(msg.data as O);
    }
    // markWorkerIdle handles drain resolution internally.
    markWorkerIdle(pool, entry);
    return;
  }

  if (msg.tag === MSG_ERROR) {
    const task = pool[kPendingTasks].get(msg.taskId) as Task<I, O> | undefined;
    pool[kPendingTasks].delete(msg.taskId);
    entry.currentTask = undefined;
    if (task && !task.aborted) {
      task.reject(deserializeError(msg.error));
    }
    markWorkerIdle(pool, entry);
    return;
  }
}

function markWorkerIdle<I, O>(pool: WorkerPool<I, O>, entry: WorkerEntry): void {
  // Try to dispatch another task first.
  const task = dequeueNextValid(pool);
  if (task) {
    dispatchTask(pool, entry, task);
    return;
  }

  // No pending tasks — mark idle.
  pool[kIdleWorkers].push(entry);

  if (pool[kIdleTimeout] > 0 && pool[kWorkers].size > pool[kMinThreads]) {
    entry.idleTimer = setTimeout(() => {
      terminateIdleWorker(pool, entry);
    }, pool[kIdleTimeout]);
  }

  if (pool[kDrainDeferred]) maybeResolveDrain(pool);
}

function terminateIdleWorker<I, O>(pool: WorkerPool<I, O>, entry: WorkerEntry): void {
  // defensive: timer fires after task dispatched to this worker
  /* node:coverage ignore next 2 */
  if (entry.currentTask) return;
  // defensive: another worker exited between setTimeout and callback
  /* node:coverage ignore next 2 */
  if (pool[kWorkers].size <= pool[kMinThreads]) return;

  entry.idleTimer = undefined;
  pool[kWorkers].delete(entry.threadId);
  // Remove from idle stack.
  const idx = pool[kIdleWorkers].indexOf(entry);
  if (idx !== -1) pool[kIdleWorkers].splice(idx, 1);

  entry.worker.postMessage({ tag: MSG_SHUTDOWN } satisfies InboundMessage);
}

function handleWorkerError<I, O>(pool: WorkerPool<I, O>, entry: WorkerEntry, err: Error): void {
  const task = entry.currentTask as Task<I, O> | undefined;
  entry.currentTask = undefined;
  if (task) {
    pool[kPendingTasks].delete(task.taskId);
    if (!task.aborted) {
      task.reject(err);
    }
  }
}

function handleWorkerExit<I, O>(pool: WorkerPool<I, O>, entry: WorkerEntry, _code: number): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
  pool[kWorkers].delete(entry.threadId);
  // Remove from idle stack.
  const idx = pool[kIdleWorkers].indexOf(entry);
  if (idx !== -1) pool[kIdleWorkers].splice(idx, 1);

  // Handle in-flight task.
  const task = entry.currentTask as Task<I, O> | undefined;
  entry.currentTask = undefined;
  if (task) {
    pool[kPendingTasks].delete(task.taskId);
    if (!task.aborted) {
      task.reject(new WorkerExitError());
    }
  }

  // Replace if below minThreads and not destroyed.
  if (!pool[kDestroyed] && pool[kWorkers].size < pool[kMinThreads]) {
    spawnWorker(pool);
  }

  if (pool[kDrainDeferred]) maybeResolveDrain(pool);
}

function dequeueNextValid<I, O>(pool: WorkerPool<I, O>): Task<I, O> | undefined {
  while (PQ.size(pool[kTaskQueue]) > 0) {
    const task = PQ.pop(pool[kTaskQueue])!;
    if (!task.aborted) return task;
  }
  return undefined;
}

function maybeResolveDrain<I, O>(pool: WorkerPool<I, O>): void {
  if (pool[kPendingTasks].size === 0 && PQ.size(pool[kTaskQueue]) === 0) {
    const deferred = pool[kDrainDeferred]!;
    pool[kDrainDeferred] = undefined;
    deferred.resolve();
  }
}

function deserializeError(serialized: SerializedError): Error {
  const cause =
    serialized.cause !== undefined
      ? typeof serialized.cause === "object" &&
        serialized.cause !== null &&
        "message" in serialized.cause
        ? deserializeError(serialized.cause as SerializedError)
        : serialized.cause
      : undefined;
  const err =
    cause !== undefined ? new Error(serialized.message, { cause }) : new Error(serialized.message);
  err.name = serialized.name;
  if (serialized.stack !== undefined) {
    err.stack = serialized.stack;
  }
  for (const key of Object.keys(serialized.properties)) {
    (err as unknown as Record<string, unknown>)[key] = serialized.properties[key];
  }
  return err;
}
