/**
 * Fuzz tests for PRNG: the uint32 SplitMix64 must stay bit-identical to the
 * reference BigInt implementation (seeds and replay paths of every property
 * test depend on it) across random seeds and random split/draw chains.
 */
import { test } from "node:test";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import * as PRNG from "../../PRNG.js";
import * as Ref from "../fixtures/PRNGReference.js";

type Op =
  | { readonly kind: "next" }
  | { readonly kind: "bigint" }
  | { readonly kind: "split" }
  | { readonly kind: "fork" }
  | { readonly kind: "int"; readonly min: number; readonly range: number };

const opArb: Arb.Arbitrary<Op> = Arb.frequency<Op>(
  { weight: 2, arb: Arb.constant({ kind: "next" }) },
  { weight: 2, arb: Arb.constant({ kind: "bigint" }) },
  { weight: 2, arb: Arb.constant({ kind: "split" }) },
  { weight: 1, arb: Arb.constant({ kind: "fork" }) },
  {
    weight: 6,
    arb: Arb.map(
      // Exponent picks the reduction path (one-step, Horner, BigInt); the
      // offset lands on and around each power-of-two boundary.
      Arb.tuple(Arb.integer(-1e9, 1e9), Arb.nat(53), Arb.integer(-2, 2)),
      ([min, exp, off]) => ({
        kind: "int" as const,
        min,
        range: Math.min(2 ** 53, Math.max(2, 2 ** exp + off)),
      }),
    ),
  },
);

test("PRNG: uint32 implementation is bit-identical to the BigInt reference", () => {
  Prop.assert(
    Arb.tuple(Arb.bigint(0n, 2n ** 64n - 1n), Arb.array(opArb, { maxLength: 24 })),
    ([s, ops]) => {
      let a = PRNG.make(PRNG.seed(s));
      let b = Ref.make(s);
      const forksA: PRNG.PRNG[] = [];
      const forksB: Ref.RefPRNG[] = [];
      for (const op of ops) {
        switch (op.kind) {
          case "next":
            if (PRNG.next(a) !== Ref.next(b)) return false;
            break;
          case "bigint":
            if (PRNG.nextBigInt(a) !== Ref.nextBigInt(b)) return false;
            break;
          case "split":
            forksA.push(PRNG.split(a));
            forksB.push(Ref.split(b));
            break;
          case "fork":
            if (forksA.length > 0) {
              a = forksA.pop()!;
              b = forksB.pop()!;
            }
            break;
          case "int": {
            // Keep max a safe integer: the reference is exact only there.
            const min = op.range > 2 ** 52 ? 0 : op.min;
            const max = min + op.range - 1;
            if (PRNG.nextInt(a, min, max) !== Ref.nextInt(b, min, max)) return false;
            break;
          }
        }
      }
      // Trailing draws compare the final state of both streams.
      return PRNG.nextBigInt(a) === Ref.nextBigInt(b);
    },
    { numRuns: 1_000_000 },
  );
});
