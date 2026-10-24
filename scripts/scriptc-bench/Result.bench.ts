import { bench } from "./harness.js";
import * as R from "../../src/Result.js";

function parsePositive(n: number): R.Result<number, string> {
  return n > 0 ? R.ok(n) : R.err("not positive");
}

bench("ok/err + map + unwrapOr", (i) =>
  R.unwrapOr(
    R.map(parsePositive((i & 3) - 1), (x) => x * 10),
    0,
  ));
bench("flatMap + isOk", (i) => {
  const r = R.flatMap(parsePositive(i & 7), (x) => (x > 3 ? R.ok(x) : R.err("small")));
  return R.isOk(r) ? r[1] : 0;
});
