import { bench } from "./harness.js";
import * as ISOTimestamp from "../../src/ISOTimestamp.js";

bench("isRfc3339DateTime", (i) =>
  ISOTimestamp.isRfc3339DateTime(i & 1 ? "2024-01-01T10:20:30.123+02:00" : "2024-01-01T00:00:00Z")
    ? 1
    : 0);
bench("fromEpochMs", (i) => ISOTimestamp.fromEpochMs(1700000000000 + i * 1000).length);
