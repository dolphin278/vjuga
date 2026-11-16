import { NIL, MAX, uuidExn, v4, v7, version, validator } from "../../src/UUID.js";
console.log(NIL);
console.log(MAX);
const id = uuidExn("550E8400-E29B-41D4-A716-446655440000");
console.log(id, version(id));
const r = v4();
console.log(r.length, version(r));
const a = v7();
const b = v7();
console.log(version(a), a < b);
let threw = false;
try {
  uuidExn("nope");
} catch (e) {
  threw = e instanceof RangeError;
}
console.log(threw);
const v = validator();
console.log(typeof v);
