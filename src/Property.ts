/**
 * Property — runner for property-based tests with automatic shrinking.
 *
 * Runs an `Arbitrary<T>` generator against a predicate for many random inputs,
 * and when a failure is found, shrinks the counterexample to a minimal
 * reproduction. Supports both synchronous and asynchronous predicates.
 *
 * When to use: wrap `Arbitrary` generators with `assert` / `assertAsync` inside
 * `node:test` tests to verify properties over random inputs. Use `check` /
 * `checkAsync` when you need the raw `CheckResult` for programmatic inspection.
 * Set `timeoutMs` when a test may run indefinitely on slow predicates — the loop
 * exits early and returns the actual run count if the deadline passes.
 *
 * Design tradeoffs: the runner is split into sync and async variants rather
 * than always using async because the sync path avoids Promise allocation
 * overhead — property tests run millions of iterations and the overhead adds up.
 * The internal `stringify` is intentionally unexported; it exists solely to
 * format counterexamples in failure messages.
 *
 * @example
 * ```ts
 * import { test } from "node:test";
 * import * as Arb from "@dolphin278/vjuga/Arbitrary";
 * import * as Prop from "@dolphin278/vjuga/Property";
 *
 * test("sort is idempotent", () => {
 *   Prop.assert(Arb.array(Arb.integer()), (xs) => {
 *     const a = xs.toSorted((a, b) => a - b);
 *     const b = a.toSorted((a, b) => a - b);
 *     if (a.length !== b.length) return false;
 *     return a.every((v, i) => v === b[i]);
 *   });
 * });
 * ```
 */

import type { Fn1 } from "./FunctionUtils.js";
import { type Seed, make, split, randomSeed } from "./PRNG.js";
import type { Tree, Arbitrary } from "./Arbitrary.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for property checks. */
export interface CheckConfig {
  /** Number of test cases to run. Default 100. */
  readonly numRuns?: number;
  /** Initial PRNG seed. Default: random. */
  readonly seed?: Seed;
  /** Maximum size parameter passed to arbitraries. Default 100. */
  readonly maxSize?: number;
  /** Maximum successful shrink steps before giving up. Default 1000. */
  readonly maxShrinks?: number;
  /** Maximum predicate evaluations spent while shrinking (successful or not).
   *  Default `max(10_000, 10 * maxShrinks)`. Bounds shrinking time when most
   *  candidates pass. */
  readonly maxShrinkEvaluations?: number;
  /** Path string (from a failed `CheckResult.path`) for exact replay of a
   *  counterexample; requires the same `seed`. The predicate is evaluated once. */
  readonly path?: string;
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes (CheckResult.numRuns reflects
   *  actual completed runs), and shrinking stops at the deadline. */
  readonly timeoutMs?: number;
}

/** Result of a property check. */
export interface CheckResult<T> {
  /** Whether all tests passed. */
  readonly ok: boolean;
  /** Number of test cases that were run. */
  readonly numRuns: number;
  /** The seed used (for reproducibility). */
  readonly seed: Seed;
  /** The minimal counterexample (only present on failure). */
  readonly counterexample?: T;
  /** Number of successful shrink steps (only present on failure). */
  readonly shrinks?: number;
  /** The error thrown by the predicate for `counterexample` (undefined when
   *  the predicate returned `false` for it). */
  readonly error?: unknown;
  /** Path string for exact replay (only present on failure). */
  readonly path?: string;
}

// ---------------------------------------------------------------------------
// Internal: stringify for counterexample formatting
// ---------------------------------------------------------------------------

function stringify(value: unknown, depth = 4, seen = new Set<unknown>()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (t === "bigint") return `${value as bigint}n`;
  if (t === "boolean" || t === "symbol") return String(value);
  if (t === "function") return "[Function]";

  if (depth <= 0) return "[...]";

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Date(Invalid)" : `Date(${value.toISOString()})`;
  }
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.constructor.name}: ${value.message}`;

  // `seen` holds the containers on the current path only, so a shared but
  // acyclic reference (`[a, a]`) prints twice and only true cycles collapse.
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    return stringifyContainer(value as object, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function stringifyContainer(value: object, depth: number, seen: Set<unknown>): string {
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .slice(0, 10)
      .map(([k, v]) => `${stringify(k, depth - 1, seen)} => ${stringify(v, depth - 1, seen)}`);
    const suffix = value.size > 10 ? `, ... (${value.size - 10} more)` : "";
    return `Map(${entries.join(", ")}${suffix})`;
  }
  if (value instanceof Set) {
    const items = [...value].slice(0, 10).map((v) => stringify(v, depth - 1, seen));
    const suffix = value.size > 10 ? `, ... (${value.size - 10} more)` : "";
    return `Set(${items.join(", ")}${suffix})`;
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as ArrayLike<number>;
    const items = Array.from({ length: Math.min(arr.length, 10) }, (_, i) => arr[i]);
    const suffix = arr.length > 10 ? `, ... (${arr.length - 10} more)` : "";
    return `${value.constructor.name}[${items.join(", ")}${suffix}]`;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((v) => stringify(v, depth - 1, seen));
    const suffix = value.length > 20 ? `, ... (${value.length - 20} more)` : "";
    return `[${items.join(", ")}${suffix}]`;
  }

  // Plain object
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const entries = keys.slice(0, 20).map((k) => `${k}: ${stringify(obj[k], depth - 1, seen)}`);
  const suffix = keys.length > 20 ? `, ... (${keys.length - 20} more)` : "";
  return `{${entries.join(", ")}${suffix}}`;
}

// ---------------------------------------------------------------------------
// Internal: path encoding/decoding
// ---------------------------------------------------------------------------

/** Path format: `<testIdx>@<size>[:<childIdx>...]`. */
function encodePath(testIdx: number, size: number, indices: number[]): string {
  let out = `${testIdx}@${size}`;
  for (const idx of indices) out += `:${idx}`;
  return out;
}

interface ParsedPath {
  readonly testIdx: number;
  /** Undefined for legacy paths (`<testIdx>:...`) that predate size encoding. */
  readonly size: number | undefined;
  readonly shrinkIndices: number[];
}

function decodePath(path: string): ParsedPath {
  const parts = path.split(":");
  const head = parts[0]!.split("@");
  const nums = [...head, ...parts.slice(1)].map(Number);
  if (head.length > 2 || nums.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error(`Property: invalid replay path "${path}"`);
  }
  return {
    testIdx: nums[0]!,
    size: head.length === 2 ? nums[1]! : undefined,
    shrinkIndices: nums.slice(head.length),
  };
}

// ---------------------------------------------------------------------------
// Internal: predicate evaluation
// ---------------------------------------------------------------------------

/** Sentinel returned by `evalSync` when the predicate holds. */
const PASSED: unique symbol = Symbol("passed");

/**
 * Runs the predicate; returns PASSED, or the thrown error (undefined for
 * `false`). A Promise result fails with a TypeError instead of passing: the
 * sync runner cannot await it, and treating it as truthy would report a
 * failing async property as `ok`.
 */
function evalSync<T>(predicate: Fn1<T, boolean | void>, value: T): unknown {
  try {
    const result: unknown = predicate(value);
    if (result === false) return undefined;
    // true/undefined first: the common outcomes skip the thenable probe.
    if (result === true || result === undefined || !isThenable(result)) return PASSED;
    // Handle the rejection so it does not also surface as an unhandled error.
    result.then(undefined, ignoreRejection);
    return new TypeError("Property: predicate returned a Promise; use checkAsync/assertAsync");
  } catch (e) {
    return e;
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function ignoreRejection(): void {}

/* node:coverage disable */
async function evalAsync<T>(
  predicate: (value: T) => Promise<boolean | void>,
  value: T,
): Promise<unknown> {
  try {
    return (await predicate(value)) === false ? undefined : PASSED;
  } catch (e) {
    return e;
  }
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: shrink loop
// ---------------------------------------------------------------------------

interface ShrinkLimits {
  readonly maxShrinks: number;
  readonly maxShrinkEvaluations: number;
  readonly deadline: number | undefined;
}

interface ShrinkResult<T> {
  counterexample: T;
  shrinks: number;
  error: unknown;
  pathIndices: number[];
}

/** True once the evaluation budget or the wall-clock deadline is exhausted. */
function outOfBudget(evaluations: number, limits: ShrinkLimits): boolean {
  return (
    evaluations >= limits.maxShrinkEvaluations ||
    (limits.deadline !== undefined && Date.now() > limits.deadline)
  );
}

function shrinkSync<T>(
  tree: Tree<T>,
  predicate: Fn1<T, boolean | void>,
  initialError: unknown,
  limits: ShrinkLimits,
): ShrinkResult<T> {
  let best = tree.value;
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;
  const pathIndices: number[] = [];

  let current = tree;
  outer: while (shrinkCount < limits.maxShrinks) {
    let childIdx = 0;
    let found = false;
    for (const child of current.shrinks) {
      if (outOfBudget(evaluations, limits)) break outer;
      evaluations++;
      const outcome = evalSync(predicate, child.value);
      if (outcome !== PASSED) {
        best = child.value;
        bestError = outcome;
        shrinkCount++;
        pathIndices.push(childIdx);
        current = child;
        found = true;
        break;
      }
      childIdx++;
    }
    if (!found) break;
  }

  return { counterexample: best, shrinks: shrinkCount, error: bestError, pathIndices };
}

/* node:coverage disable */
async function shrinkAsync<T>(
  tree: Tree<T>,
  predicate: (value: T) => Promise<boolean | void>,
  initialError: unknown,
  limits: ShrinkLimits,
): Promise<ShrinkResult<T>> {
  let best = tree.value;
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;
  const pathIndices: number[] = [];

  let current = tree;
  outer: while (shrinkCount < limits.maxShrinks) {
    let childIdx = 0;
    let found = false;
    for (const child of current.shrinks) {
      if (outOfBudget(evaluations, limits)) break outer;
      evaluations++;
      const outcome = await evalAsync(predicate, child.value);
      if (outcome !== PASSED) {
        best = child.value;
        bestError = outcome;
        shrinkCount++;
        pathIndices.push(childIdx);
        current = child;
        found = true;
        break;
      }
      childIdx++;
    }
    if (!found) break;
  }

  return { counterexample: best, shrinks: shrinkCount, error: bestError, pathIndices };
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: replay from path
// ---------------------------------------------------------------------------

function replayPath<T>(tree: Tree<T>, indices: number[]): Tree<T> {
  let current = tree;
  for (const idx of indices) {
    let childIdx = 0;
    let found = false;
    for (const child of current.shrinks) {
      if (childIdx === idx) {
        current = child;
        found = true;
        break;
      }
      childIdx++;
    }
    if (!found) throw new Error(`Property: replay path diverged at shrink index ${idx}`);
  }
  return current;
}

/** Regenerates the tree for a path's test iteration and walks to its node. */
function replayTarget<T>(
  arb: Arbitrary<T>,
  cfg: ResolvedConfig,
  path: string,
): { tree: Tree<T>; parsed: ParsedPath } {
  const parsed = decodePath(path);
  const prng = make(cfg.seed);
  // Advance PRNG to the failing test iteration
  for (let i = 0; i < parsed.testIdx; i++) {
    split(prng); // discard
  }
  const size = parsed.size ?? sizeFor(parsed.testIdx, cfg.numRuns, cfg.maxSize);
  const tree = arb(split(prng), size);
  return { tree: replayPath(tree, parsed.shrinkIndices), parsed };
}

function replayResult<T>(
  cfg: ResolvedConfig,
  path: string,
  tree: Tree<T>,
  parsed: ParsedPath,
  outcome: unknown,
): CheckResult<T> {
  if (outcome === PASSED) return { ok: true, numRuns: 1, seed: cfg.seed };
  return {
    ok: false,
    numRuns: 1,
    seed: cfg.seed,
    counterexample: tree.value,
    shrinks: parsed.shrinkIndices.length,
    error: outcome,
    path,
  };
}

// ---------------------------------------------------------------------------
// Internal: resolve config defaults
// ---------------------------------------------------------------------------

type ResolvedConfig = ReturnType<typeof resolveConfig>;

/* node:coverage ignore next */
function resolveConfig(config?: CheckConfig) {
  const maxShrinks = config?.maxShrinks ?? 1000;
  return {
    numRuns: config?.numRuns ?? 100,
    seed: config?.seed ?? randomSeed(),
    maxSize: config?.maxSize ?? 100,
    maxShrinks,
    maxShrinkEvaluations: config?.maxShrinkEvaluations ?? Math.max(10_000, 10 * maxShrinks),
    path: config?.path,
    timeoutMs: config?.timeoutMs,
  };
}

/** Size for test iteration `i`: ramps linearly from 0 to maxSize. */
function sizeFor(i: number, numRuns: number, maxSize: number): number {
  return numRuns <= 1 ? maxSize : Math.floor((i * maxSize) / (numRuns - 1));
}

function failure<T>(
  cfg: ResolvedConfig,
  i: number,
  size: number,
  shrinkResult: ShrinkResult<T>,
): CheckResult<T> {
  return {
    ok: false,
    numRuns: i + 1,
    seed: cfg.seed,
    counterexample: shrinkResult.counterexample,
    shrinks: shrinkResult.shrinks,
    error: shrinkResult.error,
    path: encodePath(i, size, shrinkResult.pathIndices),
  };
}

// ---------------------------------------------------------------------------
// Public API: sync
// ---------------------------------------------------------------------------

/**
 * Runs a property check synchronously. Returns a detailed result object.
 * A predicate that returns a Promise fails with a `TypeError` (use
 * `checkAsync`); it is never counted as passing.
 *
 * With `config.path` set, regenerates exactly that counterexample (same
 * `seed` required), evaluates the predicate once and reports `ok: true` if it
 * now holds.
 */
export function check<T>(
  arb: Arbitrary<T>,
  predicate: Fn1<T, boolean | void>,
  config?: CheckConfig,
): CheckResult<T> {
  const cfg = resolveConfig(config);

  if (cfg.path !== undefined) {
    const { tree, parsed } = replayTarget(arb, cfg, cfg.path);
    return replayResult(cfg, cfg.path, tree, parsed, evalSync(predicate, tree.value));
  }

  const prng = make(cfg.seed);
  const deadline = cfg.timeoutMs !== undefined ? Date.now() + cfg.timeoutMs : undefined;
  let i = 0;
  for (; i < cfg.numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    const size = sizeFor(i, cfg.numRuns, cfg.maxSize);
    const tree = arb(split(prng), size);
    const outcome = evalSync(predicate, tree.value);
    if (outcome !== PASSED) {
      return failure(cfg, i, size, shrinkSync(tree, predicate, outcome, { ...cfg, deadline }));
    }
  }

  return { ok: true, numRuns: i, seed: cfg.seed };
}

/**
 * Runs a property check and throws on failure. Use in node:test tests.
 */
export function assert<T>(
  arb: Arbitrary<T>,
  predicate: Fn1<T, boolean | void>,
  config?: CheckConfig,
): void {
  const result = check(arb, predicate, config);
  if (!result.ok) {
    throwFailure(result);
  }
}

// ---------------------------------------------------------------------------
// Public API: async
// ---------------------------------------------------------------------------

/* node:coverage disable */
/**
 * Runs a property check with an async predicate. Returns a detailed result.
 * Path replay behaves as in `check`.
 */
export async function checkAsync<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => Promise<boolean | void>,
  config?: CheckConfig,
): Promise<CheckResult<T>> {
  const cfg = resolveConfig(config);

  if (cfg.path !== undefined) {
    const { tree, parsed } = replayTarget(arb, cfg, cfg.path);
    return replayResult(cfg, cfg.path, tree, parsed, await evalAsync(predicate, tree.value));
  }

  const prng = make(cfg.seed);
  const deadline = cfg.timeoutMs !== undefined ? Date.now() + cfg.timeoutMs : undefined;
  let i = 0;
  for (; i < cfg.numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    const size = sizeFor(i, cfg.numRuns, cfg.maxSize);
    const tree = arb(split(prng), size);
    const outcome = await evalAsync(predicate, tree.value);
    if (outcome !== PASSED) {
      const shrinkResult = await shrinkAsync(tree, predicate, outcome, { ...cfg, deadline });
      return failure(cfg, i, size, shrinkResult);
    }
  }

  return { ok: true, numRuns: i, seed: cfg.seed };
}

/**
 * Runs an async property check and throws on failure.
 */
export async function assertAsync<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => Promise<boolean | void>,
  config?: CheckConfig,
): Promise<void> {
  const result = await checkAsync(arb, predicate, config);
  if (!result.ok) {
    throwFailure(result);
  }
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: failure formatting
// ---------------------------------------------------------------------------

function throwFailure<T>(result: CheckResult<T>): never {
  /* node:coverage ignore next 6 */
  const lines = [
    "Property check failed!",
    `  Counterexample: ${stringify(result.counterexample)}`,
    `  After ${result.numRuns} test(s) and ${result.shrinks ?? 0} shrink(s)`,
    `  Seed: ${result.seed as unknown as bigint}n`,
  ];
  if (result.path !== undefined) {
    lines.push(
      `  Replay: { seed: seed(${result.seed as unknown as bigint}n), path: "${result.path}" }`,
    );
  }
  if (result.error !== undefined && result.error !== null) {
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    lines.push(`  Error: ${errMsg}`);
    // Keep the predicate's own stack reachable from the assertion error.
    throw new Error(lines.join("\n"), { cause: result.error });
  }
  throw new Error(lines.join("\n"));
}
