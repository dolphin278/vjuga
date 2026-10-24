import { once } from "../../src/Memoization.js";
const init = once(() => 42);
console.log(init(), init());
