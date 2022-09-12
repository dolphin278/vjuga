import { test } from "node:test";
import * as assert from "node:assert";
import { MemoryPool } from "../MemoryPool.js";

test("Memory Pool should allow us reuse our instances", () => {
  let allocated = 0;
  let disposed = 0;
  let instanceSentForDisposal;

  const pool = new MemoryPool({
    factory: () => {
      allocated++;
      return {};
    },
    dispose: (instanceToDispose) => {
      disposed++;
      instanceSentForDisposal = instanceToDispose;
    },
  });

  const instance = pool.acquire();
  pool.release(instance);

  const instance2 = pool.acquire();
  assert.equal(instance, instance2, "Instances should be reused");
  assert.equal(allocated, 1, "Factory should only be called once");
  assert.equal(disposed, 1, "Dispose should be called on instance");
  assert.equal(
    instanceSentForDisposal,
    instance,
    "Instance should be sent for disposal"
  );
});

test("Memory pool preallocates minimum number of instances", () => {
  const pool = new MemoryPool({
    minSize: 2,
    factory: () => ({}),
  });

  assert.equal(
    pool.freeInstancesCount,
    2,
    "Pool should preallocate 2 instances"
  );
});

test("Memory pool throws when someone tries to release object not retrieved from this pool", () => {
  const pool = new MemoryPool({
    factory: () => ({}),
  });

  assert.throws(() => pool.release({}), "Instance should belong to this pool");
});
