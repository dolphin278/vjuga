// props does not compile under scriptc 0.4.4 (vercel-labs/scriptc#2132).
import { benchAsync } from "./harness.js";
import { pool, propsMap } from "../../src/PromiseUtils.js";

const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

await benchAsync("pool (16 items, limit 4)", async (i) => {
  const rs = await pool(items, 4, async (x: number) => x * 2 + (i & 1));
  let s = 0;
  for (const r of rs) if (r.status === "fulfilled") s += r.value;
  return s;
});
await benchAsync("propsMap (4 entries)", async (i) => {
  const m = new Map<string, Promise<number>>([
    ["a", Promise.resolve(1)],
    ["b", Promise.resolve(2)],
    ["c", Promise.resolve(3)],
    ["d", Promise.resolve(i & 1)],
  ]);
  const r = await propsMap(m);
  return (r.get("a") ?? 0) + (r.get("d") ?? 0);
});
