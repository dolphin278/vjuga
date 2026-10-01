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

// ---------------------------------------------------------------------------
// timeoutMs
// ---------------------------------------------------------------------------

test("checkStateful() timeoutMs: stops before numRuns when deadline passes", () => {
  const result = ST.checkStateful({
    initialModel: () => ({ count: 0 }),
    initialReal: () => new Counter(),
    commands: [incrementCmd],
    numRuns: 10_000_000,
    timeoutMs: 1,
    seed: fixedSeed,
    maxCommands: 5,
  });
  assert.equal(result.ok, true);
  assert.ok(result.numRuns < 10_000_000, `should stop early, got ${result.numRuns}`);
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

// ---------------------------------------------------------------------------
// Generation tracks the evolving model (G7-7)
// ---------------------------------------------------------------------------

interface StackModel {
  items: number[];
}

const pushCmd: ST.CommandArbitrary<StackModel, number[]> = () =>
  Arb.map(Arb.integer(0, 9), (v) => ({
    name: `push(${v})`,
    run: (m: StackModel, r: number[]) => {
      m.items.push(v);
      r.push(v);
    },
  }));

test("checkStateful() generators see the model as commands execute", () => {
  let pops = 0;
  const sizesSeen = new Set<number>();
  const result = ST.checkStateful<StackModel, number[]>({
    initialModel: () => ({ items: [] }),
    initialReal: () => [],
    commands: [
      pushCmd,
      (model) => {
        sizesSeen.add(model.items.length);
        return model.items.length > 0
          ? Arb.constant<ST.Command<StackModel, number[]>>({
              name: "pop",
              check: (m) => m.items.length > 0,
              run: (m, r) => {
                pops++;
                assert.equal(m.items.pop(), r.pop());
              },
            })
          : Arb.constant<ST.Command<StackModel, number[]>>({ name: "noop", run: () => {} });
      },
    ],
    numRuns: 50,
    seed: PRNG.seed(1n),
  });
  assert.equal(result.ok, true);
  assert.ok(pops > 0, "pop was never generated");
  assert.ok(sizesSeen.size > 3, `model sizes seen: ${[...sizesSeen].join(",")}`);
});

test("checkStateful() finds a bug that needs state-dependent commands", () => {
  // Buggy real stack: pop returns the wrong item once it holds 3+ items.
  const result = ST.checkStateful<StackModel, number[]>({
    initialModel: () => ({ items: [] }),
    initialReal: () => [],
    commands: [
      pushCmd,
      () =>
        Arb.constant<ST.Command<StackModel, number[]>>({
          name: "pop",
          check: (m) => m.items.length > 0,
          run: (m, r) => {
            const expected = m.items.pop();
            const actual = r.length >= 3 ? r.shift() : r.pop();
            if (expected !== actual) {
              throw new Error(`pop: expected ${expected}, got ${actual}`);
            }
          },
        }),
    ],
    numRuns: 100,
    seed: PRNG.seed(2n),
  });
  assert.equal(result.ok, false);
  // Minimal: three pushes (shrunk to distinct values), then pop.
  const names = result.counterexample!.map((c) => c.name);
  assert.equal(names.at(-1), "pop");
  assert.equal(names.filter((n) => n.startsWith("push")).length, 3);
  assert.ok(names.length === 4, names.join(" -> "));
});

test("checkStateful() drops generated commands whose precondition fails", () => {
  const ran: string[] = [];
  const result = ST.checkStateful<{ n: number }, null>({
    initialModel: () => ({ n: 0 }),
    initialReal: () => null,
    commands: [
      () =>
        Arb.constant<ST.Command<{ n: number }, null>>({
          name: "never",
          check: () => false,
          run: () => {
            ran.push("never");
          },
        }),
    ],
    numRuns: 5,
    seed: fixedSeed,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(ran, []);
});

// ---------------------------------------------------------------------------
// Shrinking quality and accounting (G7-1, G7-14)
// ---------------------------------------------------------------------------

const valueCmd: ST.CommandArbitrary<object, object> = () =>
  Arb.map(Arb.integer(0, 100), (v) => ({
    name: `c${v}`,
    run: () => {
      if (v >= 20) throw new Error(`boom ${v}`);
    },
  }));

test("checkStateful() shrinks to the minimal command (element shrinks not drained)", () => {
  for (let s = 1n; s <= 10n; s++) {
    const r = ST.checkStateful({
      initialModel: () => ({}),
      initialReal: () => ({}),
      commands: [valueCmd],
      numRuns: 20,
      seed: PRNG.seed(s),
    });
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.counterexample!.map((c) => c.name),
      ["c20"],
      `seed ${s}`,
    );
    assert.equal((r.error as Error).message, "boom 20");
  }
});

test("checkStateful() counts only successful shrink steps", () => {
  const r = ST.checkStateful({
    initialModel: () => ({}),
    initialReal: () => ({}),
    commands: [
      () =>
        Arb.constant({
          name: "boom",
          run: () => {
            throw new Error("boom");
          },
        }),
    ],
    numRuns: 1,
    seed: fixedSeed,
  });
  assert.equal(r.ok, false);
  assert.equal(r.counterexample!.length, 1);
  assert.equal(r.shrinks, 0);
});

test("checkStateful() maxShrinkEvaluations bounds replays", () => {
  let replays = 0;
  const r = ST.checkStateful({
    initialModel: () => ({}),
    initialReal: () => {
      replays++;
      return {};
    },
    commands: [valueCmd],
    numRuns: 50,
    seed: fixedSeed,
    maxShrinkEvaluations: 3,
  });
  assert.equal(r.ok, false);
  // replays = runs until failure + at most 3 shrink replays
  assert.ok(replays <= r.numRuns + 3, `${replays} replays for ${r.numRuns} runs`);
});

test("checkStateful() timeoutMs also bounds shrinking", () => {
  let replays = 0;
  const r = ST.checkStateful({
    initialModel: () => ({}),
    initialReal: () => {
      replays++;
      const until = Date.now() + 2;
      while (Date.now() < until) {
        // busy-wait
      }
      return {};
    },
    commands: [valueCmd],
    numRuns: 1,
    maxCommands: 50,
    seed: fixedSeed,
    timeoutMs: 10,
  });
  assert.equal(r.ok, false);
  assert.ok(replays < 30, `${replays} replays`);
});

// ---------------------------------------------------------------------------
// Teardown always runs (G7-14)
// ---------------------------------------------------------------------------

test("checkStateful() runs teardown when a precondition throws", () => {
  let teardowns = 0;
  assert.throws(
    () =>
      ST.checkStateful({
        initialModel: () => ({}),
        initialReal: () => ({}),
        commands: [
          () =>
            Arb.constant({
              name: "bad-check",
              check: () => {
                throw new Error("check exploded");
              },
              run: () => {},
            }),
        ],
        teardown: () => {
          teardowns++;
        },
        numRuns: 1,
        seed: fixedSeed,
      }),
    /check exploded/,
  );
  assert.equal(teardowns, 1);
});

test("checkStateful() runs teardown for every shrink replay", () => {
  let reals = 0;
  let teardowns = 0;
  const r = ST.checkStateful({
    initialModel: () => ({}),
    initialReal: () => {
      reals++;
      return {};
    },
    commands: [valueCmd],
    teardown: () => {
      teardowns++;
    },
    numRuns: 20,
    seed: fixedSeed,
  });
  assert.equal(r.ok, false);
  assert.equal(teardowns, reals);
});

test("checkStateful() re-checks preconditions when replaying shrunk sequences", () => {
  interface FlagModel {
    armed: boolean;
  }
  const r = ST.checkStateful<FlagModel, null>({
    initialModel: () => ({ armed: false }),
    initialReal: () => null,
    commands: [
      () =>
        Arb.constant<ST.Command<FlagModel, null>>({
          name: "arm",
          run: (m) => {
            m.armed = true;
          },
        }),
      () =>
        Arb.constant<ST.Command<FlagModel, null>>({
          name: "fire",
          check: (m) => m.armed,
          run: () => {
            throw new Error("fired");
          },
        }),
    ],
    numRuns: 20,
    seed: fixedSeed,
  });
  assert.equal(r.ok, false);
  // Dropping "arm" disables "fire" (skipped on replay), so it must stay.
  assert.deepEqual(
    r.counterexample!.map((c) => c.name),
    ["arm", "fire"],
  );
});
