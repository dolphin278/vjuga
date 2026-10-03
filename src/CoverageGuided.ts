/**
 * CoverageGuided — time-boxed fuzzing, with V8 coverage feedback in the async
 * variant.
 *
 * `fuzz` (sync) is random fuzzing: it replays `config.corpus` values, then
 * draws fresh inputs from an `Arbitrary<T>` until `maxDuration` elapses, and
 * shrinks the first crash. `fuzzAsync` additionally measures V8 block coverage
 * after each input; inputs that reach a new per-function block pattern join a
 * capped corpus, and half of later inputs are mutations of corpus entries.
 *
 * When to use: finding inputs that crash parser/validator/serializer code
 * under a time budget. Prefer the Property module for logical invariants and
 * a fixed run count.
 *
 * Internal design: a mutation walks 1–4 random steps down the entry's shrink
 * tree, so it only explores *simpler* neighbours; there is no byte-level
 * mutator. Corpus seed values (plain values, no shrink tree) are run first and
 * kept as-is. Coverage keys are `function × which nested blocks ran`, so a
 * newly taken branch inside an already-covered function counts as new.
 * Coverage of the harness (Arbitrary, PRNG, CoverageGuided) and of runtime
 * internals is ignored.
 *
 * Design tradeoffs: uses `node:inspector` (Session API) for V8 precise
 * coverage; on runtimes without it (Bun), and under a coverage tool
 * (`NODE_V8_COVERAGE` set — precise coverage is process-wide), `fuzzAsync`
 * degrades to random fuzzing. Coverage collection costs ~5–10× per execution.
 *
 * Prior art: jazzer.js, go-fuzz, AFL.
 *
 * @example
 * ```ts
 * import * as Arb from "@dolphin278/vjuga/Arbitrary";
 * import * as CG from "@dolphin278/vjuga/CoverageGuided";
 *
 * // Finds a string containing a lone "%", which decodeURIComponent rejects.
 * const result = CG.fuzz(Arb.string(), (input) => {
 *   decodeURIComponent(input);
 * }, { maxDuration: 1000 });
 * ```
 */

import type { Fn1 } from "./FunctionUtils.js";
import { type PRNG, type Seed, split, make, randomSeed, nextInt } from "./PRNG.js";
import type { Tree, Arbitrary } from "./Arbitrary.js";
import type { CheckResult } from "./Property.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for fuzzing. */
export interface FuzzConfig {
  /** Maximum fuzzing duration in milliseconds. Default 10_000. */
  readonly maxDuration?: number;
  /** Seed input values, executed before any generated input. In `fuzzAsync`,
   *  those reaching new coverage also join the corpus. */
  readonly corpus?: unknown[];
  /** PRNG seed for reproducibility. */
  readonly seed?: Seed;
  /** Maximum size parameter; generated sizes cycle 0..maxSize. Default 100. */
  readonly maxSize?: number;
  /** Maximum successful shrink steps on failure. Default 1000. */
  readonly maxShrinks?: number;
  /** Maximum target executions while shrinking. Default `max(10_000, 10 * maxShrinks)`. */
  readonly maxShrinkEvaluations?: number;
  /** Maximum corpus entries kept by `fuzzAsync`. Default 256. */
  readonly maxCorpus?: number;
}

/** Coverage data — set of coverage keys seen so far. */
type CoverageSet = Set<string>;

interface ResolvedFuzzConfig {
  readonly maxDuration: number;
  readonly maxSize: number;
  readonly maxShrinks: number;
  readonly maxShrinkEvaluations: number;
  readonly maxCorpus: number;
  readonly seed: Seed;
  readonly corpus: readonly unknown[];
}

function resolveConfig(config?: FuzzConfig): ResolvedFuzzConfig {
  const maxShrinks = config?.maxShrinks ?? 1000;
  return {
    maxDuration: config?.maxDuration ?? 10_000,
    maxSize: config?.maxSize ?? 100,
    maxShrinks,
    maxShrinkEvaluations: config?.maxShrinkEvaluations ?? Math.max(10_000, 10 * maxShrinks),
    maxCorpus: config?.maxCorpus ?? 256,
    seed: config?.seed ?? randomSeed(),
    corpus: config?.corpus ?? [],
  };
}

// ---------------------------------------------------------------------------
// Internal: V8 Inspector coverage
// ---------------------------------------------------------------------------

interface InspectorSession {
  post(method: string, params?: Record<string, unknown>): Promise<unknown>;
  connect(): void;
  disconnect(): void;
}

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: { ranges: CoverageRange[] }[];
}

/** Directory of this module; the harness modules below live next to it. */
const HARNESS_DIR = new URL(".", import.meta.url).href;

/**
 * Harness modules that run between two coverage snapshots (generation,
 * mutation, PRNG draws). Their branches say nothing about the target, so
 * counting them would admit inputs to the corpus that taught nothing.
 */
const HARNESS_FILES = new Set([
  "Arbitrary.js",
  "Arbitrary.ts",
  "PRNG.js",
  "PRNG.ts",
  "CoverageGuided.js",
  "CoverageGuided.ts",
]);

/** False for harness modules and runtime internals (`node:` or empty URLs). */
function isTracked(url: string): boolean {
  if (url === "" || url.startsWith("node:")) return false;
  return !(url.startsWith(HARNESS_DIR) && HARNESS_FILES.has(url.slice(HARNESS_DIR.length)));
}

/**
 * Coverage keys for one execution. V8 block coverage reports a function's own
 * range first, then nested blocks whose count differs from their parent — so a
 * function's key includes the on/off pattern of its nested blocks. Scripts
 * rejected by `isTracked` are skipped; the verdict is cached per scriptId.
 */
function coverageKeys(scripts: ScriptCoverage[], tracked: Map<string, boolean>): CoverageSet {
  const keys: CoverageSet = new Set();
  for (const script of scripts) {
    let track = tracked.get(script.scriptId);
    if (track === undefined) {
      track = isTracked(script.url);
      tracked.set(script.scriptId, track);
    }
    if (!track) continue;
    for (const fn of script.functions) {
      const ranges = fn.ranges;
      if (ranges.length === 0 || ranges[0]!.count === 0) continue;
      let key = `${script.scriptId}:${ranges[0]!.startOffset}`;
      for (let i = 1; i < ranges.length; i++) {
        key += `|${ranges[i]!.startOffset}${ranges[i]!.count > 0 ? "+" : "-"}`;
      }
      keys.add(key);
    }
  }
  return keys;
}

/**
 * True when a coverage tool collects V8 coverage in this process:
 * `NODE_V8_COVERAGE` is set by c8, by `node --test --experimental-test-coverage`
 * (for its test processes) and by users directly. Precise coverage is
 * process-wide, and `takePreciseCoverage` resets the shared counters, so
 * coverage-guided fuzzing would erase the tool's data. Read per call so a
 * caller can toggle it.
 */
function coverageToolActive(): boolean {
  const env = globalThis.process?.env;
  return env !== undefined && env.NODE_V8_COVERAGE !== undefined && env.NODE_V8_COVERAGE !== "";
}

/** Attempts to create a V8 inspector session for precise coverage. */
async function tryCreateInspector(): Promise<{
  start: () => Promise<void>;
  take: () => Promise<CoverageSet>;
  stop: () => Promise<void>;
} | null> {
  try {
    // Node.js: use node:inspector/promises
    const inspectorMod = await import("node:inspector/promises");
    const session = new inspectorMod.Session() as unknown as InspectorSession;
    session.connect();

    let connected = true;
    const tracked = new Map<string, boolean>();

    return {
      start: async () => {
        await session.post("Profiler.enable");
        await session.post("Profiler.startPreciseCoverage", {
          callCount: false,
          detailed: true,
        });
      },
      take: async () => {
        // takePreciseCoverage also resets counters, so each call sees one execution.
        const result = (await session.post("Profiler.takePreciseCoverage")) as {
          result: ScriptCoverage[];
        };
        return coverageKeys(result.result, tracked);
      },
      stop: async () => {
        if (!connected) return;
        connected = false;
        try {
          await session.post("Profiler.stopPreciseCoverage");
          await session.post("Profiler.disable");
        } catch {
          // Session may already be disconnected
        }
        session.disconnect();
      },
    };
  } catch {
    // Not available (e.g., Bun or restricted environment)
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: shrink loop (crash = target throws)
// ---------------------------------------------------------------------------

interface ShrinkResult<T> {
  counterexample: T;
  shrinks: number;
  error: unknown;
}

function shrinkSync<T>(
  tree: Tree<T>,
  target: Fn1<T, void>,
  initialError: unknown,
  cfg: ResolvedFuzzConfig,
): ShrinkResult<T> {
  let best = tree.value;
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;

  let current = tree;
  outer: while (shrinkCount < cfg.maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (evaluations >= cfg.maxShrinkEvaluations) break outer;
      evaluations++;
      try {
        target(child.value);
      } catch (e) {
        best = child.value;
        bestError = e;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  return { counterexample: best, shrinks: shrinkCount, error: bestError };
}

async function shrinkAsync<T>(
  tree: Tree<T>,
  target: (value: T) => Promise<void>,
  initialError: unknown,
  cfg: ResolvedFuzzConfig,
): Promise<ShrinkResult<T>> {
  let best = tree.value;
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;

  let current = tree;
  outer: while (shrinkCount < cfg.maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (evaluations >= cfg.maxShrinkEvaluations) break outer;
      evaluations++;
      try {
        await target(child.value);
      } catch (e) {
        best = child.value;
        bestError = e;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  return { counterexample: best, shrinks: shrinkCount, error: bestError };
}

function failure<T>(
  cfg: ResolvedFuzzConfig,
  numRuns: number,
  result: ShrinkResult<T>,
): CheckResult<T> {
  return {
    ok: false,
    numRuns,
    seed: cfg.seed,
    counterexample: result.counterexample,
    shrinks: result.shrinks,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Internal: corpus
// ---------------------------------------------------------------------------

function seedTree<T>(value: T): Tree<T> {
  return { value, shrinks: [] };
}

/** Random walk of 1–4 steps down the shrink tree (first 8 children per level). */
function mutate<T>(tree: Tree<T>, prng: PRNG): Tree<T> {
  let current = tree;
  const steps = nextInt(prng, 1, 4);
  for (let s = 0; s < steps; s++) {
    const pick = nextInt(prng, 0, 7);
    let chosen: Tree<T> | undefined;
    let idx = 0;
    for (const child of current.shrinks) {
      chosen = child;
      if (idx++ === pick) break;
    }
    if (chosen === undefined) break;
    current = chosen;
  }
  return current;
}

/** Adds `entry`, evicting a random entry once `cap` is reached. */
function addToCorpus<T>(corpus: Tree<T>[], entry: Tree<T>, cap: number, prng: PRNG): void {
  if (corpus.length < cap) corpus.push(entry);
  else if (cap > 0) corpus[nextInt(prng, 0, cap - 1)] = entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Random time-boxed fuzzing (no coverage feedback). Runs `config.corpus`
 * values first, then fresh inputs from `arb` with sizes cycling 0..maxSize,
 * until `maxDuration` elapses or `target` throws; the crash is then shrunk.
 */
export function fuzz<T>(
  arb: Arbitrary<T>,
  target: Fn1<T, void>,
  config?: FuzzConfig,
): CheckResult<T> {
  const cfg = resolveConfig(config);
  const prng = make(cfg.seed);
  const start = Date.now();
  let numRuns = 0;

  for (const value of cfg.corpus as T[]) {
    numRuns++;
    try {
      target(value);
    } catch (e) {
      return failure(cfg, numRuns, { counterexample: value, shrinks: 0, error: e });
    }
  }

  while (Date.now() - start < cfg.maxDuration) {
    const tree = arb(split(prng), numRuns % (cfg.maxSize + 1));
    numRuns++;
    try {
      target(tree.value);
    } catch (e) {
      return failure(cfg, numRuns, shrinkSync(tree, target, e, cfg));
    }
  }

  return { ok: true, numRuns, seed: cfg.seed };
}

/**
 * Async fuzzing with V8 coverage feedback. Runs `config.corpus` values first,
 * then alternates fresh inputs with mutations (shrink-tree walks) of corpus
 * entries that reached new coverage. Coverage of vjuga's own generator,
 * PRNG and fuzzer modules and of runtime internals is ignored. Without an
 * inspector (Bun), or while a coverage tool is collecting in this process
 * (`NODE_V8_COVERAGE` set: c8, `node --test --experimental-test-coverage`),
 * it behaves like `fuzz` (random fuzzing) — sharing V8's precise coverage
 * would erase that tool's data.
 */
export async function fuzzAsync<T>(
  arb: Arbitrary<T>,
  target: (value: T) => Promise<void>,
  config?: FuzzConfig,
): Promise<CheckResult<T>> {
  const cfg = resolveConfig(config);
  const prng = make(cfg.seed);
  const start = Date.now();
  let numRuns = 0;

  const inspector = coverageToolActive() ? null : await tryCreateInspector();
  const seen: CoverageSet = new Set();
  const corpus: Tree<T>[] = [];
  if (inspector) {
    await inspector.start();
    // Baseline: everything reachable before the first input.
    for (const key of await inspector.take()) seen.add(key);
  }

  /** Records coverage of the last execution; true if it reached something new. */
  const observe = async (): Promise<boolean> => {
    if (!inspector) return false;
    let fresh = false;
    for (const key of await inspector.take()) {
      if (!seen.has(key)) {
        seen.add(key);
        fresh = true;
      }
    }
    return fresh;
  };

  try {
    for (const value of cfg.corpus as T[]) {
      numRuns++;
      const tree = seedTree(value);
      try {
        await target(value);
      } catch (e) {
        return failure(cfg, numRuns, { counterexample: value, shrinks: 0, error: e });
      }
      if (await observe()) addToCorpus(corpus, tree, cfg.maxCorpus, prng);
    }

    while (Date.now() - start < cfg.maxDuration) {
      let tree: Tree<T> | undefined;
      if (corpus.length > 0 && numRuns % 2 === 1) {
        const entry = corpus[nextInt(prng, 0, corpus.length - 1)]!;
        const mutated = mutate(entry, prng);
        // Seed values (and fully shrunk entries) have no neighbours to explore.
        if (mutated !== entry) tree = mutated;
      }
      tree ??= arb(split(prng), numRuns % (cfg.maxSize + 1));
      numRuns++;
      try {
        await target(tree.value);
      } catch (e) {
        if (inspector) await inspector.stop();
        return failure(cfg, numRuns, await shrinkAsync(tree, target, e, cfg));
      }
      if (await observe()) addToCorpus(corpus, tree, cfg.maxCorpus, prng);
    }
  } finally {
    if (inspector) await inspector.stop();
  }

  return { ok: true, numRuns, seed: cfg.seed };
}
