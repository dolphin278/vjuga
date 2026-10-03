import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as UUID from "../../UUID.js";
import { resetV7State } from "../../UUID.v7.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

test("v7: valid, version 7, timestamp prefix matches clock, unique across pool refills", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50_000; i++) {
    const before = Date.now();
    const id = UUID.v7();
    const after = Date.now();
    assert.equal(UUID.uuid(id), id);
    assert.equal(UUID.version(id), 7);
    const ms = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    assert.ok(ms >= before && ms <= after);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

declare const Bun: unknown;

test("v7 (model): strictly increasing under random clock jumps, stalls and step-backs", () => {
  // Bun delegates v7 to Bun.randomUUIDv7, which ignores a faked Date.now().
  if (typeof Bun !== "undefined") return;
  const counterOf = (id: string): number =>
    parseInt(id.slice(15, 18), 16) * 2 ** 30 +
    (parseInt(id.slice(19, 23) + id.slice(24, 28), 16) & 0x3fffffff);
  const msOf = (id: string): number => parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  const realNow = Date.now;
  let clock = 0;
  const fakeNow = (): number => clock;
  try {
    Prop.assert(
      Arb.tuple(
        Arb.integer(0, 2 ** 47),
        Arb.array(Arb.oneOf(Arb.constant(0), Arb.integer(-3, 3), Arb.integer(-5000, 5000)), {
          maxLength: 40,
        }),
      ),
      ([start, deltas]) => {
        // Fake the clock only while v7 runs, never across the runner's own code.
        Date.now = fakeNow;
        try {
          clock = start;
          resetV7State();
          // Model: the embedded timestamp is the running max of the clock; the
          // counter increments by exactly 1 while that max does not move.
          let modelMs = clock;
          let prev = UUID.v7();
          assert.equal(msOf(prev), modelMs);
          for (const d of deltas) {
            clock = Math.max(0, clock + d);
            const id = UUID.v7();
            assert.equal(UUID.uuid(id), id);
            assert.equal(UUID.version(id), 7);
            assert.ok(id > prev, `${id} > ${prev}`);
            if (clock > modelMs) {
              modelMs = clock;
              assert.ok(counterOf(id) < 2 ** 41, "fresh seed has the top counter bit clear");
            } else {
              assert.equal(counterOf(id), counterOf(prev) + 1);
            }
            assert.equal(msOf(id), modelMs);
            prev = id;
          }
        } finally {
          Date.now = realNow;
        }
      },
      { numRuns: 1_000_000 },
    );
  } finally {
    Date.now = realNow;
    resetV7State();
  }
});

test("uuid(): any-case input is normalized to lowercase; equal UUIDs compare equal", () => {
  Prop.assert(
    Arb.array(Arb.boolean(), { minLength: 36, maxLength: 36 }),
    (flips) => {
      const base = UUID.v4() as string;
      const mixed = [...base].map((c, i) => (flips[i] ? c.toUpperCase() : c)).join("");
      assert.equal(UUID.uuid(mixed), base);
      assert.equal(UUID.validator()(mixed)[1], base);
    },
    { numRuns: 1_000_000 },
  );
});
