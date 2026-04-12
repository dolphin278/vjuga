import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as UnixTimestamp from "../UnixTimestamp.js";
import * as ISOTimestamp from "../ISOTimestamp.js";
import { ValidationError } from "../schema/ValidationError.js";

// --- unixTimestamp (throwing constructor) ---

test("unixTimestamp() accepts positive number", () => {
  const ts = UnixTimestamp.unixTimestamp(1705312200);
  assert.equal(ts, 1705312200);
});

test("unixTimestamp() accepts zero", () => {
  const ts = UnixTimestamp.unixTimestamp(0);
  assert.equal(ts, 0);
});

test("unixTimestamp() accepts negative number (pre-epoch)", () => {
  const ts = UnixTimestamp.unixTimestamp(-86400);
  assert.equal(ts, -86400);
});

test("unixTimestamp() accepts fractional seconds", () => {
  const ts = UnixTimestamp.unixTimestamp(1705312200.5);
  assert.equal(ts, 1705312200.5);
});

test("unixTimestamp() rejects NaN", () => {
  assert.throws(() => UnixTimestamp.unixTimestamp(NaN), RangeError);
});

test("unixTimestamp() rejects Infinity", () => {
  assert.throws(() => UnixTimestamp.unixTimestamp(Infinity), RangeError);
});

test("unixTimestamp() rejects -Infinity", () => {
  assert.throws(() => UnixTimestamp.unixTimestamp(-Infinity), RangeError);
});

// --- fromDate / toDate roundtrip ---

test("fromDate() converts Date to epoch seconds (floored)", () => {
  const date = new Date("2024-01-15T10:30:00.999Z");
  const ts = UnixTimestamp.fromDate(date);
  assert.equal(ts, Math.floor(date.getTime() / 1000));
});

test("toDate() converts UnixTimestamp to Date", () => {
  const ts = UnixTimestamp.unixTimestamp(1705312200);
  const date = UnixTimestamp.toDate(ts);
  assert.equal(date.getTime(), 1705312200 * 1000);
});

test("fromDate/toDate roundtrip preserves second precision", () => {
  const original = new Date("2024-03-20T08:15:30.000Z");
  const ts = UnixTimestamp.fromDate(original);
  const back = UnixTimestamp.toDate(ts);
  assert.equal(back.getTime(), original.getTime());
});

// --- now ---

test("now() returns a reasonable epoch value", () => {
  const ts = UnixTimestamp.now();
  // Should be after 2024-01-01 and before some far future
  assert.ok(ts > 1704067200);
  assert.ok(ts < 4102444800); // year 2100
});

// --- fromISO / toISO ---

test("fromISO() converts ISOTimestamp to UnixTimestamp", () => {
  const iso = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.000Z");
  const unix = UnixTimestamp.fromISO(iso);
  assert.equal(unix, Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000));
});

test("toISO() converts UnixTimestamp to ISOTimestamp", () => {
  const unix = UnixTimestamp.unixTimestamp(1705312200);
  const iso = UnixTimestamp.toISO(unix);
  // Should be valid ISO
  ISOTimestamp.isoTimestamp(iso);
  assert.equal(typeof iso, "string");
});

test("fromISO/toISO roundtrip preserves second precision", () => {
  const iso = ISOTimestamp.isoTimestamp("2024-01-15T10:30:00.000Z");
  const unix = UnixTimestamp.fromISO(iso);
  const back = UnixTimestamp.toISO(unix);
  assert.equal(new Date(back as string).getTime(), new Date(iso as string).getTime());
});

// --- validator ---

test("validator() returns Ok for valid number", () => {
  const v = UnixTimestamp.validator();
  const r = v(1705312200);
  assert.equal(r[0], true);
  assert.equal(r[1], 1705312200);
});

test("validator() returns Ok for negative number", () => {
  const v = UnixTimestamp.validator();
  const r = v(-86400);
  assert.equal(r[0], true);
  assert.equal(r[1], -86400);
});

test("validator() returns Err for NaN", () => {
  const v = UnixTimestamp.validator();
  const r = v(NaN);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for string", () => {
  const v = UnixTimestamp.validator();
  const r = v("1705312200");
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for Infinity", () => {
  const v = UnixTimestamp.validator();
  const r = v(Infinity);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});
