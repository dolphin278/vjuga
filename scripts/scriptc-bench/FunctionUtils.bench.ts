// pipe, partial, partialNamed do not compile under scriptc 0.4.4 (see README).
import { bench } from "./harness.js";
import { positiveInteger, tupled } from "../../src/FunctionUtils.js";

const add = tupled((a: number, b: number) => a + b);

bench("positiveInteger", (i) => positiveInteger(i + 1));
bench("tupled call", (i) => add([i, 1]));
