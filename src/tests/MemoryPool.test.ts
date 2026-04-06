import { test } from "node:test";
import * as assert from "node:assert";
import { acquire, release, make, withAcquire } from "../MemoryPool.js";

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
  const pool = make({
    minSize: 2,
    factory: () => ({}),
  });

  assert.equal(pool.freeList.length, 2, "Pool should preallocate 2 instances");
});

test("Memory pool throws when someone tries to acquire more instances than max size", () => {
  const pool = make({
    maxSize: 1,
    factory: () => ({}),
  });

  acquire(pool);
  assert.throws(() => acquire(pool), "Pool should be full");
});

test("maxSize limits total objects created, not concurrent borrows", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const a = acquire(pool); // creates 1st object
  const b = acquire(pool); // creates 2nd object
  assert.throws(() => acquire(pool), "Pool should be full after 2 created");

  release(pool, a);
  // a is back in freeList; total created is still 2
  const c = acquire(pool); // reuses a, no new object created
  assert.equal(c, a, "Should reuse released object");

  assert.throws(() => acquire(pool), "Pool still full — b is still out");
  release(pool, b);
  release(pool, c);
});

test("Memory pool throws when min size is greater than max size", () => {
  assert.throws(
    () =>
      make({
        minSize: 2,
        maxSize: 1,
        factory: () => ({}),
      }),
    "Min size should be less than or equal to max size",
  );
});

test("acquiredCount tracks number of instances currently lent", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = acquire(pool);
  assert.equal(pool.acquiredCount, 1, "One instance should be lent");

  release(pool, instance);
  assert.equal(pool.acquiredCount, 0, "No instances should be lent");
});

test("freeList tracks number of instances currently free", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = acquire(pool);
  assert.equal(pool.freeList.length, 0, "No instances should be free");

  release(pool, instance);
  assert.equal(pool.freeList.length, 1, "One instance should be free");
});

test("withAcquire releases the instance after fn returns", () => {
  const pool = make({ factory: () => ({}) });

  withAcquire(pool, (instance) => {
    assert.equal(pool.acquiredCount, 1);
    assert.equal(pool.freeList.length, 0);
    void instance;
  });

  assert.equal(pool.acquiredCount, 0);
  assert.equal(pool.freeList.length, 1);
});

test("withAcquire releases the instance even if fn throws", () => {
  const pool = make({ factory: () => ({}) });

  assert.throws(() =>
    withAcquire(pool, () => {
      throw new Error("oops");
    }),
  );

  assert.equal(pool.acquiredCount, 0);
  assert.equal(pool.freeList.length, 1);
});

test("withAcquire returns the value from fn", () => {
  const pool = make({ factory: () => ({ x: 0 }) });
  const result = withAcquire(pool, (p) => {
    p.x = 42;
    return p.x;
  });
  assert.equal(result, 42);
});
