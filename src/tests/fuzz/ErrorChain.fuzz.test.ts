import { test } from "node:test";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as ErrorChain from "../../ErrorChain.js";

// Model: n errors linked 0 -> 1 -> ... -> n-1; the last cause is either a
// non-Error terminator or a back-edge to node `back` (cycle). Every node is
// reachable exactly once, so each traversal must yield exactly the nodes.
const terminators: unknown[] = [undefined, null, "str", 42, { message: "not an Error" }];

const scenario = Arb.record({
  n: Arb.integer(1, 24),
  terminator: Arb.integer(0, terminators.length - 1),
  cyclic: Arb.boolean(),
  back: Arb.nat(1000),
});

function build(s: { n: number; terminator: number; cyclic: boolean; back: number }): Error[] {
  const nodes = Array.from({ length: s.n }, (_, i) => new Error(`e${i}`));
  for (let i = 0; i + 1 < s.n; i++) nodes[i]!.cause = nodes[i + 1];
  nodes[s.n - 1]!.cause = s.cyclic ? nodes[s.back % s.n] : terminators[s.terminator];
  return nodes;
}

test("toArray / chain yield every reachable error exactly once, cycles included", () => {
  Prop.assert(
    scenario,
    (s) => {
      const nodes = build(s);
      const arr = ErrorChain.toArray(nodes[0]!);
      const gen = [...ErrorChain.chain(nodes[0]!)];
      if (arr.length !== nodes.length || gen.length !== nodes.length) return false;
      return nodes.every((e, i) => arr[i] === e && gen[i] === e);
    },
    { numRuns: 1_000_000 },
  );
});

test("find returns the first match or undefined and always terminates", () => {
  Prop.assert(
    Arb.tuple(scenario, Arb.nat(30)),
    ([s, k]) => {
      const nodes = build(s);
      const found = ErrorChain.find((e) => e.message === `e${k}`, nodes[0]!);
      return k < nodes.length ? found === nodes[k] : found === undefined;
    },
    { numRuns: 1_000_000 },
  );
});
