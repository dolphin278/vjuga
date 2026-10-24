import * as BufferizedFunction from "../../src/BufferizedFunction.js";
const log = BufferizedFunction.make((batch: string[]) => console.log("batch", batch.join(",")));
log("a");
log("b", "c");
const fast = BufferizedFunction.make((batch: number[]) => console.log("io", batch.length), "io");
fast(1);
fast(2);
