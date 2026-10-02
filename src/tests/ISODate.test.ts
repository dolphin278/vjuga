import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ISODate from "../ISODate.js";
import { ValidationError } from "../schema/ValidationError.js";
import { suiteCases } from "./fixtures/json-schema-test-suite/cases.js";

// --- JSON-Schema-Test-Suite (format: "date") ---

test("isISODate agrees with JSON-Schema-Test-Suite format date.json", () => {
  const cases = suiteCases("date.json");
  assert.ok(cases.length > 50);
  for (const c of cases) {
    assert.equal(ISODate.isISODate(c.data), c.valid, `${c.description}: ${JSON.stringify(c.data)}`);
    assert.equal(ISODate.validator()(c.data)[0], c.valid, c.description);
  }
});

// --- daysInMonth ---

test("daysInMonth() handles leap rules and invalid months", () => {
  assert.equal(ISODate.daysInMonth(2024, 2), 29);
  assert.equal(ISODate.daysInMonth(2023, 2), 28);
  assert.equal(ISODate.daysInMonth(1900, 2), 28);
  assert.equal(ISODate.daysInMonth(2000, 2), 29);
  assert.equal(ISODate.daysInMonth(0, 2), 29);
  assert.equal(ISODate.daysInMonth(2024, 1), 31);
  assert.equal(ISODate.daysInMonth(2024, 4), 30);
  assert.equal(ISODate.daysInMonth(2024, 12), 31);
  assert.equal(ISODate.daysInMonth(2024, 0), 0);
  assert.equal(ISODate.daysInMonth(2024, 13), 0);
  assert.equal(ISODate.daysInMonth(2024, -1), 0);
});

// --- isoDate / isISODate ---

test("isoDate() brands valid dates", () => {
  for (const s of ["2024-02-29", "0000-01-01", "9999-12-31", "2026-10-01", "1582-10-10"]) {
    assert.equal(ISODate.isoDate(s), s);
    assert.equal(ISODate.isISODate(s), true);
  }
});

test("isoDate() rejects impossible dates and wrong shapes with RangeError", () => {
  for (const s of [
    "2023-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-04-31",
    "2026-1-01",
    "2026-01-1",
    "2026/01/01",
    "2026-01/01",
    "2026-01-01T00:00:00Z",
    "20260101",
    "",
    "2026-0a-01",
    "a026-01-01",
    "202a-01-01",
    "2026-01-0a",
    "2026-01-01 ",
  ]) {
    assert.throws(() => ISODate.isoDate(s), RangeError, s);
    assert.equal(ISODate.isISODate(s), false, s);
  }
});

// --- fromDate / toDate / today ---

test("fromDate() uses the UTC calendar date", () => {
  assert.equal(ISODate.fromDate(new Date("2024-03-01T23:30:00-05:00")), "2024-03-02");
  assert.equal(ISODate.fromDate(new Date("2024-01-15T00:00:00.000Z")), "2024-01-15");
  assert.equal(ISODate.fromDate(new Date("2024-01-14T23:59:59.999Z")), "2024-01-14");
  assert.equal(ISODate.fromDate(new Date("1969-12-31T23:59:59.999Z")), "1969-12-31");
  assert.equal(ISODate.fromDate(new Date("0999-03-04T00:00:00Z")), "0999-03-04");
  assert.equal(ISODate.fromDate(new Date("0000-01-01T00:00:00Z")), "0000-01-01");
  assert.equal(ISODate.fromDate(new Date("9999-12-31T23:59:59.999Z")), "9999-12-31");
});

test("fromDate() throws RangeError for invalid Date and years outside 0000-9999", () => {
  assert.throws(() => ISODate.fromDate(new Date(NaN)), RangeError);
  assert.throws(() => ISODate.fromDate(new Date("+010000-01-01T00:00:00Z")), RangeError);
  assert.throws(() => ISODate.fromDate(new Date("-000001-12-31T23:59:59Z")), RangeError);
});

test("toDate() returns UTC midnight", () => {
  assert.equal(
    ISODate.toDate(ISODate.isoDate("2024-02-29")).toISOString(),
    "2024-02-29T00:00:00.000Z",
  );
  assert.equal(
    ISODate.toDate(ISODate.isoDate("0000-01-01")).toISOString(),
    "0000-01-01T00:00:00.000Z",
  );
  assert.equal(
    ISODate.toDate(ISODate.isoDate("9999-12-31")).toISOString(),
    "9999-12-31T00:00:00.000Z",
  );
  assert.equal(
    ISODate.toDate(ISODate.isoDate("1969-07-20")).toISOString(),
    "1969-07-20T00:00:00.000Z",
  );
});

test("today() is the current UTC date", () => {
  const before = new Date().toISOString().slice(0, 10);
  const t = ISODate.today();
  const after = new Date().toISOString().slice(0, 10);
  assert.ok(t === before || t === after, t);
  assert.equal(ISODate.isISODate(t), true);
});

// --- addDays ---

test("addDays() rolls over months, years and leap days", () => {
  const d = ISODate.isoDate;
  assert.equal(ISODate.addDays(d("2024-02-28"), 1), "2024-02-29");
  assert.equal(ISODate.addDays(d("2023-02-28"), 1), "2023-03-01");
  assert.equal(ISODate.addDays(d("2024-12-31"), 1), "2025-01-01");
  assert.equal(ISODate.addDays(d("2025-01-01"), -1), "2024-12-31");
  assert.equal(ISODate.addDays(d("2024-02-28"), -59), "2023-12-31");
  assert.equal(ISODate.addDays(d("2024-01-31"), 30), "2024-03-01");
  assert.equal(ISODate.addDays(d("2000-02-28"), 366), "2001-02-28");
  assert.equal(ISODate.addDays(d("2024-06-15"), 0), "2024-06-15");
  assert.equal(ISODate.addDays(d("0000-03-01"), -1), "0000-02-29");
  assert.equal(ISODate.addDays(d("0000-01-01"), 365), "0000-12-31");
  assert.equal(ISODate.addDays(d("0000-01-01"), 3652424), "9999-12-31");
  assert.equal(ISODate.addDays(d("9999-12-31"), -3652424), "0000-01-01");
});

test("addDays() throws RangeError for non-integer n or out-of-range results", () => {
  const x = ISODate.isoDate("2024-01-01");
  for (const n of [0.5, NaN, Infinity, -Infinity, 2 ** 53]) {
    assert.throws(() => ISODate.addDays(x, n), RangeError, String(n));
  }
  assert.throws(() => ISODate.addDays(ISODate.isoDate("9999-12-31"), 1), RangeError);
  assert.throws(() => ISODate.addDays(ISODate.isoDate("0000-01-01"), -1), RangeError);
});

// --- validator ---

test("validator() returns Ok / Err", () => {
  const v = ISODate.validator();
  assert.deepEqual(v("2024-01-15"), [true, "2024-01-15"]);
  const bad = v("2024-02-30");
  assert.equal(bad[0], false);
  assert.ok(bad[1] instanceof ValidationError);
  const nonString = v(20240115);
  assert.equal(nonString[0], false);
  assert.ok(nonString[1] instanceof ValidationError);
});
