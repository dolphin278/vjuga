// toJsonSchema / fromJsonSchema / propertyMayBeAbsent do not compile under
// scriptc 0.4.4 (see README): builders and helpers only.
import { bench } from "./harness.js";
import * as S from "../../src/schema/Schema.js";

const a = S.object({ t: S.literal("a"), n: S.number() });
const b = S.object({ t: S.literal("b"), s: S.string() });

bench("object (4 fields) build", (i) => {
  const s = S.object({
    id: S.integer({ minimum: 1 }),
    name: S.string({ minLength: 1 }),
    tags: S.array(S.string()),
    role: S.enum_("admin", "user"),
  });
  return s.meta.properties.role.meta.values.length + (i & 1);
});
bench("findDiscriminant (2 variants)", (i) =>
  S.findDiscriminant([a, b]) === "t" ? 1 + (i & 1) : 0);
