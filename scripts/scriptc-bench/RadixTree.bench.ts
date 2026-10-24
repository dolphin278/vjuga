// Skipped for scriptc in run.ts (vercel-labs/scriptc#2139); Bun and Node only.
import { bench } from "./harness.js";
import * as RadixTree from "../../src/RadixTree.js";

const routes: string[] = [];
for (let k = 0; k < 256; k++) routes.push(`/api/v1/users/${k}/posts/${k % 7}`);
const t = RadixTree.make<number>();
for (let k = 0; k < routes.length; k++) RadixTree.insert(t, routes[k] as string, k);

bench("lookup (256 keys)", (i) => RadixTree.lookup(t, routes[i & 255] as string) ?? -1);
bench("prefixMatch ('/api/v1/users/1')", (i) =>
  RadixTree.prefixMatch(t, "/api/v1/users/1").length + (i & 1));
