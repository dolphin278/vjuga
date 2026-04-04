declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { withResource, UnableToRunResourceConsumingFunctionError } from "../ManagedResource.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

type SimpleResource = { value: number; closed: boolean };

const simpleResourceDef = {
  factory: (): SimpleResource => ({ value: 42, closed: false }),
  dispose: (r: SimpleResource) => {
    r.closed = true;
  },
};

const asyncResourceDef = {
  factory: async (): Promise<SimpleResource> => ({ value: 42, closed: false }),
  dispose: async (r: SimpleResource) => {
    r.closed = true;
  },
};

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    await withResource(simpleResourceDef, async (r) => {
      void r.value;
    });
  }
  reportOptimizationStatus(withResource, "ManagedResource.withResource");
}

// --- Benchmarks ---

bench("withResource: sync factory + sync dispose + noop fn", async () => {
  return withResource(simpleResourceDef, async (r) => {
    void r.value;
  });
});

bench("withResource: async factory + async dispose", async () => {
  return withResource(asyncResourceDef, async (r) => {
    void r.value;
  });
});

bench("withResource: sync resource + computation", async () => {
  let result = 0;
  await withResource(simpleResourceDef, async (r) => {
    result = r.value * 2;
  });
  return result;
});

bench("withResource: error in consumer fn (caught)", async () => {
  return withResource(simpleResourceDef, async (_r) => {
    throw new Error("consumer error");
  }).catch((e) => {
    if (e instanceof UnableToRunResourceConsumingFunctionError) return "caught";
    throw e;
  });
});

bench("withResource: nested resources", async () => {
  let result = 0;
  await withResource(simpleResourceDef, async (outer) => {
    await withResource(simpleResourceDef, async (inner) => {
      result = outer.value + inner.value;
    });
  });
  return result;
});

bench("withResource: sequential 5 resources", async () => {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    await withResource(simpleResourceDef, async (r) => {
      sum += r.value;
    });
  }
  return sum;
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
for (let i = 0; i < 10_000; i++) {
  await withResource(simpleResourceDef, async (r) => {
    void r.value;
  });
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 10k withResource calls: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
