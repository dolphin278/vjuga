import { bench } from "./harness.js";
import * as UnixTimestamp from "../../src/UnixTimestamp.js";
import { isoTimestamp } from "../../src/ISOTimestamp.js";

const iso = isoTimestamp("2024-01-01T00:00:00Z");

bench("unixTimestamp (validate)", (i) => UnixTimestamp.unixTimestamp(1700000000 + i));
bench("toISO", (i) => UnixTimestamp.toISO(UnixTimestamp.unixTimestamp(1700000000 + i)).length);
bench("fromISO", (i) => UnixTimestamp.fromISO(iso) + (i & 1));
