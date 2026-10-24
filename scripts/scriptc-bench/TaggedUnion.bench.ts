import { bench } from "./harness.js";
import { variant, match, is, type TaggedUnion } from "../../src/TaggedUnion.js";

type Shape = TaggedUnion<{ circle: { r: number }; rect: { w: number; h: number } }>;
const shapes: Shape[] = [
  variant("circle", { r: 2 }) as Shape,
  variant("rect", { w: 2, h: 3 }) as Shape,
];

bench("match (2 variants)", (i) =>
  match(shapes[i & 1] as Shape, { circle: (v) => v.r * v.r, rect: (v) => v.w * v.h }));
bench("is", (i) => (is(shapes[i & 1] as Shape, "rect") ? 1 : 0));
