import {
  isRfc3339DateTime,
  isRfc3339Time,
  isoTimestamp,
  fromDate,
  toDate,
  fromEpochMs,
  now,
} from "../../src/ISOTimestamp.js";
console.log(
  isRfc3339DateTime("2024-01-01T00:00:00Z"),
  isRfc3339DateTime("x"),
  isRfc3339Time("12:00:00Z"),
);
const t = isoTimestamp("2024-01-01T10:20:30.123+02:00");
console.log(t, toDate(t).getTime());
console.log(fromDate(new Date(0)), fromEpochMs(1700000000000));
console.log(now().length > 0);
