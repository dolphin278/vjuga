import {
  positiveIntegerExn,
  integerExn,
  nonNegativeIntegerExn,
  positiveNumberExn,
  tupled,
  spread,
} from "../../src/FunctionUtils.js";
console.log(
  positiveIntegerExn(5),
  integerExn(-3),
  nonNegativeIntegerExn(0),
  positiveNumberExn(0.5),
);
let threw = false;
try {
  positiveIntegerExn(0);
} catch (e) {
  threw = e instanceof RangeError;
}
console.log(threw);
console.log(tupled((a: number, b: number) => a + b)([1, 2]));
console.log(spread((xs: [number, number]) => xs[0] * xs[1])(3, 4));
