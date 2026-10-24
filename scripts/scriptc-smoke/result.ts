import * as R from "../../src/Result.js";

// Results built on both branches, so the static type is the full union.
function parsePositive(s: string): R.Result<number, string> {
  const n = Number(s);
  return n > 0 ? R.ok(n) : R.err(`not positive: ${s}`);
}

for (const input of ["2", "-1"]) {
  const r = parsePositive(input);
  console.log(R.isOk(r), R.isErr(r));
  if (R.isOk(r)) console.log("value", r[1]);
  if (R.isErr(r)) console.log("error", r[1]);
  console.log(
    R.unwrapOr(
      R.map(r, (x) => x * 10),
      0,
    ),
  );
  console.log(
    R.unwrapOr(
      R.mapErr(r, (e) => e.length),
      0,
    ),
  );
  const f = R.flatMap(r, (x) => (x > 1 ? R.ok(x + 1) : R.err("small")));
  console.log(R.unwrapOr(f, -1));
  try {
    console.log(R.unwrap(r));
  } catch (e) {
    console.log("threw", (e as Error).message);
  }
}
const parsed = R.fromThrowable(() => JSON.parse("{") as unknown);
console.log(R.isErr(parsed));
async function fetchCount(fail: boolean): Promise<number> {
  if (fail) throw new Error("boom");
  return 7;
}
for (const fail of [false, true]) {
  const later = await R.fromPromise(fetchCount(fail), (e) => (e as Error).message);
  console.log(R.isOk(later), R.unwrapOr(later, -1));
}
