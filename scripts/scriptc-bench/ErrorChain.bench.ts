import { bench } from "./harness.js";
import * as ErrorChain from "../../src/ErrorChain.js";

const e = new Error("a", { cause: new Error("b", { cause: new TypeError("c") }) });

bench("toArray (depth 3)", (i) => ErrorChain.toArray(e).length + (i & 1));
bench("find (depth 3, last)", (i) =>
  ErrorChain.find((x) => x instanceof TypeError, e) === undefined ? 0 : 1 + (i & 1));
