import * as ErrorChain from "../../src/ErrorChain.js";
import * as JSONx from "../../src/JSON.js";
import * as Immutable from "../../src/Immutable.js";
import { variant, match, is, type TaggedUnion } from "../../src/TaggedUnion.js";
import { isOk } from "../../src/Result.js";

const e = new Error("outer", { cause: new TypeError("inner") });
console.log(
  ErrorChain.toArray(e)
    .map((x) => x.message)
    .join(" <- "),
);
console.log(ErrorChain.find((x) => x instanceof TypeError, e)?.message);

const p = JSONx.safeParse('{"a":1,"__proto__":{"x":1}}');
console.log(isOk(p), JSONx.stringify({ a: 1 }), JSONx.escapeJsonString('a"b'));

const cfg = Immutable.make({ host: "localhost", port: 3000 });
console.log(cfg.host, cfg.port);

type Shape = TaggedUnion<{ circle: { r: number }; rect: { w: number; h: number } }>;
const s = variant("rect", { w: 2, h: 3 }) as Shape;
console.log(match(s, { circle: (v) => v.r * v.r, rect: (v) => v.w * v.h }), is(s, "rect"));
