import {
  isIPv4,
  isIPv6,
  isEmail,
  isUri,
  isUuid,
  isKnownFormat,
  formatTester,
  KNOWN_FORMATS,
} from "../../src/schema/Formats.js";
console.log(
  isIPv4("192.168.0.1"),
  isIPv4("192.168.0.01"),
  isIPv6("::1"),
  isEmail("a@b.co"),
  isUri("https://x.y/z"),
);
console.log(
  isUuid("550e8400-e29b-41d4-0716-446655440000"),
  isKnownFormat("date"),
  isKnownFormat("hostname"),
);
console.log(
  formatTester("date")?.test("2024-02-30"),
  formatTester("iso-datetime")?.test("2024-01-15T10:30:00Z"),
);
console.log(KNOWN_FORMATS.join(","));
