/**
 * StatefulTest — model-based stateful testing via command sequences.
 *
 * Generates random sequences of commands, executes them against both a
 * simplified model and the real system under test, and verifies they stay in
 * sync. When a discrepancy is found, the command sequence is shrunk to a
 * minimal failing sequence.
 *
 * When to use: testing stateful APIs (caches, queues, databases, state
 * machines) where bugs arise from specific orderings of operations. Simpler
 * unit tests suffice for pure functions; reach for stateful testing when
 * state-dependent interactions are the concern.
 *
 * Internal design: generation is interleaved with execution (fast-check
 * style) — command i is generated from the model after commands 0..i-1 ran,
 * so state-dependent generators see real state. Shrink candidates replay on
 * fresh `initialModel()`/`initialReal()` instances, re-checking `check`.
 *
 * Design tradeoffs: commands are plain objects with `check`/`run` methods
 * rather than classes. Generators receive the live model: read it, don't
 * capture it in `run` (use the `model` argument there).
 *
 * Prior art: fast-check `fc.commands()`, Hypothesis `RuleBasedStateMachine`.
 *
 * @example
 * ```ts
 * import * as Arb from "@dolphin278/vjuga/Arbitrary";
 * import * as ST from "@dolphin278/vjuga/StatefulTest";
 *
 * ST.assertStateful({
 *   initialModel: () => ({ count: 0 }),
 *   initialReal: () => new Counter(),
 *   commands: [
 *     (_model) => Arb.constant({ name: "inc", check: () => true,
 *       run: (m, r) => { m.count++; r.increment(); } }),
 *   ],
 * });
 * ```
 */

import { type PRNG, type Seed, split, randomSeed, make, nextInt } from "./PRNG.js";
import { type Tree, type Arbitrary } from "./Arbitrary.js";
import { type CheckResult } from "./Property.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A command that can be applied to both a model and a real system. */
export interface Command<Model, Real> {
  /** Human-readable name for shrink output. */
  readonly name: string;
  /** Whether this command is valid in the current model state. Defaults to always-valid. */
  check?(model: Model): boolean;
  /** Execute on the real system and update the model. Throws on mismatch. */
  run(model: Model, real: Real): void;
}

/** Async variant of Command where `run` returns a Promise. */
export interface AsyncCommand<Model, Real> {
  readonly name: string;
  check?(model: Model): boolean;
  run(model: Model, real: Real): Promise<void>;
}

/**
 * A command generator — produces commands conditional on model state. Called
 * with the current (live) model each time a command is generated.
 */
export type CommandArbitrary<Model, Real> = (model: Model) => Arbitrary<Command<Model, Real>>;

/** Async command generator. */
export type AsyncCommandArbitrary<Model, Real> = (
  model: Model,
) => Arbitrary<AsyncCommand<Model, Real>>;

/** Configuration for stateful checks. */
export interface StatefulConfig<Model, Real> {
  /** Factory for the initial model state. */
  readonly initialModel: () => Model;
  /** Factory for the real system under test. */
  readonly initialReal: () => Real;
  /** Command generators — at least one required. */
  readonly commands: [CommandArbitrary<Model, Real>, ...CommandArbitrary<Model, Real>[]];
  /** Maximum number of commands per sequence. Default 50. */
  readonly maxCommands?: number;
  /** Teardown callback for the real system; runs even when a command throws. */
  readonly teardown?: (real: Real) => void;
  /** Number of test sequences to run. Default 100. */
  readonly numRuns?: number;
  /** PRNG seed for reproducibility. */
  readonly seed?: Seed;
  /** Maximum successful shrink steps. Default 1000. */
  readonly maxShrinks?: number;
  /** Maximum sequence replays while shrinking. Default `max(10_000, 10 * maxShrinks)`. */
  readonly maxShrinkEvaluations?: number;
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes, and shrinking stops at it. */
  readonly timeoutMs?: number;
}

/** Async configuration variant. */
export interface AsyncStatefulConfig<Model, Real> {
  readonly initialModel: () => Model;
  readonly initialReal: () => Real | Promise<Real>;
  readonly commands: [AsyncCommandArbitrary<Model, Real>, ...AsyncCommandArbitrary<Model, Real>[]];
  readonly maxCommands?: number;
  readonly teardown?: (real: Real) => void | Promise<void>;
  readonly numRuns?: number;
  readonly seed?: Seed;
  readonly maxShrinks?: number;
  readonly maxShrinkEvaluations?: number;
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes, and shrinking stops at it. */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal: outcomes and budgets
// ---------------------------------------------------------------------------

/** Sentinel outcome: the sequence ran without a command throwing. */
const PASSED: unique symbol = Symbol("passed");

interface ShrinkLimits {
  readonly maxShrinks: number;
  readonly maxShrinkEvaluations: number;
  readonly deadline: number | undefined;
}

function resolveLimits(config: {
  readonly maxShrinks?: number;
  readonly maxShrinkEvaluations?: number;
  readonly timeoutMs?: number;
}): ShrinkLimits {
  /* node:coverage ignore next 2 */
  const maxShrinks = config.maxShrinks ?? 1000;
  const maxShrinkEvaluations = config.maxShrinkEvaluations ?? Math.max(10_000, 10 * maxShrinks);
  const deadline = config.timeoutMs !== undefined ? Date.now() + config.timeoutMs : undefined;
  return { maxShrinks, maxShrinkEvaluations, deadline };
}

function pastDeadline(limits: ShrinkLimits): boolean {
  return limits.deadline !== undefined && Date.now() > limits.deadline;
}

function outOfBudget(evaluations: number, limits: ShrinkLimits): boolean {
  return evaluations >= limits.maxShrinkEvaluations || pastDeadline(limits);
}

function sequenceLength(prng: PRNG, size: number, maxCommands: number): number {
  return nextInt(prng, 1, Math.min(maxCommands, Math.max(1, size)));
}

// ---------------------------------------------------------------------------
// Internal: generation interleaved with execution
// ---------------------------------------------------------------------------

/**
 * Generates and runs one sequence. Command `i` is generated from the model as
 * left by commands `0..i-1`; commands whose `check` rejects the current model
 * are dropped (at most `10 * len` generation attempts). Returns the executed
 * command trees and PASSED or the error thrown by the last one.
 */
function runGeneratedSync<Model, Real>(
  config: StatefulConfig<Model, Real>,
  prng: PRNG,
  size: number,
  maxCommands: number,
): { trees: Tree<Command<Model, Real>>[]; outcome: unknown } {
  const gens = config.commands;
  const trees: Tree<Command<Model, Real>>[] = [];
  let outcome: unknown = PASSED;
  const model = config.initialModel();
  const real = config.initialReal();
  try {
    const len = sequenceLength(prng, size, maxCommands);
    for (let attempts = 0; trees.length < len && attempts < len * 10; attempts++) {
      const gen = gens[nextInt(prng, 0, gens.length - 1)]!;
      const tree = gen(model)(split(prng), size);
      const cmd = tree.value;
      if (cmd.check !== undefined && !cmd.check(model)) continue;
      trees.push(tree);
      try {
        cmd.run(model, real);
      } catch (e) {
        outcome = e;
        break;
      }
    }
  } finally {
    if (config.teardown) config.teardown(real);
  }
  return { trees, outcome };
}

/* node:coverage disable */
async function runGeneratedAsync<Model, Real>(
  config: AsyncStatefulConfig<Model, Real>,
  prng: PRNG,
  size: number,
  maxCommands: number,
): Promise<{ trees: Tree<AsyncCommand<Model, Real>>[]; outcome: unknown }> {
  const gens = config.commands;
  const trees: Tree<AsyncCommand<Model, Real>>[] = [];
  let outcome: unknown = PASSED;
  const model = config.initialModel();
  const real = await config.initialReal();
  try {
    const len = sequenceLength(prng, size, maxCommands);
    for (let attempts = 0; trees.length < len && attempts < len * 10; attempts++) {
      const gen = gens[nextInt(prng, 0, gens.length - 1)]!;
      const tree = gen(model)(split(prng), size);
      const cmd = tree.value;
      if (cmd.check !== undefined && !cmd.check(model)) continue;
      trees.push(tree);
      try {
        await cmd.run(model, real);
      } catch (e) {
        outcome = e;
        break;
      }
    }
  } finally {
    if (config.teardown) await config.teardown(real);
  }
  return { trees, outcome };
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: replaying a fixed sequence (shrinking)
// ---------------------------------------------------------------------------

/** Runs a fixed sequence on fresh state, re-checking each precondition. */
function replaySync<Model, Real>(
  commands: Command<Model, Real>[],
  config: StatefulConfig<Model, Real>,
): unknown {
  const model = config.initialModel();
  const real = config.initialReal();
  try {
    for (const cmd of commands) {
      if (cmd.check !== undefined && !cmd.check(model)) continue;
      try {
        cmd.run(model, real);
      } catch (e) {
        return e;
      }
    }
    return PASSED;
  } finally {
    if (config.teardown) config.teardown(real);
  }
}

/* node:coverage disable */
async function replayAsync<Model, Real>(
  commands: AsyncCommand<Model, Real>[],
  config: AsyncStatefulConfig<Model, Real>,
): Promise<unknown> {
  const model = config.initialModel();
  const real = await config.initialReal();
  try {
    for (const cmd of commands) {
      if (cmd.check !== undefined && !cmd.check(model)) continue;
      try {
        await cmd.run(model, real);
      } catch (e) {
        return e;
      }
    }
    return PASSED;
  } finally {
    if (config.teardown) await config.teardown(real);
  }
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: command sequence shrink tree
// ---------------------------------------------------------------------------

function sequenceTree<C>(cmdTrees: Tree<C>[]): Tree<C[]> {
  return { value: cmdTrees.map((t) => t.value), shrinks: shrinkCommandSequence(cmdTrees) };
}

/** Re-iterable shrink candidates for a command sequence. */
function shrinkCommandSequence<C>(cmdTrees: Tree<C>[]): Iterable<Tree<C[]>> {
  return {
    *[Symbol.iterator]() {
      const len = cmdTrees.length;
      // Phase 1: try removing commands — first the last half, then one at a time
      if (len > 1) yield sequenceTree(cmdTrees.slice(0, Math.ceil(len / 2)));
      for (let i = len - 1; i >= 0 && len > 1; i--) {
        yield sequenceTree([...cmdTrees.slice(0, i), ...cmdTrees.slice(i + 1)]);
      }
      // Phase 2: shrink individual commands
      for (let i = 0; i < len; i++) {
        for (const childTree of cmdTrees[i]!.shrinks) {
          const copy = cmdTrees.slice();
          copy[i] = childTree;
          yield sequenceTree(copy);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: shrink loop for command sequences
// ---------------------------------------------------------------------------

interface StatefulShrinkResult<C> {
  commands: C[];
  shrinks: number;
  error: unknown;
}

function shrinkStatefulSync<Model, Real>(
  trees: Tree<Command<Model, Real>>[],
  initialError: unknown,
  config: StatefulConfig<Model, Real>,
  limits: ShrinkLimits,
): StatefulShrinkResult<Command<Model, Real>> {
  let current = sequenceTree(trees);
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;
  outer: while (shrinkCount < limits.maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (outOfBudget(evaluations, limits)) break outer;
      evaluations++;
      const outcome = replaySync(child.value, config);
      if (outcome !== PASSED) {
        bestError = outcome;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return { commands: current.value, shrinks: shrinkCount, error: bestError };
}

/* node:coverage disable */
async function shrinkStatefulAsync<Model, Real>(
  trees: Tree<AsyncCommand<Model, Real>>[],
  initialError: unknown,
  config: AsyncStatefulConfig<Model, Real>,
  limits: ShrinkLimits,
): Promise<StatefulShrinkResult<AsyncCommand<Model, Real>>> {
  let current = sequenceTree(trees);
  let bestError = initialError;
  let shrinkCount = 0;
  let evaluations = 0;
  outer: while (shrinkCount < limits.maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (outOfBudget(evaluations, limits)) break outer;
      evaluations++;
      const outcome = await replayAsync(child.value, config);
      if (outcome !== PASSED) {
        bestError = outcome;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return { commands: current.value, shrinks: shrinkCount, error: bestError };
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Public API: sync
// ---------------------------------------------------------------------------

/**
 * Runs a stateful property check. Generates command sequences while executing
 * them against model + real system, and shrinks failures to minimal sequences.
 * `timeoutMs` bounds both the run loop and shrinking.
 */
export function checkStateful<Model, Real>(
  config: StatefulConfig<Model, Real>,
): CheckResult<Command<Model, Real>[]> {
  /* node:coverage ignore next 3 */
  const numRuns = config.numRuns ?? 100;
  const maxCommands = config.maxCommands ?? 50;
  const usedSeed = config.seed ?? randomSeed();
  const limits = resolveLimits(config);
  const prng = make(usedSeed);
  let i = 0;
  for (; i < numRuns; i++) {
    if (pastDeadline(limits)) break;
    /* node:coverage ignore next */
    const size = numRuns <= 1 ? 100 : Math.floor((i * 100) / (numRuns - 1));
    const { trees, outcome } = runGeneratedSync(config, split(prng), size, maxCommands);
    if (outcome !== PASSED) {
      const shrinkResult = shrinkStatefulSync(trees, outcome, config, limits);
      return {
        ok: false,
        numRuns: i + 1,
        seed: usedSeed,
        counterexample: shrinkResult.commands,
        shrinks: shrinkResult.shrinks,
        error: shrinkResult.error,
      };
    }
  }

  return { ok: true, numRuns: i, seed: usedSeed };
}

/** Runs a stateful check and throws on failure. */
export function assertStateful<Model, Real>(config: StatefulConfig<Model, Real>): void {
  const result = checkStateful(config);
  if (!result.ok) {
    const cmdNames = result.counterexample!.map((c) => c.name).join(" -> ");
    /* node:coverage ignore next 4 */
    const lines = [
      "Stateful property check failed!",
      `  Commands: ${cmdNames}`,
      `  After ${result.numRuns} test(s) and ${result.shrinks ?? 0} shrink(s)`,
      `  Seed: ${result.seed as unknown as bigint}n`,
    ];
    if (result.error instanceof Error) {
      lines.push(`  Error: ${result.error.message}`);
    }
    throw new Error(lines.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// Public API: async
// ---------------------------------------------------------------------------

/* node:coverage disable */
/**
 * Async variant of checkStateful. Supports async `initialReal`, `run`, and
 * `teardown`.
 */
export async function checkStatefulAsync<Model, Real>(
  config: AsyncStatefulConfig<Model, Real>,
): Promise<CheckResult<AsyncCommand<Model, Real>[]>> {
  const numRuns = config.numRuns ?? 100;
  const maxCommands = config.maxCommands ?? 50;
  const usedSeed = config.seed ?? randomSeed();
  const limits = resolveLimits(config);
  const prng = make(usedSeed);
  let i = 0;
  for (; i < numRuns; i++) {
    if (pastDeadline(limits)) break;
    const size = numRuns <= 1 ? 100 : Math.floor((i * 100) / (numRuns - 1));
    const { trees, outcome } = await runGeneratedAsync(config, split(prng), size, maxCommands);
    if (outcome !== PASSED) {
      const shrinkResult = await shrinkStatefulAsync(trees, outcome, config, limits);
      return {
        ok: false,
        numRuns: i + 1,
        seed: usedSeed,
        counterexample: shrinkResult.commands,
        shrinks: shrinkResult.shrinks,
        error: shrinkResult.error,
      };
    }
  }

  return { ok: true, numRuns: i, seed: usedSeed };
}

/** Async variant of assertStateful. */
export async function assertStatefulAsync<Model, Real>(
  config: AsyncStatefulConfig<Model, Real>,
): Promise<void> {
  const result = await checkStatefulAsync(config);
  if (!result.ok) {
    const cmdNames = result.counterexample!.map((c) => c.name).join(" -> ");
    const lines = [
      "Stateful property check failed!",
      `  Commands: ${cmdNames}`,
      `  After ${result.numRuns} test(s) and ${result.shrinks ?? 0} shrink(s)`,
      `  Seed: ${result.seed as unknown as bigint}n`,
    ];
    if (result.error instanceof Error) {
      lines.push(`  Error: ${result.error.message}`);
    }
    throw new Error(lines.join("\n"));
  }
}
/* node:coverage enable */
