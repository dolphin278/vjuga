import * as S from "../../src/schema/Schema.js";
const user = S.object({
  id: S.integer({ minimum: 1 }),
  name: S.string({ minLength: 1 }),
  role: S.enum_("admin", "user"),
  tags: S.array(S.string()),
  pos: S.tuple(S.number(), S.number()),
  pet: S.union(S.literal("cat"), S.literal("dog")),
  both: S.allOf(S.string(), S.string({ maxLength: 3 })),
  one: S.oneOf(S.string(), S.number()),
  nick: S.optional(S.nullable(S.string())),
});
console.log(user.kind, user.meta.additionalProperties);
console.log(user.meta.properties.role.meta.values.join(","));
console.log(user.meta.properties.pos.meta.items.length);
console.log(
  S.isPrimitive(S.string()),
  S.isPrimitive(user),
  S.findDiscriminant([S.object({ t: S.literal("a") }), S.object({ t: S.literal("b") })]),
);
