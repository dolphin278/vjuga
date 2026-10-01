import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ISO from "../../ISOTimestamp.js";
import * as Unix from "../../UnixTimestamp.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

// Full ECMAScript Date range.
const MAX_MS = 8.64e15;

test("fromEpochMs matches native toISOString over the full Date range (integers)", () => {
  Prop.assert(
    Arb.oneOf(
      Arb.integer(-0x7fff_ffff, 0x7fff_ffff),
      Arb.map(Arb.float(-MAX_MS, MAX_MS), Math.trunc),
      Arb.map(Arb.float(-1e13, 4e14), Math.trunc),
      Arb.constantFrom(0, -1, 253402300799999, 253402300800000, -MAX_MS, MAX_MS),
    ),
    (ms) => {
      assert.equal(ISO.fromEpochMs(ms), new Date(ms).toISOString());
    },
    { numRuns: 500_000 },
  );
});

test("fromEpochMs matches native for fractional ms and Unix.toISO", () => {
  Prop.assert(
    Arb.float(-1e13, 4e14),
    (ms) => {
      assert.equal(ISO.fromEpochMs(ms), new Date(ms).toISOString());
      const s = Unix.unixTimestamp(ms / 1000);
      assert.equal(Unix.toISO(s), new Date(s * 1000).toISOString());
    },
    { numRuns: 200_000 },
  );
});

test("isoTimestamp round-trips every valid Date in 0000-9999 and rejects rolled-over days", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(-62167219200000, 253402300799999), Arb.integer(29, 31)),
    ([ms, badDay]) => {
      const s = new Date(ms).toISOString();
      assert.equal(ISO.isoTimestamp(s), s);
      assert.equal(ISO.validator()(s)[0], true);
      assert.equal(ISO.toDate(ISO.isoTimestamp(s)).getTime(), ms);

      // Swap in a day-of-month that may not exist in this month: must be accepted
      // iff the calendar date really exists (no roll-over).
      const probe = s.slice(0, 8) + String(badDay) + s.slice(10);
      const d = new Date(probe);
      const exists = !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === probe.slice(0, 10);
      assert.equal(ISO.validator()(probe)[0], exists, probe);

      // Hour 24 is never valid.
      assert.equal(ISO.validator()(s.slice(0, 11) + "24" + s.slice(13))[0], false);
    },
    { numRuns: 200_000 },
  );
});
