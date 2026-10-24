import { seed, make, next, nextInt, nextBigInt, split } from "../../src/PRNG.js";
const g = make(seed(42n));
console.log(next(g), nextInt(g, 1, 6), nextBigInt(g));
const h = split(g);
console.log(next(h));
