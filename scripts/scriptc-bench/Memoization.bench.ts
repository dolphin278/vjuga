// memoize does not compile under scriptc 0.4.4 (see README); once only.
import { bench } from "./harness.js";
import { once } from "../../src/Memoization.js";

const init = once(() => 42);

bench("once (after first call)", (i) => init() + (i & 1));
