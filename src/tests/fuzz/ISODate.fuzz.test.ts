import { test } from "node:test";
import * as assert from "node:assert/strict";
import { fullFormats } from "ajv-formats/dist/formats.js";
import * as ISODate from "../../ISODate.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";

const MS_PER_DAY = 86_400_000;
/** Day numbers (since 1970-01-01) of 0000-01-01 and 9999-12-31. */
const MIN_DAY = -719_528;
const MAX_DAY = 2_932_896;

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

/** Reference: regex shape + Date's own calendar (setUTCFullYear avoids the 0-99 → 19xx mapping). */
function refIsDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Reference: Date-based formatting of a day number (valid for years 0000-9999). */
const refFromDay = (day: number): string => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

const ajvDate = fullFormats.date as { validate: (s: string) => boolean };

const MUTATION_CHARS = ["", "0", "9", "-", "/", " ", "T", "Z", "x", ":", "৪", "٠", "\n"];

const yearArb = Arb.oneOf(
  Arb.map(Arb.integer(0, 9999), (y) => pad(y, 4)),
  Arb.constantFrom("0000", "0400", "0100", "1900", "2000", "2100", "2024", "123", "12345"),
);
const monthArb = Arb.oneOf(
  Arb.map(Arb.integer(0, 13), (m) => pad(m, 2)),
  Arb.constantFrom("1", "001", "99"),
);
const dayArb = Arb.oneOf(
  Arb.map(Arb.integer(0, 32), (d) => pad(d, 2)),
  Arb.constantFrom("1", "28", "29", "30", "31"),
);
const mutationCharArb = Arb.constantFrom(...(MUTATION_CHARS as [string, ...string[]]));
const coin5 = Arb.integer(0, 4);
const bit = Arb.integer(0, 1);
const positionArb = Arb.integer(0, 12);

/** Structured near-miss date strings: plausible fields plus one optional char mutation. */
const dateLike: Arb.Arbitrary<string> = Arb.gen((pick) => {
  let s = `${pick(yearArb)}-${pick(monthArb)}-${pick(dayArb)}`;
  if (pick(coin5) === 0) {
    const at = Math.min(pick(positionArb), s.length);
    s = s.slice(0, at) + pick(mutationCharArb) + s.slice(at + pick(bit));
  }
  return s;
});

test("isISODate agrees with a Date-based reference and with ajv-formats on near-miss strings", () => {
  Prop.assert(
    dateLike,
    (s) => {
      const expected = refIsDate(s);
      assert.equal(ISODate.isISODate(s), expected, s);
      // ajv-formats full-mode `date` implements the same RFC 3339 full-date grammar.
      assert.equal(ajvDate.validate(s), expected, s);
      assert.equal(ISODate.validator()(s)[0], expected, s);
      if (expected) assert.equal(ISODate.isoDate(s), s);
      else assert.throws(() => ISODate.isoDate(s), RangeError);
    },
    { numRuns: 1_000_000 },
  );
});

test("fromDate / toDate / isoDate round-trip over the full 0000-9999 range", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(MIN_DAY, MAX_DAY), Arb.integer(0, MS_PER_DAY - 1)),
    ([day, msInDay]) => {
      const d = ISODate.fromDate(new Date(day * MS_PER_DAY + msInDay));
      assert.equal(d, refFromDay(day));
      assert.equal(ISODate.isoDate(d), d);
      assert.equal(ISODate.toDate(d).getTime(), day * MS_PER_DAY);
      assert.equal(ISODate.fromDate(ISODate.toDate(d)), d);
    },
    { numRuns: 1_000_000 },
  );
});

test("addDays agrees with Date UTC arithmetic and round-trips", () => {
  Prop.assert(
    Arb.tuple(
      Arb.integer(MIN_DAY, MAX_DAY),
      Arb.oneOf(Arb.integer(-400, 400), Arb.integer(-4_000_000, 4_000_000)),
    ),
    ([day, n]) => {
      const d = ISODate.isoDate(refFromDay(day));
      const target = day + n;
      if (target < MIN_DAY || target > MAX_DAY) {
        assert.throws(() => ISODate.addDays(d, n), RangeError);
        return;
      }
      const moved = ISODate.addDays(d, n);
      assert.equal(moved, refFromDay(target));
      assert.equal(ISODate.addDays(moved, -n), d);
      assert.equal(ISODate.toDate(moved).getTime() - ISODate.toDate(d).getTime(), n * MS_PER_DAY);
    },
    { numRuns: 1_000_000 },
  );
});

test("daysInMonth agrees with Date for every year/month", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(0, 9999), Arb.integer(1, 12)),
    ([y, m]) => {
      const dt = new Date(0);
      dt.setUTCFullYear(y, m, 0); // day 0 of next month = last day of month m
      assert.equal(ISODate.daysInMonth(y, m), dt.getUTCDate());
    },
    { numRuns: 1_000_000 },
  );
});
