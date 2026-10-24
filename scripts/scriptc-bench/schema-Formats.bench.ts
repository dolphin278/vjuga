import { bench } from "./harness.js";
import { isIPv4, isEmail, isUuid, formatTester } from "../../src/schema/Formats.js";

const date = formatTester("date");

bench("isIPv4", (i) => (isIPv4(i & 1 ? "192.168.0.1" : "192.168.0.01") ? 1 : 0));
bench("isEmail", (i) => (isEmail(i & 1 ? "ada@example.com" : "not an email") ? 1 : 0));
bench("isUuid", (i) => (isUuid(i & 1 ? "550e8400-e29b-41d4-a716-446655440000" : "nope") ? 1 : 0));
bench("formatTester('date').test", (i) =>
  date?.test(i & 1 ? "2024-02-29" : "2024-02-30") ? 1 : 0);
