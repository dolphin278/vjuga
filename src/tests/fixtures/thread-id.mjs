import { threadId } from "node:worker_threads";

// Returns the worker's threadId so tests can tell whether a worker was reused.
export default () => threadId;
