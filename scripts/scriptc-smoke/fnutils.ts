import {
  positiveInteger,
  integer,
  nonNegativeInteger,
  positiveNumber,
  tupled,
  spread,
} from "../../src/FunctionUtils.js";
console.log(positiveInteger(5), integer(-3), nonNegativeInteger(0), positiveNumber(0.5));
let threw = false;
try {
  positiveInteger(0);
} catch (e) {
  threw = e instanceof RangeError;
}
console.log(threw);
console.log(tupled((a: number, b: number) => a + b)([1, 2]));
console.log(spread((xs: [number, number]) => xs[0] * xs[1])(3, 4));
