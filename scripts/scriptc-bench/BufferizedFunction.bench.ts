import { benchAsync } from "./harness.js";
import * as BufferizedFunction from "../../src/BufferizedFunction.js";

let flushed: (n: number) => void = () => {};
const buffer = BufferizedFunction.make((batch: number[]) => flushed(batch.length), "io");

// 16 calls buffered, then one flush on setImmediate resolves the promise.
await benchAsync("16 calls -> 1 flush (io)", (i) => {
  const p = new Promise<number>((resolve) => {
    flushed = resolve;
  });
  for (let k = 0; k < 16; k++) buffer(i + k);
  return p;
});
