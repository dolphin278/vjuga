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
