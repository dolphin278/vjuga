import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ISO from "../../ISOTimestamp.js";
import * as Unix from "../../UnixTimestamp.js";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import { fullFormats } from "ajv-formats/dist/formats.js";

// Full ECMAScript Date range.
const MAX_MS = 8.64e15;
// Years 0000-9999: the instants the brand can represent.
const MIN_4Y = -62167219200000;
const MAX_4Y = 253402300799999;

/** Oracle: native formatting inside years 0000-9999 (after Date's truncation), RangeError outside. */
function expectEpochMs(ms: number, actual: () => string): void {
  const t = Math.trunc(ms);
  if (t >= MIN_4Y && t <= MAX_4Y) assert.equal(actual(), new Date(ms).toISOString());
  else assert.throws(actual, RangeError, String(ms));
}

test("fromEpochMs matches native in years 0000-9999 and throws outside (integers)", () => {
  Prop.assert(
    Arb.oneOf(
      Arb.integer(-0x7fff_ffff, 0x7fff_ffff),
      Arb.map(Arb.float(-MAX_MS, MAX_MS), Math.trunc),
      Arb.map(Arb.float(-1e13, 4e14), Math.trunc),
      Arb.integer(MIN_4Y - 1000, MIN_4Y + 1000),
      Arb.integer(MAX_4Y - 1000, MAX_4Y + 1000),
      Arb.constantFrom(0, -1, MIN_4Y, MIN_4Y - 1, MAX_4Y, MAX_4Y + 1, -MAX_MS, MAX_MS, NaN),
    ),
    (ms) => {
      expectEpochMs(ms, () => ISO.fromEpochMs(ms));
      expectEpochMs(ms, () => ISO.fromDate(new Date(ms)));
    },
    { numRuns: 1_000_000 },
  );
});

test("fromEpochMs matches native for fractional ms; Unix.toISO/toDate keep exact ms", () => {
  Prop.assert(
    Arb.oneOf(Arb.float(-1e13, 4e14), Arb.float(MIN_4Y - 2, MIN_4Y + 2)),
    (ms) => {
      expectEpochMs(ms, () => ISO.fromEpochMs(ms));
      const s = Unix.unixTimestamp(ms / 1000);
      // toDate: the exact ms whose own double is `s`, else Date's truncation.
      const got = Unix.toDate(s).getTime();
      assert.ok(got / 1000 === s || got === Math.trunc(s * 1000), `${s} -> ${got}`);
      assert.ok(Math.abs(got - s * 1000) < 1, `${s} -> ${got}`);
      expectEpochMs(got, () => Unix.toISO(s));
    },
    { numRuns: 1_000_000 },
  );
});

test("Unix.toDate/toISO round-trip every exact millisecond over the full Date range", () => {
  Prop.assert(
    Arb.oneOf(
      Arb.integer(-0x7fff_ffff, 0x7fff_ffff),
      // `+ 0` turns -0 into 0, which is what Date#getTime returns.
      Arb.map(Arb.float(-MAX_MS, MAX_MS), (x) => Math.trunc(x) + 0),
      Arb.map(Arb.float(MIN_4Y, MAX_4Y), (x) => Math.trunc(x) + 0),
    ),
    (ms) => {
      const s = Unix.unixTimestamp(ms / 1000);
      assert.equal(Unix.toDate(s).getTime(), ms, String(s));
      expectEpochMs(ms, () => Unix.toISO(s));
    },
    { numRuns: 1_000_000 },
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
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// Structured near-miss datetime strings
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
const two = (max: number): Arb.Arbitrary<string> => Arb.map(Arb.integer(0, max), (n) => pad(n));

const dateArb = Arb.oneOf(
  Arb.map(Arb.integer(-62167219200000, 253402300799999), (ms) =>
    new Date(ms).toISOString().slice(0, 10),
  ),
  Arb.map(
    Arb.tuple(Arb.integer(0, 9999), Arb.integer(0, 13), Arb.integer(0, 32)),
    ([y, m, d]) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`,
  ),
);
// Valid ranges are repeated so that roughly half of the generated strings parse.
const hourArb = Arb.oneOf(
  two(23),
  two(23),
  two(23),
  two(25),
  Arb.constantFrom("23", "00", "24", "7", "99"),
);
const minuteArb = Arb.oneOf(
  two(59),
  two(59),
  two(59),
  two(61),
  Arb.constantFrom("59", "00", "60", "5", "99"),
);
const secondArb = Arb.oneOf(two(59), two(59), two(61), Arb.constantFrom("59", "60", "61", "5"));
const digitsArb = Arb.map(Arb.array(Arb.integer(0, 9), { maxLength: 20 }), (ds) => ds.join(""));
const fractionArb = Arb.oneOf(
  Arb.constant(""),
  Arb.map(digitsArb, (ds) => "." + ds),
  Arb.constantFrom(".9999999999999999", ".999999999999999", ".5", ".123", ","),
);
const signArb = Arb.constantFrom("+", "-");
const offsetArb = Arb.oneOf(
  Arb.constantFrom("Z", "z", "Z", "z", "+00:00", "-00:00"),
  Arb.map(Arb.tuple(signArb, two(23), two(59)), ([sg, h, m]) => `${sg}${h}:${m}`),
  Arb.map(Arb.tuple(signArb, two(23), two(59)), ([sg, h, m]) => `${sg}${h}:${m}`),
  Arb.constantFrom("", "ZZ", "Z+00:00", " "),
  Arb.map(Arb.tuple(signArb, two(25), two(61)), ([sg, h, m]) => `${sg}${h}:${m}`),
  Arb.map(Arb.tuple(signArb, two(25), two(61)), ([sg, h, m]) => `${sg}${h}${m}`),
  Arb.map(Arb.tuple(signArb, two(25)), ([sg, h]) => `${sg}${h}`),
);
const sepArb = Arb.constantFrom("T", "T", "T", "t", " ", "_", "\n");
const MUTATION_CHARS: [string, ...string[]] = [
  "",
  "0",
  "9",
  ":",
  ".",
  "-",
  "+",
  "Z",
  "z",
  "T",
  " ",
  "x",
  "\u09ea",
];
const mutationCharArb = Arb.constantFrom(...MUTATION_CHARS);
const coin = Arb.integer(0, 4);
const bit = Arb.integer(0, 1);
const posArb = Arb.integer(0, 40);

const mutate = (pick: Arb.GenPick, s: string): string => {
  if (pick(coin) !== 0) return s;
  const at = Math.min(pick(posArb), s.length);
  return s.slice(0, at) + pick(mutationCharArb) + s.slice(at + pick(bit));
};

/** hh:mm[:ss[.frac]]offset with plausible, boundary and out-of-range fields. */
const timeArb: Arb.Arbitrary<string> = Arb.gen((pick) => {
  let t = `${pick(hourArb)}:${pick(minuteArb)}`;
  if (pick(coin) !== 0) t += `:${pick(secondArb)}${pick(fractionArb)}`; // seconds in 4/5
  return mutate(pick, t + pick(offsetArb));
});
const dateTimeArb: Arb.Arbitrary<string> = Arb.gen((pick) =>
  mutate(pick, pick(dateArb) + pick(sepArb) + pick(timeArb)),
);

// ---------------------------------------------------------------------------
// Independent references
// ---------------------------------------------------------------------------

function refDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const RFC_TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

/** RFC 3339 full-time via regex + arithmetic (leap second only at 23:59 UTC). */
function refTime(t: string): boolean {
  const m = RFC_TIME.exec(t);
  if (m === null) return false;
  const [h, mi, sec] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const off = m[5] === undefined ? 0 : (m[5] === "-" ? -1 : 1) * (Number(m[6]) * 60 + Number(m[7]));
  if (h > 23 || mi > 59 || sec > 60) return false;
  if (m[5] !== undefined && (Number(m[6]) > 23 || Number(m[7]) > 59)) return false;
  return sec < 60 || (((h * 60 + mi - off) % 1440) + 1440) % 1440 === 1439;
}

function refDateTime(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](.*)$/s.exec(s);
  return m !== null && refDate(Number(m[1]), Number(m[2]), Number(m[3])) && refTime(m[4]!);
}

const ajvTime = (fullFormats.time as { validate: (s: string) => boolean }).validate;
const ajvDateTime = (fullFormats["date-time"] as { validate: (s: string) => boolean }).validate;

/**
 * Narrow classifier for the documented divergences from ajv-formats 3.0.1 full
 * mode. Returns true only when `s` (a time, or the time part of a date-time)
 * belongs to a class where ajv is known to differ in the observed direction.
 */
function knownAjvDivergence(time: string, ajvAccepts: boolean): boolean {
  const m = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(.*)$/s.exec(time);
  if (m === null) return false;
  const [hh, mm, ss, tz] = [Number(m[1]), Number(m[2]), m[3]!, m[4]!];
  if (ajvAccepts) {
    // 1. Offset without colon or without minutes ("+0130", "+01").
    if (/^[+-]\d\d(?:\d\d)?$/.test(tz)) return true;
    // 2. Out-of-range hour/minute fall into ajv's leap-second branch, which
    //    only checks that the offset-adjusted time is 23:59 UTC.
    return hh > 23 || mm > 59;
  }
  // 3. ajv parses seconds as a float, so "59.999999999999999" rounds up to 60
  //    (and "60.99…" to 61), crossing its range check.
  return Number(ss) >= Number(ss.slice(0, 2)) + 1;
}

test("isRfc3339Time equals the regex reference and ajv-formats outside known divergences", () => {
  Prop.assert(
    timeArb,
    (t) => {
      const mine = ISO.isRfc3339Time(t);
      assert.equal(mine, refTime(t), t);
      const ajv = ajvTime(t);
      if (ajv !== mine)
        assert.ok(knownAjvDivergence(t, ajv), `unexpected ajv divergence: ${JSON.stringify(t)}`);
    },
    { numRuns: 1_000_000 },
  );
});

test("isRfc3339DateTime equals the regex reference and ajv-formats outside known divergences", () => {
  Prop.assert(
    dateTimeArb,
    (s) => {
      const mine = ISO.isRfc3339DateTime(s);
      assert.equal(mine, refDateTime(s), s);
      const ajv = ajvDateTime(s);
      if (ajv !== mine) {
        // 4. ajv also splits on whitespace instead of only T/t.
        const wsSeparator = ajv && /^\d{4}-\d\d-\d\d\s/.test(s);
        assert.ok(
          wsSeparator || knownAjvDivergence(s.slice(11), ajv),
          `unexpected ajv divergence: ${JSON.stringify(s)}`,
        );
      }
    },
    { numRuns: 1_000_000 },
  );
});

// ---------------------------------------------------------------------------
// isoTimestamp: unchanged behaviour for <= 3 fraction digits, truncation beyond
// ---------------------------------------------------------------------------

const OLD_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The pre-v9.1 gate: regex + calendar + hour <= 23 + Date.parse. */
function oldIsValid(s: string): boolean {
  if (!OLD_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return Number(s.slice(11, 13)) <= 23 && refDate(y, m, d) && !isNaN(Date.parse(s));
}

const accepts = (s: string): boolean => {
  try {
    ISO.isoTimestamp(s);
    return true;
  } catch {
    return false;
  }
};

/** Truncate a fraction longer than 3 digits (the documented toDate rule). */
const truncateFraction = (s: string): string => s.replace(/(\.\d{3})\d+/, "$1");

test("isoTimestamp keeps the old gate for <= 3 fraction digits and truncates longer ones", () => {
  Prop.assert(
    dateTimeArb,
    (s) => {
      const longFraction = /:\d\d\.\d{4,}/.test(s);
      const now = accepts(s);
      assert.equal(ISO.validator()(s)[0], now, s);
      if (!longFraction) {
        assert.equal(now, oldIsValid(s), s);
        return;
      }
      const short = truncateFraction(s);
      assert.equal(now, oldIsValid(short), s);
      if (now) {
        assert.equal(ISO.toDate(ISO.isoTimestamp(s)).getTime(), new Date(short).getTime(), s);
      }
    },
    { numRuns: 1_000_000 },
  );
});
