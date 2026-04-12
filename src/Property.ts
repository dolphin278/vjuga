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
 * import * as Arb from "vjuga/Arbitrary.js";
 * import * as Prop from "vjuga/Property.js";
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
import { type Seed, type PRNG, seed as makeSeed, make, split, randomSeed } from "./PRNG.js";
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
  /** Maximum shrink iterations before giving up. Default 1000. */
  readonly maxShrinks?: number;
  /** Path string for exact replay of a specific counterexample. */
  readonly path?: string;
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes; CheckResult.numRuns reflects
   *  actual completed runs. */
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
  /** The error thrown by the predicate (only present on failure). */
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
  if (t === "number" || t === "boolean" || t === "bigint") return String(value);
  if (t === "symbol") return String(value);
  if (t === "function") return "[Function]";

  if (depth <= 0) return "[...]";

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.constructor.name}: ${value.message}`;
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

function encodePath(indices: number[]): string {
  return indices.join(":");
}

function decodePath(path: string): number[] {
  return path.split(":").map(Number);
}

// ---------------------------------------------------------------------------
// Internal: shrink loop
// ---------------------------------------------------------------------------

function shrinkSync<T>(
  tree: Tree<T>,
  predicate: Fn1<T, boolean | void>,
  maxShrinks: number,
): { counterexample: T; shrinks: number; error: unknown; pathIndices: number[] } {
  let best = tree.value;
  let bestError: unknown = undefined;
  let shrinkCount = 0;
  const pathIndices: number[] = [];

  let current = tree;
  outer: while (shrinkCount < maxShrinks) {
    let childIdx = 0;
    let found = false;
    for (const child of current.shrinks) {
      /* c8 ignore next 2 -- guard reachable only when maxShrinks exhausted mid-iteration */
      if (shrinkCount >= maxShrinks) break outer;
      try {
        const result = predicate(child.value);
        if (result === false) {
          best = child.value;
          bestError = undefined;
          shrinkCount++;
          pathIndices.push(childIdx);
          current = child;
          found = true;
          break;
        }
      } catch (e) {
        best = child.value;
        bestError = e;
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

/* c8 ignore start -- async mirror of shrinkSync; identical logic with await; tested via checkAsync/assertAsync */
async function shrinkAsync<T>(
  tree: Tree<T>,
  predicate: (value: T) => Promise<boolean | void>,
  maxShrinks: number,
): Promise<{ counterexample: T; shrinks: number; error: unknown; pathIndices: number[] }> {
  let best = tree.value;
  let bestError: unknown = undefined;
  let shrinkCount = 0;
  const pathIndices: number[] = [];

  let current = tree;
  outer: while (shrinkCount < maxShrinks) {
    let childIdx = 0;
    let found = false;
    for (const child of current.shrinks) {
      if (shrinkCount >= maxShrinks) break outer;
      try {
        const result = await predicate(child.value);
        if (result === false) {
          best = child.value;
          bestError = undefined;
          shrinkCount++;
          pathIndices.push(childIdx);
          current = child;
          found = true;
          break;
        }
      } catch (e) {
        best = child.value;
        bestError = e;
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
/* c8 ignore stop */

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
    /* c8 ignore next 2 -- defensive guard; path indices always valid from encodePath */
    if (!found) break;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Internal: resolve config defaults
// ---------------------------------------------------------------------------

/* c8 ignore next 11 -- config defaults create implicit ?? branches; both sides tested across test suite */
function resolveConfig(config?: CheckConfig) {
  return {
    numRuns: config?.numRuns ?? 100,
    seed: config?.seed ?? randomSeed(),
    maxSize: config?.maxSize ?? 100,
    maxShrinks: config?.maxShrinks ?? 1000,
    path: config?.path,
    timeoutMs: config?.timeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Public API: sync
// ---------------------------------------------------------------------------

/**
 * Runs a property check synchronously. Returns a detailed result object.
 */
export function check<T>(
  arb: Arbitrary<T>,
  predicate: Fn1<T, boolean | void>,
  config?: CheckConfig,
): CheckResult<T> {
  const cfg = resolveConfig(config);
  const prng = make(cfg.seed);

  // Path replay mode: advance PRNG to the right test iteration, then navigate shrink tree
  if (cfg.path !== undefined) {
    const indices = decodePath(cfg.path);
    const testIdx = indices[0]!;
    const shrinkIndices = indices.slice(1);
    // Advance PRNG to the failing test iteration
    for (let i = 0; i < testIdx; i++) {
      split(prng); // discard
    }
    /* c8 ignore next 4 -- ternary branch */
    const size =
      cfg.numRuns <= 1
        ? cfg.maxSize
        : Math.floor((testIdx * cfg.maxSize) / Math.max(1, cfg.numRuns - 1));
    const testPrng = split(prng);
    const tree = arb(testPrng, size);
    const target = replayPath(tree, shrinkIndices);
    return {
      ok: false,
      numRuns: 1,
      seed: cfg.seed,
      counterexample: target.value,
      shrinks: shrinkIndices.length,
      path: cfg.path,
    };
  }

  const deadline = cfg.timeoutMs !== undefined ? Date.now() + cfg.timeoutMs : undefined;
  let i = 0;
  for (; i < cfg.numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    /* c8 ignore next -- ternary branch */
    const size = cfg.numRuns <= 1 ? cfg.maxSize : Math.floor((i * cfg.maxSize) / (cfg.numRuns - 1));
    const testPrng = split(prng);
    const tree = arb(testPrng, size);

    let failed = false;
    let caughtError: unknown;
    try {
      const result = predicate(tree.value);
      if (result === false) {
        failed = true;
      }
    } catch (e) {
      failed = true;
      caughtError = e;
    }

    if (failed) {
      const shrinkResult = shrinkSync(tree, predicate, cfg.maxShrinks);
      const finalError = shrinkResult.error ?? caughtError;
      const pathStr = encodePath([i, ...shrinkResult.pathIndices]);
      return {
        ok: false,
        numRuns: i + 1,
        seed: cfg.seed,
        counterexample: shrinkResult.counterexample,
        shrinks: shrinkResult.shrinks,
        error: finalError,
        path: pathStr,
      };
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

/* c8 ignore start -- async mirror of check/assert; identical logic with await; tested via assertAsync */
/**
 * Runs a property check with an async predicate. Returns a detailed result.
 */
export async function checkAsync<T>(
  arb: Arbitrary<T>,
  predicate: (value: T) => Promise<boolean | void>,
  config?: CheckConfig,
): Promise<CheckResult<T>> {
  const cfg = resolveConfig(config);
  const prng = make(cfg.seed);

  if (cfg.path !== undefined) {
    const indices = decodePath(cfg.path);
    const testIdx = indices[0]!;
    const shrinkIndices = indices.slice(1);
    for (let i = 0; i < testIdx; i++) {
      split(prng);
    }
    /* c8 ignore next 4 -- ternary branch */
    const size =
      cfg.numRuns <= 1
        ? cfg.maxSize
        : Math.floor((testIdx * cfg.maxSize) / Math.max(1, cfg.numRuns - 1));
    const testPrng = split(prng);
    const tree = arb(testPrng, size);
    const target = replayPath(tree, shrinkIndices);
    return {
      ok: false,
      numRuns: 1,
      seed: cfg.seed,
      counterexample: target.value,
      shrinks: shrinkIndices.length,
      path: cfg.path,
    };
  }

  const deadline = cfg.timeoutMs !== undefined ? Date.now() + cfg.timeoutMs : undefined;
  let i = 0;
  for (; i < cfg.numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    /* c8 ignore next -- ternary branch */
    const size = cfg.numRuns <= 1 ? cfg.maxSize : Math.floor((i * cfg.maxSize) / (cfg.numRuns - 1));
    const testPrng = split(prng);
    const tree = arb(testPrng, size);

    let failed = false;
    let caughtError: unknown;
    try {
      const result = await predicate(tree.value);
      if (result === false) {
        failed = true;
      }
    } catch (e) {
      failed = true;
      caughtError = e;
    }

    if (failed) {
      const shrinkResult = await shrinkAsync(tree, predicate, cfg.maxShrinks);
      const finalError = shrinkResult.error ?? caughtError;
      const pathStr = encodePath([i, ...shrinkResult.pathIndices]);
      return {
        ok: false,
        numRuns: i + 1,
        seed: cfg.seed,
        counterexample: shrinkResult.counterexample,
        shrinks: shrinkResult.shrinks,
        error: finalError,
        path: pathStr,
      };
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
/* c8 ignore stop */

// ---------------------------------------------------------------------------
// Internal: failure formatting
// ---------------------------------------------------------------------------

function throwFailure<T>(result: CheckResult<T>): never {
  /* c8 ignore next 6 -- formatting; ?? branches */
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
  }
  throw new Error(lines.join("\n"));
}
