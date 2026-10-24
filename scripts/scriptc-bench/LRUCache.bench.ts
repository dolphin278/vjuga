import { bench } from "./harness.js";
import * as LRUCache from "../../src/LRUCache.js";

const hot = LRUCache.make<number, number>(1024);
for (let k = 0; k < 1024; k++) LRUCache.set(hot, k, k * 2);
const churn = LRUCache.make<number, number>(256);

bench("get (hit, 1024 entries)", (i) => LRUCache.get(hot, i & 1023) ?? -1);
bench("set (evicting, capacity 256)", (i) => {
  LRUCache.set(churn, i, i);
  return LRUCache.size(churn);
});
