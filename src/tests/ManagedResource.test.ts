import { test } from "node:test";
import * as ManagedResource from "../ManagedResource.js";
import * as assert from "node:assert/strict";

test("withAsyncResource allows us to manage resource", async () => {
  /** @type {any} */
  let resourceAllocated = null;
  /** @type {any} */
  let disposedResource = null;
  /** @type {any} */
  let providedResource = null;

  await ManagedResource.withAsyncResource(
    {
      factory: () => {
        resourceAllocated = {};
        return Promise.resolve(resourceAllocated);
      },
      /** @param {any} resource */
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
  /** @type {any} */
  let resourceAllocated = null;
  /** @type {any} */
  let disposedResource = null;
  /** @type {any} */
  let providedResource = null;

  ManagedResource.withSyncResource(
    {
      factory: () => {
        resourceAllocated = {};
        return resourceAllocated;
      },
      /** @param {any} resource */
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
