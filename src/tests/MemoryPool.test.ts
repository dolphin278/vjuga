import { test } from "node:test";
import * as assert from "node:assert";
import { MemoryPool, ArrayPool, MapPool, SetPool } from "../MemoryPool.js";

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

test("Memory pool DOES NOT throw when someone tries to release object not retrieved from this pool", () => {
  const pool = new MemoryPool({
    factory: () => ({}),
  });

  assert.doesNotThrow(
    () => pool.release({}),
    "Instance should belong to this pool"
  );
});

test("Memory pool throws when someone tries to acquire more instances than max size", () => {
  const pool = new MemoryPool({
    maxSize: 1,
    factory: () => ({}),
  });

  pool.acquire();
  assert.throws(() => pool.acquire(), "Pool should be full");
});

test("Memory pool throws when min size is greater than max size", () => {
  assert.throws(
    () =>
      new MemoryPool({
        minSize: 2,
        maxSize: 1,
        factory: () => ({}),
      }),
    "Min size should be less than or equal to max size"
  );
});

test("acquiredInstancesCount should return number of instances that are currently lent", () => {
  const pool = new MemoryPool({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = pool.acquire();
  assert.equal(pool.acquiredInstancesCount, 1, "One instance should be lent");

  pool.release(instance);
  assert.equal(pool.acquiredInstancesCount, 0, "No instances should be lent");
});

test("freeInstancesCount should return number of instances that are currently free", () => {
  const pool = new MemoryPool({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = pool.acquire();
  assert.equal(pool.freeInstancesCount, 0, "No instances should be free");

  pool.release(instance);
  assert.equal(pool.freeInstancesCount, 1, "One instance should be free");
});

test("Memory pool SHOULD ALLOW to release instance twice", () => {
  const pool = new MemoryPool({
    factory: () => ({}),
  });

  const instance = pool.acquire();
  pool.release(instance);
  assert.doesNotThrow(
    () => pool.release(instance),
    "Instance should be released"
  );
});

test("ArrayPool should allow us to reuse arrays", () => {
  const pool = ArrayPool;

  const array = pool.acquire();
  array.push(1);
  pool.release(array);

  const array2 = pool.acquire();
  assert.equal(array, array2, "Arrays should be reused");
  assert.equal(array2.length, 0, "Array should be empty");
});

test("MapPool should allow us to reuse maps", () => {
  const pool = MapPool;

  const map = pool.acquire();
  map.set("key", "value");
  pool.release(map);

  const map2 = pool.acquire();
  assert.equal(map, map2, "Maps should be reused");
  assert.equal(map2.size, 0, "Map should be empty");
});

test("SetPool should allow us to reuse sets", () => {
  const pool = SetPool;

  const set = pool.acquire();
  set.add("value");
  pool.release(set);

  const set2 = pool.acquire();
  assert.equal(set, set2, "Sets should be reused");
  assert.equal(set2.size, 0, "Set should be empty");
});
