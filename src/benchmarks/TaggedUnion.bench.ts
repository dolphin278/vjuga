import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import * as TU from "../TaggedUnion.js";

type Shape = TU.TaggedUnion<{
  circle: { radius: number };
  square: { side: number };
  point: undefined;
}>;

const handlers = {
  circle: (v: { radius: number }) => Math.PI * v.radius ** 2,
  square: (v: { side: number }) => v.side ** 2,
  point: () => 0,
};

// Match receives the full union type via function call.
function matchShape(s: Shape): number {
  return TU.match(s, handlers);
}

function checkIs(s: Shape, tag: Shape["tag"]): boolean {
  return TU.is(s, tag);
}

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    matchShape(TU.variant("circle", { radius: i }));
    matchShape(TU.variant("square", { side: i }));
    matchShape(TU.variant("point", undefined));
    checkIs(TU.variant("circle", { radius: i }), "circle");
    checkIs(TU.variant("circle", { radius: i }), "square");
  }
  reportOptimizationStatus(TU.variant, "TaggedUnion.variant");
  reportOptimizationStatus(TU.match, "TaggedUnion.match");
  reportOptimizationStatus(TU.is, "TaggedUnion.is");
}

// --- Benchmarks ---

bench("TaggedUnion.variant()", () => TU.variant("circle", { radius: 5 }));

bench("TaggedUnion.match() — circle", () => {
  return matchShape(TU.variant("circle", { radius: 5 }));
});

bench("TaggedUnion.match() — square", () => {
  return matchShape(TU.variant("square", { side: 4 }));
});

bench("TaggedUnion.match() — point (undefined value)", () => {
  return matchShape(TU.variant("point", undefined));
});

bench("TaggedUnion.is() — true", () => {
  return checkIs(TU.variant("circle", { radius: 5 }), "circle");
});

bench("TaggedUnion.is() — false", () => {
  return checkIs(TU.variant("circle", { radius: 5 }), "square");
});

await run();

export {};
