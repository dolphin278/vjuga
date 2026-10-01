import { setTimeout as sleep } from "node:timers/promises";

// Fuzz fixture: { op, v, ms } -> echo | slow echo | throw | crash.
export default async (m) => {
  if (m.op === "crash") process.exit(1);
  if (m.op === "throw") throw new Error("t" + m.v);
  if (m.op === "slow") await sleep(m.ms);
  return m.v;
};
