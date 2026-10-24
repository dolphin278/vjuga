import { bench } from "./harness.js";
import * as Queue from "../../src/Queue.js";

const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const five = Queue.make<number>([1, 2, 3, 4, 5]);

bench("make + push x5 (grows past 4)", (i) => {
  const q = Queue.make<number>();
  for (let k = 0; k < 5; k++) Queue.push(q, i + k);
  return Queue.size(q);
});
bench("push/shift x100", (i) => {
  const q = Queue.make<number>();
  let s = 0;
  for (let k = 0; k < 100; k++) {
    Queue.push(q, i + k);
    s += Queue.shift(q) ?? 0;
  }
  return s;
});
bench("push x100 then shift x100", (i) => {
  const q = Queue.make<number>();
  for (let k = 0; k < 100; k++) Queue.push(q, k);
  let s = i;
  for (let k = 0; k < 100; k++) s += Queue.shift(q) ?? 0;
  return s;
});
bench("get (5 items)", (i) => Queue.get(five, i % 5));
bench("toArray (10 items)", (i) => Queue.toArray(Queue.make<number>(ten))[i % 10] as number);
