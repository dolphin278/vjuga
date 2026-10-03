import { test } from "node:test";
import * as assert from "node:assert";
import {
  acquire,
  release,
  make,
  withAcquire,
  MemoryPoolExhaustedError,
  MemoryPoolMinSizeError,
} from "../MemoryPool.js";

test("Memory Pool should allow us reuse our instances", () => {
  let allocated = 0;
  let resetCount = 0;
  let instanceSentForReset: object | undefined;

  const pool = make({
    factory: () => {
      allocated++;
      return {};
    },
    reset: (instance: object) => {
      resetCount++;
      instanceSentForReset = instance;
    },
  });

  const instance = acquire(pool);
  release(pool, instance);

  const instance2 = acquire(pool);
  assert.equal(instance, instance2, "Instances should be reused");
  assert.equal(allocated, 1, "Factory should only be called once");
  assert.equal(resetCount, 1, "reset should be called on release");
  assert.equal(instanceSentForReset, instance, "Instance should be sent for reset");
});

test("Memory pool preallocates minimum number of instances", () => {
  let allocated = 0;
  const pool = make({
    minSize: 2,
    factory: () => {
      allocated++;
      return {};
    },
  });

  // Verify preallocated instances by acquiring them without triggering factory
  const a = acquire(pool);
  const b = acquire(pool);
  assert.equal(
    allocated,
    2,
    "Factory should have been called exactly 2 times for preallocated instances",
  );
  release(pool, a);
  release(pool, b);
});

test("Memory pool throws MemoryPoolExhaustedError when someone tries to acquire more than max size", () => {
  const pool = make({
    maxSize: 1,
    factory: () => ({}),
  });

  acquire(pool);
  assert.throws(
    () => acquire(pool),
    (err: unknown) => {
      assert.ok(err instanceof MemoryPoolExhaustedError);
      assert.equal((err as Error).message, "MemoryPool is full");
      return true;
    },
  );
});

test("maxSize limits total objects created, not concurrent borrows", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const a = acquire(pool); // creates 1st object
  const b = acquire(pool); // creates 2nd object
  assert.throws(
    () => acquire(pool),
    (err: unknown) => err instanceof MemoryPoolExhaustedError,
  );

  release(pool, a);
  // a is back in freeList; total created is still 2
  const c = acquire(pool); // reuses a, no new object created
  assert.equal(c, a, "Should reuse released object");

  assert.throws(
    () => acquire(pool),
    (err: unknown) => err instanceof MemoryPoolExhaustedError,
  );
  release(pool, b);
  release(pool, c);
});

test("Memory pool throws MemoryPoolMinSizeError when min size is greater than max size", () => {
  assert.throws(
    () =>
      make({
        minSize: 2,
        maxSize: 1,
        // make() throws before the factory is ever called
        /* node:coverage ignore next */
        factory: () => ({}),
      }),
    (err: unknown) => {
      assert.ok(err instanceof MemoryPoolMinSizeError);
      assert.equal((err as Error).message, "minSize cannot be greater than maxSize");
      return true;
    },
  );
});

test("acquire/release cycle tracks count correctly", () => {
  let factoryCalls = 0;
  const pool = make({
    maxSize: 2,
    factory: () => {
      factoryCalls++;
      return {};
    },
  });

  const instance = acquire(pool);
  assert.equal(factoryCalls, 1, "One factory call after first acquire");

  release(pool, instance);
  const reused = acquire(pool);
  assert.equal(factoryCalls, 1, "No new factory call — instance was reused");
  assert.equal(reused, instance, "Same instance returned");
  release(pool, reused);
});

test("release puts instance back for reuse", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = acquire(pool);
  release(pool, instance);

  // Acquiring again should give back the same instance (LIFO)
  const reacquired = acquire(pool);
  assert.equal(reacquired, instance, "Released instance should be reused");
  release(pool, reacquired);
});

test("withAcquire releases the instance after fn returns", () => {
  let factoryCalls = 0;
  const pool = make({
    factory: () => {
      factoryCalls++;
      return {};
    },
  });

  let capturedInstance: object | undefined;
  withAcquire(pool, (instance) => {
    capturedInstance = instance;
  });

  // After withAcquire, instance should be back in pool
  const reacquired = acquire(pool);
  assert.equal(reacquired, capturedInstance, "Instance should be reused after withAcquire");
  assert.equal(factoryCalls, 1, "Factory should only be called once");
  release(pool, reacquired);
});

test("withAcquire releases the instance even if fn throws", () => {
  const pool = make({ factory: () => ({}) });

  let capturedInstance: object | undefined;
  assert.throws(() =>
    withAcquire(pool, (instance) => {
      capturedInstance = instance;
      throw new Error("oops");
    }),
  );

  // Instance should still be returned to pool
  const reacquired = acquire(pool);
  assert.equal(reacquired, capturedInstance, "Instance should be reused even after throw");
  release(pool, reacquired);
});

test("withAcquire returns the value from fn", () => {
  const pool = make({ factory: () => ({ x: 0 }) });
  const result = withAcquire(pool, (p) => {
    p.x = 42;
    return p.x;
  });
  assert.equal(result, 42);
});

test("a throwing factory does not leak a slot", () => {
  let fail = true;
  const pool = make({
    maxSize: 1,
    factory: () => {
      if (fail) throw new Error("factory boom");
      return {};
    },
  });
  assert.throws(() => acquire(pool), /factory boom/);
  fail = false;
  // The slot must still be available.
  const a = acquire(pool);
  assert.ok(a);
});

test("a throwing reset frees the slot, drops the instance and propagates", () => {
  let allocated = 0;
  const pool = make({
    maxSize: 1,
    factory: () => ({ id: allocated++ }),
    reset: () => {
      throw new Error("reset boom");
    },
  });
  const a = acquire(pool);
  assert.throws(() => release(pool, a), /reset boom/);
  const b = acquire(pool);
  assert.notEqual(b, a, "dirty instance must not be recycled");
  assert.equal(allocated, 2);
});

test("withAcquire: a throwing reset does not mask the error from fn", () => {
  const pool = make({
    maxSize: 1,
    factory: () => ({}),
    reset: () => {
      throw new Error("reset boom");
    },
  });
  assert.throws(
    () =>
      withAcquire(pool, () => {
        throw new Error("user boom");
      }),
    /user boom/,
  );
  // Slot freed.
  acquire(pool);
});

test("withAcquire: a throwing reset on the success path propagates", () => {
  const pool = make({
    factory: () => ({}),
    reset: () => {
      throw new Error("reset boom");
    },
  });
  assert.throws(() => withAcquire(pool, () => 1), /reset boom/);
});

// --- withAcquire with async / thenable fn (G8-2) ---

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

test("withAcquire: concurrent async borrowers get distinct instances, reset after settle", async () => {
  const pool = make({
    factory: () => ({ owner: "" }),
    reset: (o) => {
      o.owner = "";
    },
    maxSize: 2,
  });
  const job = (name: string): Promise<string> =>
    withAcquire(pool, async (o) => {
      o.owner = name;
      await tick();
      return `${name} sees ${o.owner}`;
    });
  assert.deepEqual(await Promise.all([job("A"), job("B")]), ["A sees A", "B sees B"]);
  // Both released after settling: the pool can hand out two instances again.
  const a = acquire(pool);
  const b = acquire(pool);
  assert.notEqual(a, b);
  assert.equal(a.owner, "");
});

test("withAcquire: an unsettled async borrower counts against maxSize", async () => {
  const pool = make({ factory: () => ({}), maxSize: 1 });
  let finish!: () => void;
  const pending = withAcquire(pool, () => new Promise<void>((r) => (finish = r)));
  assert.throws(() => acquire(pool), MemoryPoolExhaustedError);
  assert.throws(() => withAcquire(pool, async () => 1), MemoryPoolExhaustedError);
  finish();
  await pending;
  release(pool, acquire(pool));
});

test("withAcquire: returns a new Promise with fn's value, released before it settles", async () => {
  const pool = make({ factory: () => ({}), maxSize: 1 });
  const inner = Promise.resolve(42);
  const outer = withAcquire(pool, () => inner);
  assert.notEqual(outer, inner);
  assert.equal(await outer, 42);
  release(pool, acquire(pool)); // slot is free again
});

test("withAcquire: a rejected promise releases the instance and wins over a throwing reset", async () => {
  let failReset = false;
  const pool = make({
    factory: () => ({}),
    reset: () => {
      if (failReset) throw new Error("reset boom");
    },
    maxSize: 1,
  });
  await assert.rejects(
    withAcquire(pool, async () => {
      throw new Error("user boom");
    }),
    /user boom/,
  );
  release(pool, acquire(pool));
  failReset = true;
  await assert.rejects(
    withAcquire(pool, () => Promise.reject(new Error("user boom"))),
    /user boom/,
  );
  // Dirty instance dropped, slot freed.
  failReset = false;
  release(pool, acquire(pool));
});

test("withAcquire: a throwing reset after fulfilment rejects the returned promise", async () => {
  const pool = make({
    factory: () => ({}),
    reset: () => {
      throw new Error("reset boom");
    },
    maxSize: 1,
  });
  await assert.rejects(
    withAcquire(pool, async () => 1),
    /reset boom/,
  );
  acquire(pool); // slot freed
});

test("withAcquire: custom thenables are adopted once, even if they misbehave", async () => {
  let resets = 0;
  const pool = make({ factory: () => ({}), reset: () => void resets++, maxSize: 1 });
  const twice: PromiseLike<number> = {
    // oxlint-disable-next-line unicorn/no-thenable -- deliberate thenables under test
    then(onFulfilled, onRejected) {
      onFulfilled?.(1);
      onFulfilled?.(2);
      onRejected?.(new Error("late"));
      return Promise.resolve() as never;
    },
  };
  assert.equal(await withAcquire(pool, () => twice), 1);
  assert.equal(resets, 1, "released exactly once");
  const throwing = {
    // oxlint-disable-next-line unicorn/no-thenable -- deliberate thenables under test
    then() {
      throw new Error("then boom");
    },
  };
  await assert.rejects(
    withAcquire(pool, () => throwing),
    /then boom/,
  );
  assert.equal(resets, 2);
  // A function with a `then` method is a thenable too.
  const fnThenable = Object.assign(() => 0, {
    // oxlint-disable-next-line unicorn/no-thenable -- deliberate thenables under test
    then: (onFulfilled: (v: number) => void) => onFulfilled(5),
  });
  assert.equal(await withAcquire(pool, () => fnThenable), 5);
  release(pool, acquire(pool));
});

test("withAcquire: a throwing `then` getter releases synchronously and rethrows", () => {
  let resets = 0;
  const pool = make({ factory: () => ({}), reset: () => void resets++, maxSize: 1 });
  const evil = {
    // oxlint-disable-next-line unicorn/no-thenable -- deliberate thenables under test
    get then(): never {
      throw new Error("getter boom");
    },
  };
  assert.throws(() => withAcquire(pool, () => evil), /getter boom/);
  assert.equal(resets, 1);
  release(pool, acquire(pool));
});

test("withAcquire: non-thenable objects and functions are returned synchronously", () => {
  const pool = make({ factory: () => ({}), maxSize: 1 });
  // oxlint-disable-next-line unicorn/no-thenable -- deliberate thenables under test
  const obj = { then: 1 };
  assert.equal(
    withAcquire(pool, () => obj),
    obj,
  );
  const fn = (): number => 1;
  assert.equal(
    withAcquire(pool, () => fn),
    fn,
  );
  assert.equal(
    withAcquire(pool, () => null),
    null,
  );
  release(pool, acquire(pool));
});

test("make validates maxSize and minSize", () => {
  const factory = () => ({});
  assert.throws(() => make({ factory, maxSize: NaN }), RangeError);
  assert.throws(() => make({ factory, maxSize: -1 }), RangeError);
  assert.throws(() => make({ factory, minSize: -1 }), RangeError);
  assert.throws(() => make({ factory, minSize: 1.5 }), RangeError);
  assert.throws(() => make({ factory, minSize: NaN }), RangeError);
  // Valid edge cases.
  assert.doesNotThrow(() => make({ factory, maxSize: 0 }));
  assert.doesNotThrow(() => make({ factory, maxSize: Infinity }));
  const zero = make({ factory, maxSize: 0 });
  assert.throws(() => acquire(zero), MemoryPoolExhaustedError);
});
