import { bench } from "./harness.js";
import * as OrderedMap from "../../src/OrderedMap.js";

const m = OrderedMap.make<number, number>();
for (let k = 0; k < 1024; k++) OrderedMap.set(m, k * 2, k);
const churn = OrderedMap.make<number, number>();

bench("get (1024 keys)", (i) => OrderedMap.get(m, (i & 1023) * 2) ?? -1);
bench("floor (1024 keys)", (i) => OrderedMap.floor(m, i & 2047)?.[1] ?? -1);
bench("set + del", (i) => {
  OrderedMap.set(churn, i & 255, i);
  OrderedMap.del(churn, (i + 128) & 255);
  return OrderedMap.size(churn);
});
bench("forRange (16 of 1024)", (i) => {
  let s = 0;
  const lo = (i & 1023) * 2;
  OrderedMap.forRange(m, lo, lo + 30, (_k, v) => {
    s += v;
  });
  return s;
});
