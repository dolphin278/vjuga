import { test } from "node:test";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as Ref from "../../Ref.js";

test("Ref get/set agree with a model variable", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(), Arb.array(Arb.integer(), { minLength: 0, maxLength: 30 })),
    ([init, writes]) => {
      const ref = Ref.make(init);
      let model = init;
      if (Ref.get(ref) !== model) return false;
      for (const w of writes) {
        Ref.set(ref, w);
        model = w;
        if (Ref.get(ref) !== model || ref.contents !== model) return false;
      }
      return true;
    },
    { numRuns: 1_000_000 },
  );
});

test("refs are independent cells", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(), Arb.integer()),
    ([a, b]) => {
      const r1 = Ref.make(a);
      const r2 = Ref.make(a);
      Ref.set(r1, b);
      return Ref.get(r2) === a && Ref.get(r1) === b;
    },
    { numRuns: 1_000_000 },
  );
});
