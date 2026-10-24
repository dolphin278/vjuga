import {
  daysInMonth,
  isISODate,
  isoDate,
  fromDate,
  addDays,
  toDate,
  today,
} from "../../src/ISODate.js";
console.log(daysInMonth(2024, 2), daysInMonth(1900, 2));
console.log(isISODate("2024-02-29"), isISODate("2023-02-29"));
const d = isoDate("2024-02-28");
console.log(addDays(d, 2), toDate(d).toISOString());
console.log(fromDate(new Date("2024-03-01T23:30:00-05:00")));
const t = today();
console.log(t.length);
