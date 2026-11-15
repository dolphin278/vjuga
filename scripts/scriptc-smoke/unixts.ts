import {
  unixTimestampExn,
  fromDate,
  toDate,
  now,
  fromISO,
  toISO,
} from "../../src/UnixTimestamp.js";
import { isoTimestampExn } from "../../src/ISOTimestamp.js";
const u = unixTimestampExn(1700000000);
console.log(u, toDate(u).toISOString(), toISO(u));
console.log(fromDate(new Date(1700000000999)), fromISO(isoTimestampExn("2024-01-01T00:00:00Z")));
console.log(now() > 1700000000);
let threw = false;
try {
  unixTimestampExn(Number.NaN);
} catch {
  threw = true;
}
console.log(threw);
