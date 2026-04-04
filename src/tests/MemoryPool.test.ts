import { test } from "node:test";
import * as assert from "node:assert";
import * as MemoryPool from "../MemoryPool.js";
import { acquire, release, make } from "../MemoryPool.js";
import * as Queue from "../Queue.js";

test("Memory Pool should allow us reuse our instances", () => {
  let allocated = 0;
  let disposed = 0;
  let instanceSentForDisposal: object | undefined;

  const pool = make({
    factory: () => {
      allocated++;
      return {};
    },
    dispose: (instanceToDispose: object) => {
      disposed++;
      instanceSentForDisposal = instanceToDispose;
    },
  });

  const instance = acquire(pool);
  release(pool, instance);

  const instance2 = acquire(pool);
  assert.equal(instance, instance2, "Instances should be reused");
  assert.equal(allocated, 1, "Factory should only be called once");
  assert.equal(disposed, 1, "Dispose should be called on instance");
  assert.equal(
    instanceSentForDisposal,
    instance,
    "Instance should be sent for disposal",
  );
});

test("Memory pool preallocates minimum number of instances", () => {
  const pool = make({
    minSize: 2,
    factory: () => ({}),
  });

  assert.equal(
    Queue.size(pool.freeList),
    2,
    "Pool should preallocate 2 instances",
  );
});

test("Memory pool throws when someone tries to release object not retrieved from this pool", () => {
  const pool = make({
    factory: () => ({}),
  });

  assert.throws(() => release(pool, {}), "Instance should belong to this pool");
});

test("Memory pool throws when someone tries to acquire more instances than max size", () => {
  const pool = make({
    maxSize: 1,
    factory: () => ({}),
  });

  acquire(pool);
  assert.throws(() => acquire(pool), "Pool should be full");
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

test("acquiredInstancesCount should return number of instances that are currently lent", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = acquire(pool);
  assert.equal(pool.acquiredSet.size, 1, "One instance should be lent");

  release(pool, instance);
  assert.equal(pool.acquiredSet.size, 0, "No instances should be lent");
});

test("freeInstancesCount should return number of instances that are currently free", () => {
  const pool = make({
    maxSize: 2,
    factory: () => ({}),
  });

  const instance = acquire(pool);
  assert.equal(Queue.size(pool.freeList), 0, "No instances should be free");

  release(pool, instance);
  assert.equal(Queue.size(pool.freeList), 1, "One instance should be free");
});

test("Memory pool SHOULD NOT ALLOW to release instance twice", () => {
  const pool = make({
    factory: () => ({}),
  });

  const instance = acquire(pool);
  release(pool, instance);
  assert.throws(() => release(pool, instance), "Instance should be released");
});

test("ArrayPool should allow us to reuse arrays", () => {
  const pool = MemoryPool.ArrayPool;

  const array = acquire(pool);
  array.push(1);

  release(pool, array);

  const array2 = acquire(pool);
  assert.equal(array, array2, "Arrays should be reused");
  assert.equal(array2.length, 0, "Array should be empty");
});

test("MapPool should allow us to reuse maps", () => {
  const pool = MemoryPool.MapPool;

  const map = acquire(pool);
  map.set("key", "value");
  release(pool, map);

  const map2 = acquire(pool);
  assert.equal(map, map2, "Maps should be reused");
  assert.equal(map2.size, 0, "Map should be empty");
});

test("SetPool should allow us to reuse sets", () => {
  const pool = MemoryPool.SetPool;

  const set = acquire(pool);
  set.add("value");
  release(pool, set);

  const set2 = acquire(pool);
  assert.equal(set, set2, "Sets should be reused");
  assert.equal(set2.size, 0, "Set should be empty");
});
