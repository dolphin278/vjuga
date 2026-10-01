import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as UUID from "../../UUID.js";
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

test("uuid(): any-case input is normalized to lowercase; equal UUIDs compare equal", () => {
  Prop.assert(
    Arb.array(Arb.boolean(), { minLength: 36, maxLength: 36 }),
    (flips) => {
      const base = UUID.v4() as string;
      const mixed = [...base].map((c, i) => (flips[i] ? c.toUpperCase() : c)).join("");
      assert.equal(UUID.uuid(mixed), base);
      assert.equal(UUID.validator()(mixed)[1], base);
    },
    { numRuns: 100_000 },
  );
});
