import { test } from "node:test";
import * as assert from "node:assert";
import {
  make,
  acquire,
  release,
  withAcquire,
  dispose,
  acquiredCount,
  freeCount,
} from "../DebugMemoryPool.js";

test("DebugMemoryPool reuses instances across acquire/release", () => {
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

test("DebugMemoryPool preallocates minimum number of instances", () => {
  const pool = make({ minSize: 2, factory: () => ({}) });
  assert.equal(pool.freeList.length, 2, "Pool should preallocate 2 instances");
});

test("DebugMemoryPool throws on release of object not from this pool", () => {
  const pool = make({ factory: () => ({}) });
  assert.throws(
    () => release(pool, {}),
    "Instance should belong to this pool",
  );
});

test("DebugMemoryPool throws when trying to acquire more than maxSize", () => {
  const pool = make({ maxSize: 1, factory: () => ({}) });
  acquire(pool);
  assert.throws(() => acquire(pool), "Pool should be full");
});

test("DebugMemoryPool throws when min size is greater than max size", () => {
  assert.throws(
    () => make({ minSize: 2, maxSize: 1, factory: () => ({}) }),
    "Min size should be less than or equal to max size",
  );
});

test("DebugMemoryPool throws on double-release", () => {
  const pool = make({ factory: () => ({}) });
  const instance = acquire(pool);
  release(pool, instance);
  assert.throws(() => release(pool, instance), "Instance should not be released twice");
});

test("acquiredCount and freeCount track pool state", () => {
  const pool = make({ maxSize: 2, factory: () => ({}) });

  const instance = acquire(pool);
  assert.equal(acquiredCount(pool), 1);
  assert.equal(freeCount(pool), 0);

  release(pool, instance);
  assert.equal(acquiredCount(pool), 0);
  assert.equal(freeCount(pool), 1);
});

test("withAcquire releases instance after fn returns", () => {
  const pool = make({ factory: () => ({}) });

  withAcquire(pool, (instance) => {
    assert.equal(acquiredCount(pool), 1);
    void instance;
  });

  assert.equal(acquiredCount(pool), 0);
  assert.equal(freeCount(pool), 1);
});

test("withAcquire releases instance even if fn throws", () => {
  const pool = make({ factory: () => ({}) });

  assert.throws(() =>
    withAcquire(pool, () => {
      throw new Error("oops");
    }),
  );

  assert.equal(acquiredCount(pool), 0);
  assert.equal(freeCount(pool), 1);
});

test("dispose fires onLeak callback when objects are still acquired", () => {
  let leakSet: Set<object> | undefined;
  const pool = make({
    factory: () => ({}),
    onLeak: (s) => {
      leakSet = s;
    },
  });

  const instance = acquire(pool);
  dispose(pool);

  assert.ok(leakSet !== undefined, "onLeak should have been called");
  assert.ok(leakSet!.has(instance), "Leaked instance should be in the set");
});

test("dispose does not fire onLeak when no objects are acquired", () => {
  let called = false;
  const pool = make({
    factory: () => ({}),
    onLeak: () => {
      called = true;
    },
  });

  const instance = acquire(pool);
  release(pool, instance);
  dispose(pool);

  assert.equal(called, false, "onLeak should not fire when nothing is leaked");
});

test("DebugMemoryPool usable as drop-in for ArrayPool pattern", () => {
  const pool = make<unknown[]>({
    factory: (): unknown[] => [],
    reset: (arr) => { arr.length = 0; },
  });

  const arr = acquire(pool) as number[];
  arr.push(1, 2, 3);
  release(pool, arr);

  const arr2 = acquire(pool) as number[];
  assert.equal(arr, arr2, "Arrays should be reused");
  assert.equal(arr2.length, 0, "Array should be cleared by reset");
});
