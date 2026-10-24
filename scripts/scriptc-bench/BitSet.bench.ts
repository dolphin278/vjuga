import { bench } from "./harness.js";
import * as BitSet from "../../src/BitSet.js";

const a = BitSet.make(1024);
const b = BitSet.make(1024);
for (let k = 0; k < 1024; k += 3) BitSet.set(a, k);
for (let k = 0; k < 1024; k += 5) BitSet.set(b, k);

bench("get (1024 bits)", (i) => (BitSet.get(a, i & 1023) ? 1 : 0));
bench("make(1024) + set x128 + popcount", (i) => {
  const bs = BitSet.make(1024);
  for (let k = 0; k < 128; k++) BitSet.set(bs, (i + k * 7) & 1023);
  return BitSet.popcount(bs);
});
bench("and + popcount (1024 bits)", () => BitSet.popcount(BitSet.and(a, b)));
bench("toArray (1024 bits, 342 set)", (i) => BitSet.toArray(a)[i % 342] as number);
