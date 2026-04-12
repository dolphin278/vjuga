import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ISOTimestamp from "../ISOTimestamp.js";
import { ValidationError } from "../schema/ValidationError.js";

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

test("isoTimestamp() rejects 4-digit fractional seconds", () => {
  assert.throws(() => ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.1234Z"), RangeError);
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
