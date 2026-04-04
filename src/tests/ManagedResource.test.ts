import { test } from "node:test";
import * as ManagedResource from "../ManagedResource.js";
import * as assert from "node:assert/strict";

test("withResource", async () => {
  await test("withResource allows us to manage resource", async () => {
    let resourceAllocated: object | null = null;
    let disposedResource: object | null = null;
    let providedResource: object | null = null;

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
      },
    );

    assert.equal(resourceAllocated, providedResource);
    assert.equal(disposedResource, resourceAllocated);
  });

  await test("withResource catches exceptions and rethrows them", async () => {
    let resourceAllocated: object | null = null;
    let _disposedResource: object | null = null;
    let _providedResource: object | null = null;

    await assert.rejects(
      async () => {
        await ManagedResource.withResource(
          {
            factory: () => {
              resourceAllocated = {};
              return Promise.resolve(resourceAllocated);
            },
            dispose: (resource) => {
              _disposedResource = resource;
              return Promise.resolve(undefined);
            },
          },
          async (resourceGiven) => {
            _providedResource = resourceGiven;
            throw new Error("Some error");
          },
        );
      },
      {
        message: "Unable to run resource consuming function: Some error",
      },
    );
  });

  await test("if wrapped function throws non-Error, it is rethrown", async () => {
    await assert.rejects(
      async () => {
        await ManagedResource.withResource(
          {
            factory: () => {
              return Promise.resolve({});
            },
            dispose: (_resource) => {
              return Promise.resolve(undefined);
            },
          },
          async (_resourceGiven) => {
            throw "Some error";
          },
        );
      },
      (thrown: unknown) => typeof thrown === "string" && thrown === "Some error",
    );
  });
});
