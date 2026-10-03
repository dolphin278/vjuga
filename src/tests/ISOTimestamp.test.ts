import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ISOTimestamp from "../ISOTimestamp.js";
import { ValidationError } from "../schema/ValidationError.js";
import { suiteCases } from "./fixtures/json-schema-test-suite/cases.js";

// --- isoTimestamp (throwing constructor) ---

test("isoTimestamp() accepts full ISO datetime with Z", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.000Z");
  assert.equal(ts, "2024-01-15T10:30:00.000Z");
});

test("isoTimestamp() accepts datetime without milliseconds", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00Z");
  assert.equal(ts, "2024-01-15T10:30:00Z");
});

test("isoTimestamp() accepts datetime without seconds", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30Z");
  assert.equal(ts, "2024-01-15T10:30Z");
});

test("isoTimestamp() accepts 1-digit fractional seconds", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.1Z");
  assert.equal(ts, "2024-01-15T10:30:00.1Z");
});

test("isoTimestamp() accepts 2-digit fractional seconds", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.12Z");
  assert.equal(ts, "2024-01-15T10:30:00.12Z");
});

test("isoTimestamp() accepts positive timezone offset", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00+05:30");
  assert.equal(ts, "2024-01-15T10:30:00+05:30");
});

test("isoTimestamp() accepts negative timezone offset", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00-08:00");
  assert.equal(ts, "2024-01-15T10:30:00-08:00");
});

test("isoTimestamp() rejects non-ISO string", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("Tuesday"), RangeError);
});

test("isoTimestamp() rejects date-only string", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-01-15"), RangeError);
});

test("isoTimestamp() rejects semantically invalid date (month 99)", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-99-15T10:30:00Z"), RangeError);
});

test("isoTimestamp() rejects empty string", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp(""), RangeError);
});

test("isoTimestamp() accepts any number of fractional digits", () => {
  for (const s of [
    "2024-01-15T10:30:00.1234Z",
    "2026-10-01T12:00:00.123456Z",
    "2026-10-01T12:00:00.123456789+05:30",
    "2026-10-01T12:00:00.000000000000000000001-08:00",
  ]) {
    assert.equal(ISOTimestamp.isoTimestamp(s), s);
    assert.equal(ISOTimestamp.validator()(s)[0], true);
  }
});

test("isoTimestamp() rejects malformed fractions and field ranges", () => {
  for (const s of [
    "2024-01-15T10:30:00.Z",
    "2024-01-15T10:30.123Z",
    "2024-01-15T10:30:00.12a4Z",
    "2024-01-15T10:30:00,123Z",
    "2024-01-15T10:60:00Z",
    "2024-01-15T10:30:60Z",
    "2024-01-15T10:30:00+24:00",
    "2024-01-15T10:30:00+00:60",
    "2024-01-15T10:30:00+0530",
    "2024-01-15T10:30:00+05",
    "2024-01-15T10:30:00+05:30Z",
    "2024-01-15T10:30:00Zx",
    "2024-01-15t10:30:00Z",
    "2024-01-15T10:30:00z",
    "2024-01-15T1a:30:00Z",
    "2024-01-15T10:3a:00Z",
    "2024-01-15T10:30:0aZ",
    "2024-01-15T10-30:00Z",
    "2024-01-15T10:30:00#05:30",
    "2024-01-15T10:30:00+0a:30",
    "2024-01-15T10:30:00+05:3a",
    "2024-01-15T10:30:00+05-30",
    "2024/01/15T10:30:00Z",
    "2024-01/15T10:30:00Z",
    "2a24-01-15T10:30:00Z",
    "20a4-01-15T10:30:00Z",
  ]) {
    assert.throws(() => ISOTimestamp.isoTimestamp(s), RangeError, s);
  }
});

test("isoTimestamp() rejects missing timezone", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-01-15T10:30:00"), RangeError);
});

// --- fromDate / toDate roundtrip ---

test("fromDate() returns branded ISO string from Date", () => {
  const date = new Date("2024-06-15T12:00:00.000Z");
  const ts = ISOTimestamp.fromDate(date);
  assert.equal(ts, "2024-06-15T12:00:00.000Z");
});

test("toDate() converts ISOTimestamp to Date", () => {
  const ts = ISOTimestamp.isoTimestamp("2024-06-15T12:00:00.000Z");
  const date = ISOTimestamp.toDate(ts);
  assert.equal(date.getTime(), new Date("2024-06-15T12:00:00.000Z").getTime());
});

test("fromDate/toDate roundtrip preserves time", () => {
  const original = new Date("2024-03-20T08:15:30.123Z");
  const ts = ISOTimestamp.fromDate(original);
  const back = ISOTimestamp.toDate(ts);
  assert.equal(back.getTime(), original.getTime());
});

test("toDate() truncates fractions beyond milliseconds (never rounds)", () => {
  const t = (s: string): string => ISOTimestamp.toDate(ISOTimestamp.isoTimestamp(s)).toISOString();
  assert.equal(t("2024-01-15T10:30:00.123456Z"), "2024-01-15T10:30:00.123Z");
  assert.equal(t("2024-12-31T23:59:59.9999999Z"), "2024-12-31T23:59:59.999Z");
  assert.equal(t("2024-01-15T10:30:00.1239+01:00"), "2024-01-15T09:30:00.123Z");
  assert.equal(t("2024-01-15T10:30:00.12Z"), "2024-01-15T10:30:00.120Z");
  assert.equal(t("2024-01-15T10:30:00.123Z"), "2024-01-15T10:30:00.123Z");
  assert.equal(t("2024-01-15T10:30Z"), "2024-01-15T10:30:00.000Z");
  assert.equal(t("2024-01-15T10:30:00Z"), "2024-01-15T10:30:00.000Z");
});

test("toDate() handles expanded-year strings cast to the brand", () => {
  for (const ms of [253402300800000, -62198755200000, 8.64e15, -8.64e15]) {
    const cast = new Date(ms).toISOString() as ISOTimestamp.ISOTimestamp;
    assert.equal(ISOTimestamp.toDate(cast).getTime(), ms);
  }
});

test("fromDate() throws RangeError outside years 0000-9999 and for an invalid Date (G8-3)", () => {
  const bad = [
    new Date(Date.UTC(10000, 0, 1)),
    new Date(-62167219200001), // 0000-01-01 minus 1 ms = year -1
    new Date(8.64e15),
    new Date(-8.64e15),
    new Date(NaN),
  ];
  for (const d of bad) {
    assert.throws(() => ISOTimestamp.fromDate(d), RangeError, String(d.getTime()));
  }
  // The bounds themselves are representable.
  assert.equal(ISOTimestamp.fromDate(new Date(-62167219200000)), "0000-01-01T00:00:00.000Z");
  assert.equal(ISOTimestamp.fromDate(new Date(253402300799999)), "9999-12-31T23:59:59.999Z");
});

// --- RFC 3339 predicates (JSON Schema date-time / time) ---

test("isRfc3339DateTime agrees with JSON-Schema-Test-Suite format date-time.json", () => {
  const cases = suiteCases("date-time.json");
  assert.ok(cases.length > 30);
  for (const c of cases) {
    assert.equal(
      ISOTimestamp.isRfc3339DateTime(c.data),
      c.valid,
      `${c.description}: ${JSON.stringify(c.data)}`,
    );
  }
});

test("isRfc3339Time agrees with JSON-Schema-Test-Suite format time.json", () => {
  const cases = suiteCases("time.json");
  assert.ok(cases.length > 30);
  for (const c of cases) {
    assert.equal(
      ISOTimestamp.isRfc3339Time(c.data),
      c.valid,
      `${c.description}: ${JSON.stringify(c.data)}`,
    );
  }
});

test("isRfc3339DateTime / isRfc3339Time edge cases", () => {
  const dt = ISOTimestamp.isRfc3339DateTime;
  const tm = ISOTimestamp.isRfc3339Time;
  assert.equal(dt("2024-01-15T10:30:00Z"), true);
  assert.equal(dt("2024-01-15t10:30:00.1z"), true);
  assert.equal(dt("2024-01-15 10:30:00Z"), false);
  assert.equal(dt("2024-01-15T10:30:00"), false);
  assert.equal(dt("2024-01-15T10:30:00."), false);
  assert.equal(dt("2024-02-30T10:30:00Z"), false);
  assert.equal(dt("2024-01-15T10:30Z"), false);
  assert.equal(dt("2024-01-15"), false);
  assert.equal(dt(""), false);
  assert.equal(dt("1998-12-31T23:59:60.999Z"), true);
  assert.equal(dt("1998-12-31T23:59:61Z"), false);
  assert.equal(tm("00:00:60+00:01"), true); // 23:59:60 UTC on the previous day
  assert.equal(tm("23:59:60-00:00"), true);
  assert.equal(tm("12:00:00-00:00"), true);
  assert.equal(tm("12:00:00+23:59"), true);
  assert.equal(tm("12:00:00+24:00"), false);
  assert.equal(tm("12:00:00+0a:00"), false);
  assert.equal(tm("12:00:00+00:0a"), false);
  assert.equal(tm("12:00:00+00-00"), false);
  assert.equal(tm("12:00:00+00:00x"), false);
  assert.equal(tm("12:00:00Zx"), false);
  assert.equal(tm("12:00:00"), false);
  assert.equal(tm("1a:00:00Z"), false);
  assert.equal(tm("12:0a:00Z"), false);
  assert.equal(tm("12:00:0aZ"), false);
  assert.equal(tm("12-00:00Z"), false);
  assert.equal(tm("12:00-00Z"), false);
  assert.equal(tm("12:00:00.0000000001Z"), true);
  assert.equal(tm(""), false);
});

// --- fromEpochMs ---

test("fromEpochMs() matches native toISOString for epoch", () => {
  assert.equal(ISOTimestamp.fromEpochMs(0), "1970-01-01T00:00:00.000Z");
});

test("fromEpochMs() matches native for a March date (mp < 10 path)", () => {
  // 2024-03-20T08:15:30.123Z
  const ms = new Date("2024-03-20T08:15:30.123Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2024-03-20T08:15:30.123Z");
});

test("fromEpochMs() matches native for January (mp >= 10, m <= 2 path)", () => {
  // January exercises the mp >= 10 and m <= 2 branches
  const ms = new Date("2024-01-15T10:30:00.000Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2024-01-15T10:30:00.000Z");
});

test("fromEpochMs() matches native for February (mp >= 10, m <= 2 path)", () => {
  const ms = new Date("2024-02-28T23:59:59.999Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2024-02-28T23:59:59.999Z");
});

test("fromEpochMs() handles leap year Feb 29 (2004)", () => {
  const ms = new Date("2004-02-29T00:00:00.000Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2004-02-29T00:00:00.000Z");
});

test("fromEpochMs() handles century leap year Feb 29 (2000)", () => {
  const ms = new Date("2000-02-29T00:00:00.000Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2000-02-29T00:00:00.000Z");
});

test("fromEpochMs() handles end of year (Dec 31)", () => {
  const ms = new Date("2023-12-31T23:59:59.999Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "2023-12-31T23:59:59.999Z");
});

test("fromEpochMs() handles far future date", () => {
  // 9999-12-31T23:59:59.999Z
  const ms = new Date("9999-12-31T23:59:59.999Z").getTime();
  assert.equal(ISOTimestamp.fromEpochMs(ms), "9999-12-31T23:59:59.999Z");
});

// --- now ---

test("now() returns a string matching ISO regex", () => {
  const ts = ISOTimestamp.now();
  // Should not throw when validated
  ISOTimestamp.isoTimestamp(ts);
  assert.equal(typeof ts, "string");
});

// --- validator ---

test("validator() returns Ok for valid ISO string", () => {
  const v = ISOTimestamp.validator();
  const r = v("2024-01-15T10:30:00.000Z");
  assert.equal(r[0], true);
  assert.equal(r[1], "2024-01-15T10:30:00.000Z");
});

test("validator() returns Err for non-string", () => {
  const v = ISOTimestamp.validator();
  const r = v(42);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for invalid ISO string", () => {
  const v = ISOTimestamp.validator();
  const r = v("not-a-date");
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for semantically invalid ISO string", () => {
  const v = ISOTimestamp.validator();
  const r = v("2024-99-15T10:30:00Z");
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

// --- fromEpochMs fallback (negative / fractional / out-of-range) ---

test("fromEpochMs() matches native for negative ms", () => {
  for (const ms of [-1, -999, -1000, -86400000, -62135596800000, -1e12]) {
    assert.equal(ISOTimestamp.fromEpochMs(ms), new Date(ms).toISOString());
  }
  assert.equal(ISOTimestamp.fromEpochMs(-1), "1969-12-31T23:59:59.999Z");
});

test("fromEpochMs() matches native for fractional ms", () => {
  for (const ms of [0.5, 1.0005, 1704067200000.9, -0.5]) {
    assert.equal(ISOTimestamp.fromEpochMs(ms), new Date(ms).toISOString());
  }
});

test("fromEpochMs() formats years 0000 and 9999 and throws beyond them (G8-3)", () => {
  assert.equal(ISOTimestamp.fromEpochMs(253402300799999), "9999-12-31T23:59:59.999Z");
  assert.equal(ISOTimestamp.fromEpochMs(253402300799999.9), "9999-12-31T23:59:59.999Z");
  assert.equal(ISOTimestamp.fromEpochMs(-62167219200000), "0000-01-01T00:00:00.000Z");
  // Date truncates fractional ms toward zero, so this is still year 0000.
  assert.equal(ISOTimestamp.fromEpochMs(-62167219200000.9), "0000-01-01T00:00:00.000Z");
  for (const ms of [253402300800000, -62167219200001, -62198755200001, 8.64e15, -8.64e15]) {
    assert.throws(() => ISOTimestamp.fromEpochMs(ms), RangeError, String(ms));
  }
  // Every accepted string satisfies the brand's own grammar.
  for (const ms of [253402300799999, -62167219200000, -1, 0.5]) {
    const ts = ISOTimestamp.fromEpochMs(ms);
    assert.equal(ISOTimestamp.validator()(ts)[0], true, ts);
  }
});

test("fromEpochMs() throws RangeError on NaN / Infinity / beyond Date range", () => {
  assert.throws(() => ISOTimestamp.fromEpochMs(NaN), RangeError);
  assert.throws(() => ISOTimestamp.fromEpochMs(Infinity), RangeError);
  assert.throws(() => ISOTimestamp.fromEpochMs(8.64e15 + 1), RangeError);
});

// --- calendar validation (G6-9) ---

test("isoTimestamp() rejects impossible day-of-month", () => {
  for (const s of [
    "2023-02-29T00:00:00Z",
    "2024-02-30T00:00:00Z",
    "2024-04-31T00:00:00Z",
    "2024-06-31T00:00:00Z",
    "2024-01-32T00:00:00Z",
    "2024-01-00T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2024-00-10T00:00:00Z",
  ]) {
    assert.throws(() => ISOTimestamp.isoTimestamp(s), RangeError, s);
    assert.equal(ISOTimestamp.validator()(s)[0], false, s);
  }
});

test("isoTimestamp() accepts leap days and month ends", () => {
  for (const s of [
    "2024-02-29T00:00:00Z",
    "2000-02-29T00:00:00Z",
    "2024-04-30T23:59:59.999Z",
    "2024-12-31T23:59:59Z",
    "2023-02-28T00:00Z",
  ]) {
    assert.equal(ISOTimestamp.isoTimestamp(s), s);
  }
});

test("isoTimestamp() rejects hour 24", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-01-15T24:00:00Z"), RangeError);
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-01-15T24:00Z"), RangeError);
  assert.equal(ISOTimestamp.validator()("2024-01-15T24:00:00Z")[0], false);
  assert.equal(ISOTimestamp.isoTimestamp("2024-01-15T23:59:59Z"), "2024-01-15T23:59:59Z");
});
