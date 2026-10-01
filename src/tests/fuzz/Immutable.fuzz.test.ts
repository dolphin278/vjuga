import { test } from "node:test";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as Immutable from "../../Immutable.js";

// Immutable is type-only: make() must be an identity cast for every value
// (no copy, no freeze). Type-level behaviour is covered by Immutable.test.ts.
test("make returns the very same value", () => {
  Prop.assert(
    Arb.oneOf<unknown>(
      Arb.integer(),
      Arb.string(),
      Arb.boolean(),
      Arb.array(Arb.integer(), { maxLength: 8 }),
      Arb.record({ a: Arb.integer(), b: Arb.string() }),
    ),
    (v) => {
      const m = Immutable.make(v);
      return Object.is(m, v) && !Object.isFrozen(m) === !Object.isFrozen(v);
    },
    { numRuns: 1_000_000 },
  );
});
