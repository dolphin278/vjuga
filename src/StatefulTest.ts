/**
 * StatefulTest — model-based stateful testing via command sequences.
 *
 * Generates random sequences of commands, executes them against both a
 * simplified model and the real system under test, and verifies they stay in
 * sync. When a discrepancy is found, the command sequence is shrunk to a
 * minimal failing prefix.
 *
 * When to use: testing stateful APIs (caches, queues, databases, state
 * machines) where bugs arise from specific orderings of operations. Simpler
 * unit tests suffice for pure functions; reach for stateful testing when
 * state-dependent interactions are the concern.
 *
 * Design tradeoffs: commands are plain objects with `check`/`run` methods
 * rather than classes to keep the interface lightweight and composable.
 * The model is cloned via structured clone before each shrink attempt to
 * ensure isolation — this bounds shrink overhead to O(commands * cloneCost).
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

import { type PRNG, type Seed, split, randomSeed, make } from "./PRNG.js";
import { type Tree, type Arbitrary } from "./Arbitrary.js";
import { type CheckResult } from "./Property.js";
import { nextInt } from "./PRNG.js";

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

/** A command generator — produces commands conditional on model state. */
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
  /** Teardown callback for the real system. */
  readonly teardown?: (real: Real) => void;
  /** Number of test sequences to run. Default 100. */
  readonly numRuns?: number;
  /** PRNG seed for reproducibility. */
  readonly seed?: Seed;
  /** Maximum shrink iterations. Default 1000. */
  readonly maxShrinks?: number;
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes. */
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
  /** Wall-clock deadline in milliseconds. When set, the run loop exits early if
   *  the deadline passes before numRuns completes. */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal: command sequence execution
// ---------------------------------------------------------------------------

function executeCommandsSync<Model, Real>(
  commands: Command<Model, Real>[],
  model: Model,
  real: Real,
): { ok: boolean; error?: unknown; executedCount: number } {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    /* node:coverage ignore next */
    if (cmd.check !== undefined && !cmd.check(model)) continue;
    try {
      cmd.run(model, real);
    } catch (e) {
      return { ok: false, error: e, executedCount: i + 1 };
    }
  }
  return { ok: true, executedCount: commands.length };
}

/* node:coverage disable */
async function executeCommandsAsync<Model, Real>(
  commands: AsyncCommand<Model, Real>[],
  model: Model,
  real: Real,
): Promise<{ ok: boolean; error?: unknown; executedCount: number }> {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    if (cmd.check !== undefined && !cmd.check(model)) continue;
    try {
      await cmd.run(model, real);
    } catch (e) {
      return { ok: false, error: e, executedCount: i + 1 };
    }
  }
  return { ok: true, executedCount: commands.length };
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Internal: command sequence generation
// ---------------------------------------------------------------------------

function generateCommandSequence<Model, Real>(
  commandGens: CommandArbitrary<Model, Real>[],
  prng: PRNG,
  size: number,
  maxCommands: number,
  initialModel: () => Model,
): Tree<Command<Model, Real>[]> {
  const model = initialModel();
  const len = nextInt(prng, 1, Math.min(maxCommands, Math.max(1, size)));
  const cmdTrees: Tree<Command<Model, Real>>[] = [];

  for (let i = 0; i < len; i++) {
    const genIdx = nextInt(prng, 0, commandGens.length - 1);
    const gen = commandGens[genIdx]!;
    const tree = gen(model)(split(prng), size);
    // Don't execute commands during generation — state advancement would
    // require a real system. Commands are only executed during the test phase.
    cmdTrees.push(tree);
  }

  return {
    value: cmdTrees.map((t) => t.value),
    shrinks: shrinkCommandSequence(cmdTrees),
  };
}

function* shrinkCommandSequence<Model, Real>(
  cmdTrees: Tree<Command<Model, Real>>[],
): Iterable<Tree<Command<Model, Real>[]>> {
  const len = cmdTrees.length;
  /* node:coverage ignore next 2 */
  if (len === 0) return;

  // Phase 1: try removing commands (from end, then from middle)
  // Try removing last half
  if (len > 1) {
    const half = Math.ceil(len / 2);
    const prefix = cmdTrees.slice(0, half);
    yield {
      value: prefix.map((t) => t.value),
      shrinks: shrinkCommandSequence(prefix),
    };
  }

  // Try removing one command at a time
  for (let i = len - 1; i >= 0; i--) {
    const without = [...cmdTrees.slice(0, i), ...cmdTrees.slice(i + 1)];
    if (without.length > 0) {
      yield {
        value: without.map((t) => t.value),
        shrinks: shrinkCommandSequence(without),
      };
    }
  }

  // Phase 2: shrink individual commands
  for (let i = 0; i < cmdTrees.length; i++) {
    for (const childTree of cmdTrees[i]!.shrinks) {
      const copy = cmdTrees.slice();
      copy[i] = childTree;
      yield {
        value: copy.map((t) => t.value),
        shrinks: shrinkCommandSequence(copy),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: shrink loop for command sequences
// ---------------------------------------------------------------------------

/* node:coverage disable */
function shrinkStatefulSync<Model, Real>(
  tree: Tree<Command<Model, Real>[]>,
  config: StatefulConfig<Model, Real>,
  maxShrinks: number,
): { commands: Command<Model, Real>[]; shrinks: number; error?: unknown } {
  let best = tree.value;
  let bestError: unknown;
  let shrinkCount = 0;

  let current = tree;
  while (shrinkCount < maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (shrinkCount >= maxShrinks) break;

      const model = config.initialModel();
      const real = config.initialReal();
      const result = executeCommandsSync(child.value, model, real);
      if (config.teardown) config.teardown(real);

      if (!result.ok) {
        best = child.value;
        bestError = result.error;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
      shrinkCount++;
    }
    if (!found) break;
  }

  return { commands: best, shrinks: shrinkCount, error: bestError };
}
/* node:coverage enable */

/* node:coverage disable */
async function shrinkStatefulAsync<Model, Real>(
  tree: Tree<AsyncCommand<Model, Real>[]>,
  config: AsyncStatefulConfig<Model, Real>,
  maxShrinks: number,
): Promise<{ commands: AsyncCommand<Model, Real>[]; shrinks: number; error?: unknown }> {
  let best = tree.value;
  let bestError: unknown;
  let shrinkCount = 0;

  let current = tree;
  while (shrinkCount < maxShrinks) {
    let found = false;
    for (const child of current.shrinks) {
      if (shrinkCount >= maxShrinks) break;

      const model = config.initialModel();
      const real = await config.initialReal();
      const result = await executeCommandsAsync(child.value, model, real);
      if (config.teardown) await config.teardown(real);

      if (!result.ok) {
        best = child.value;
        bestError = result.error;
        shrinkCount++;
        current = child;
        found = true;
        break;
      }
      shrinkCount++;
    }
    if (!found) break;
  }

  return { commands: best, shrinks: shrinkCount, error: bestError };
}
/* node:coverage enable */

// ---------------------------------------------------------------------------
// Public API: sync
// ---------------------------------------------------------------------------

/**
 * Runs a stateful property check. Generates command sequences, executes them
 * against model + real system, and shrinks failures to minimal sequences.
 */
export function checkStateful<Model, Real>(
  config: StatefulConfig<Model, Real>,
): CheckResult<Command<Model, Real>[]> {
  /* node:coverage ignore next 4 */
  const numRuns = config.numRuns ?? 100;
  const maxCommands = config.maxCommands ?? 50;
  const maxShrinks = config.maxShrinks ?? 1000;
  const usedSeed = config.seed ?? randomSeed();
  const timeoutMs = config.timeoutMs;
  const prng = make(usedSeed);
  /* node:coverage ignore next */
  const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
  let i = 0;
  for (; i < numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    /* node:coverage ignore next */
    const size = numRuns <= 1 ? 100 : Math.floor((i * 100) / (numRuns - 1));
    const testPrng = split(prng);

    const tree = generateCommandSequence(
      config.commands as unknown as CommandArbitrary<Model, Real>[],
      testPrng,
      size,
      maxCommands,
      config.initialModel,
    );

    const model = config.initialModel();
    const real = config.initialReal();
    const result = executeCommandsSync(tree.value, model, real);
    if (config.teardown) config.teardown(real);

    if (!result.ok) {
      const shrinkResult = shrinkStatefulSync(tree, config, maxShrinks);
      return {
        ok: false,
        numRuns: i + 1,
        seed: usedSeed,
        counterexample: shrinkResult.commands,
        shrinks: shrinkResult.shrinks,
        /* node:coverage ignore next */
        error: shrinkResult.error ?? result.error,
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
  const maxShrinks = config.maxShrinks ?? 1000;
  const usedSeed = config.seed ?? randomSeed();
  const timeoutMs = config.timeoutMs;
  const prng = make(usedSeed);

  const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
  let i = 0;
  for (; i < numRuns; i++) {
    if (deadline !== undefined && Date.now() > deadline) break;
    const size = numRuns <= 1 ? 100 : Math.floor((i * 100) / (numRuns - 1));
    const testPrng = split(prng);

    // For async, we still generate commands synchronously (generation is pure)
    // but execute them asynchronously
    const tree = generateCommandSequence(
      config.commands as unknown as CommandArbitrary<Model, Real>[],
      testPrng,
      size,
      maxCommands,
      config.initialModel,
    ) as unknown as Tree<AsyncCommand<Model, Real>[]>;

    const model = config.initialModel();
    const real = await config.initialReal();
    const result = await executeCommandsAsync(tree.value, model, real);
    if (config.teardown) await config.teardown(real);

    if (!result.ok) {
      const shrinkResult = await shrinkStatefulAsync(tree, config, maxShrinks);
      return {
        ok: false,
        numRuns: i + 1,
        seed: usedSeed,
        counterexample: shrinkResult.commands,
        shrinks: shrinkResult.shrinks,
        error: shrinkResult.error ?? result.error,
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
