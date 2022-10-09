import { test } from "node:test";
import * as ManagedResource from "../ManagedResource.js";
import * as assert from "node:assert/strict";

test("withResource allows us to manage resource", async () => {
  let resourceAllocated = null;
  let disposedResource = null;
  let providedResource = null;

  await ManagedResource.withResource(
    {
      factory: () => {
        resourceAllocated = {};
        return Promise.resolve(resourceAllocated);
      },
      dispose: (resource) => {
        disposedResource = resource;
        return Promise.resolve(undefined);
      },
    },
    async (resourceGiven) => {
      providedResource = resourceGiven;
    }
  );

  assert.equal(resourceAllocated, providedResource);
  assert.equal(disposedResource, resourceAllocated);
});

test("withSyncResource allows us to manage resource", async () => {
  let resourceAllocated = null;
  let disposedResource = null;
  let providedResource = null;

  ManagedResource.withSyncResource(
    {
      factory: () => {
        resourceAllocated = {};
        return resourceAllocated;
      },
      dispose: (resource) => {
        disposedResource = resource;
      },
    },
    (resourceGiven) => {
      providedResource = resourceGiven;
    }
  );

  assert.equal(resourceAllocated, providedResource);
  assert.equal(disposedResource, resourceAllocated);
});
