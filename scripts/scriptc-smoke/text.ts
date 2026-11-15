// Branded-type standard set: Text brands, number Result/guard/assertion, refine.
import { isNonBlank, nonBlank, nonBlankExn, nonEmptyString } from "../../src/Text.js";
import {
  assertPositiveInteger,
  isPositiveInteger,
  positiveInteger,
  refine,
  type Branded,
  type Refinement,
} from "../../src/FunctionUtils.js";
type Slug = Branded<string, "Slug">;
const Slug: Refinement<string, Slug, "empty"> = refine("Slug", (v: string) =>
  v.length === 0 ? "empty" : undefined,
);
const n: unknown = 3;
assertPositiveInteger(n);
let caught = "";
try {
  nonBlankExn("  ");
} catch (e) {
  caught = String((e as Error).cause);
}
console.log(
  JSON.stringify([
    nonBlank("  a b "),
    nonBlank(" "),
    isNonBlank("a "),
    nonEmptyString(""),
    positiveInteger(0),
    isPositiveInteger(2),
    n + 1,
    Slug.make("x"),
    Slug.make(""),
    caught,
  ]),
);
