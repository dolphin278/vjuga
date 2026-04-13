import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as PRNG from "../PRNG.js";
import * as Arb from "../Arbitrary.js";
import * as ST from "../StatefulTest.js";

const fixedSeed = PRNG.seed(42n);

// ---------------------------------------------------------------------------
// Counter model (sync)
// ---------------------------------------------------------------------------

class Counter {
  value = 0;
  increment() {
    this.value++;
  }
  decrement() {
    this.value--;
  }
  get() {
    return this.value;
  }
}

interface CounterModel {
  count: number;
}

const incrementCmd: ST.CommandArbitrary<CounterModel, Counter> = (_model) =>
  Arb.constant<ST.Command<CounterModel, Counter>>({
    name: "increment",
    check: () => true,
    run: (model, real) => {
      model.count++;
      real.increment();
      /* c8 ignore next 3 -- only triggers with buggy implementation */
      if (model.count !== real.get()) {
        throw new Error(`Model: ${model.count}, Real: ${real.get()}`);
      }
    },
  });

const decrementCmd: ST.CommandArbitrary<CounterModel, Counter> = (_model) =>
  Arb.constant<ST.Command<CounterModel, Counter>>({
    name: "decrement",
    check: () => true,
    run: (model, real) => {
      model.count--;
      real.decrement();
      /* c8 ignore next 3 -- only triggers with buggy implementation */
      if (model.count !== real.get()) {
        throw new Error(`Model: ${model.count}, Real: ${real.get()}`);
      }
    },
  });

test("checkStateful() passes for correct implementation", () => {
  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [incrementCmd, decrementCmd],
    numRuns: 20,
    seed: fixedSeed,
    maxCommands: 10,
  });
  assert.equal(result.ok, true);
});

test("assertStateful() does not throw for correct implementation", () => {
  ST.assertStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [incrementCmd, decrementCmd],
    numRuns: 20,
    seed: fixedSeed,
    maxCommands: 10,
  });
});

// ---------------------------------------------------------------------------
// Buggy counter (detects bugs)
// ---------------------------------------------------------------------------

class BuggyCounter {
  value = 0;
  ops = 0;
  increment() {
    this.ops++;
    // Bug: after 3 operations, increment adds 2 instead of 1
    this.value += this.ops > 3 ? 2 : 1;
  }
  decrement() {
    this.ops++;
    this.value--;
  }
  get() {
    return this.value;
  }
}

test("checkStateful() detects buggy implementation", () => {
  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new BuggyCounter(),
    commands: [
      (_model) =>
        Arb.constant<ST.Command<CounterModel, BuggyCounter>>({
          name: "increment",
          check: () => true,
          run: (model, real) => {
            model.count++;
            real.increment();
            /* c8 ignore next 3 -- triggers only on bug */
            if (model.count !== real.get()) {
              throw new Error(`Expected ${model.count}, got ${real.get()}`);
            }
          },
        }),
      (_model) =>
        Arb.constant<ST.Command<CounterModel, BuggyCounter>>({
          name: "decrement",
          check: () => true,
          run: (model, real) => {
            model.count--;
            real.decrement();
            /* c8 ignore next 3 -- triggers only on bug */
            if (model.count !== real.get()) {
              throw new Error(`Expected ${model.count}, got ${real.get()}`);
            }
          },
        }),
    ],
    numRuns: 50,
    seed: fixedSeed,
    maxCommands: 20,
  });
  assert.equal(result.ok, false);
  assert.ok(result.counterexample !== undefined);
  assert.ok(result.counterexample!.length > 0, "should have commands in counterexample");
});

test("assertStateful() throws on buggy implementation", () => {
  assert.throws(
    () =>
      ST.assertStateful({
        initialModel: () => ({ count: 0 }),
        initialReal: () => new BuggyCounter(),
        commands: [
          (_model) =>
            Arb.constant<ST.Command<CounterModel, BuggyCounter>>({
              name: "increment",
              check: () => true,
              run: (model, real) => {
                model.count++;
                real.increment();
                if (model.count !== real.get()) {
                  throw new Error("mismatch");
                }
              },
            }),
        ],
        numRuns: 50,
        seed: fixedSeed,
        maxCommands: 20,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("Stateful property check failed!"));
      assert.ok(err.message.includes("Commands:"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Precondition filtering
// ---------------------------------------------------------------------------

test("checkStateful() respects command preconditions", () => {
  // A command that only applies when count > 0
  const conditionalDecrement: ST.CommandArbitrary<CounterModel, Counter> = (_model) =>
    Arb.constant<ST.Command<CounterModel, Counter>>({
      name: "decrement-if-positive",
      check: (model) => model.count > 0,
      run: (model, real) => {
        model.count--;
        real.decrement();
        /* c8 ignore next 3 -- correct impl never mismatches */
        if (model.count !== real.get()) {
          throw new Error("mismatch");
        }
      },
    });

  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [incrementCmd, conditionalDecrement],
    numRuns: 30,
    seed: fixedSeed,
    maxCommands: 15,
  });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Optional check field
// ---------------------------------------------------------------------------

test("checkStateful() runs commands without check unconditionally", () => {
  const noCheckCmd: ST.CommandArbitrary<CounterModel, Counter> = (_model) =>
    Arb.constant<ST.Command<CounterModel, Counter>>({
      name: "increment-no-check",
      run: (model, real) => {
        model.count++;
        real.increment();
        /* c8 ignore next 3 -- correct impl never mismatches */
        if (model.count !== real.get()) throw new Error("mismatch");
      },
    });
  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [noCheckCmd],
    numRuns: 10,
    seed: fixedSeed,
    maxCommands: 5,
  });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

test("checkStateful() calls teardown", () => {
  let tornDown = false;
  ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [incrementCmd],
    numRuns: 5,
    seed: fixedSeed,
    maxCommands: 3,
    teardown: () => {
      tornDown = true;
    },
  });
  assert.ok(tornDown);
});

// ---------------------------------------------------------------------------
// Shrinking command sequences
// ---------------------------------------------------------------------------

test("checkStateful() shrinks to minimal command sequence", () => {
  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new BuggyCounter(),
    commands: [
      (_model) =>
        Arb.constant<ST.Command<CounterModel, BuggyCounter>>({
          name: "increment",
          check: () => true,
          run: (model, real) => {
            model.count++;
            real.increment();
            /* c8 ignore next 3 -- triggers only on bug */
            if (model.count !== real.get()) {
              throw new Error("mismatch");
            }
          },
        }),
      (_model) =>
        Arb.constant<ST.Command<CounterModel, BuggyCounter>>({
          name: "decrement",
          check: () => true,
          run: (model, real) => {
            model.count--;
            real.decrement();
          },
        }),
    ],
    numRuns: 50,
    seed: fixedSeed,
    maxCommands: 20,
  });
  assert.equal(result.ok, false);
  assert.ok(result.shrinks! > 0, "should have shrunk");
  // The buggy counter fails after 4 increments, so minimal sequence should
  // be ~4 increments
  assert.ok(
    result.counterexample!.length <= 10,
    `should shrink to small sequence, got ${result.counterexample!.length}`,
  );
});

// ---------------------------------------------------------------------------
// Shrinkable command arguments (exercises phase 2 command shrinking)
// ---------------------------------------------------------------------------

test("checkStateful() shrinks command arguments", () => {
  class Accumulator {
    total = 0;
    add(n: number) {
      this.total += n;
    }
    get() {
      return this.total;
    }
  }

  interface AccModel {
    total: number;
  }

  const addCmd: ST.CommandArbitrary<AccModel, Accumulator> = (_model) =>
    Arb.map(
      Arb.integer(1, 100),
      (n): ST.Command<AccModel, Accumulator> => ({
        name: `add(${n})`,
        check: () => true,
        run: (model, real) => {
          model.total += n;
          real.add(n);
          // Bug: fail when total exceeds 50
          if (real.get() > 50) {
            throw new Error(`total ${real.get()} exceeds 50`);
          }
        },
      }),
    );

  const result = ST.checkStateful({
    initialModel: () => ({ total: 0 }),
    initialReal: () => new Accumulator(),
    commands: [addCmd],
    numRuns: 50,
    seed: fixedSeed,
    maxCommands: 20,
  });
  assert.equal(result.ok, false);
  // The counterexample should have shrunk command arguments
  assert.ok(result.shrinks! > 0);
});

// ---------------------------------------------------------------------------
// Async stateful
// ---------------------------------------------------------------------------

test("checkStatefulAsync() works with async commands", async () => {
  const result = await ST.checkStatefulAsync({
    initialModel: () => ({ count: 0 }),
    initialReal: async () => new Counter(),
    commands: [
      (_model) =>
        Arb.constant<ST.AsyncCommand<CounterModel, Counter>>({
          name: "increment",
          check: () => true,
          run: async (model, real) => {
            model.count++;
            real.increment();
            await Promise.resolve();
            /* c8 ignore next 3 -- triggers only on bug */
            if (model.count !== real.get()) {
              throw new Error("mismatch");
            }
          },
        }),
    ],
    numRuns: 10,
    seed: fixedSeed,
    maxCommands: 5,
  });
  assert.equal(result.ok, true);
});

test("checkStatefulAsync() detects async bugs", async () => {
  const result = await ST.checkStatefulAsync({
    initialModel: () => ({ count: 0 }),
    initialReal: async () => new BuggyCounter(),
    commands: [
      (_model) =>
        Arb.constant<ST.AsyncCommand<CounterModel, BuggyCounter>>({
          name: "increment",
          check: () => true,
          run: async (model, real) => {
            model.count++;
            real.increment();
            await Promise.resolve();
            /* c8 ignore next 3 -- triggers only on bug */
            if (model.count !== real.get()) {
              throw new Error("mismatch");
            }
          },
        }),
    ],
    numRuns: 50,
    seed: fixedSeed,
    maxCommands: 20,
  });
  assert.equal(result.ok, false);
});

test("assertStatefulAsync() throws on async failure", async () => {
  await assert.rejects(
    () =>
      ST.assertStatefulAsync({
        initialModel: () => ({ count: 0 }),
        initialReal: async () => new BuggyCounter(),
        commands: [
          (_model) =>
            Arb.constant<ST.AsyncCommand<CounterModel, BuggyCounter>>({
              name: "increment",
              check: () => true,
              run: async (model, real) => {
                model.count++;
                real.increment();
                if (model.count !== real.get()) {
                  throw new Error("mismatch");
                }
              },
            }),
        ],
        numRuns: 50,
        seed: fixedSeed,
        maxCommands: 20,
      }),
    (err: Error) => {
      assert.ok(err.message.includes("Stateful property check failed!"));
      return true;
    },
  );
});

test("checkStatefulAsync() with teardown", async () => {
  let tornDown = false;
  await ST.checkStatefulAsync({
    initialModel: () => ({ count: 0 }),
    initialReal: async () => new Counter(),
    commands: [
      (_model) =>
        Arb.constant<ST.AsyncCommand<CounterModel, Counter>>({
          name: "increment",
          check: () => true,
          run: async (model, real) => {
            model.count++;
            real.increment();
          },
        }),
    ],
    numRuns: 3,
    seed: fixedSeed,
    maxCommands: 3,
    teardown: async () => {
      tornDown = true;
    },
  });
  assert.ok(tornDown);
});
