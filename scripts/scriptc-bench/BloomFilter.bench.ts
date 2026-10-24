import { bench } from "./harness.js";
import * as BloomFilter from "../../src/BloomFilter.js";

const keys: string[] = [];
for (let k = 0; k < 1024; k++) keys.push(`user:${k * 7919}`);
const full = BloomFilter.make(1024, 0.01);
for (const k of keys) BloomFilter.add(full, k);
const fresh = BloomFilter.make(1 << 20, 0.01);

bench("mightContain (hit)", (i) =>
  BloomFilter.mightContain(full, keys[i & 1023] as string) ? 1 : 0);
bench("add", (i) => {
  BloomFilter.add(fresh, keys[i & 1023] as string);
  return BloomFilter.hashCount(fresh);
});
