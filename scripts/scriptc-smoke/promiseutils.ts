import { propsMap, pool } from "../../src/PromiseUtils.js";
const m = new Map<string, Promise<number>>([
  ["a", Promise.resolve(1)],
  ["b", Promise.resolve(2)],
]);
const r = await propsMap(m);
console.log(r.get("a"), r.get("b"), r.size);
const s = await pool([1, 2, 3, 4], 2, async (x: number) => x * x);
console.log(s.map((x) => (x.status === "fulfilled" ? x.value : -1)).join(","));
const t = await pool(["a", "b"], 1, (x: string, i: number) => {
  if (i === 1) throw new Error("no " + x);
  return x.toUpperCase();
});
console.log(t.map((x) => (x.status === "fulfilled" ? x.value : "rejected")).join(","));
