import { bench } from "./harness.js";
import * as PriorityQueue from "../../src/PriorityQueue.js";

bench("push x100 + pop x100", (i) => {
  const pq = PriorityQueue.make<number>((a, b) => a - b);
  for (let k = 0; k < 100; k++) PriorityQueue.push(pq, (i + k * 37) % 101);
  let s = 0;
  for (let k = 0; k < 100; k++) s += PriorityQueue.pop(pq) ?? 0;
  return s;
});
