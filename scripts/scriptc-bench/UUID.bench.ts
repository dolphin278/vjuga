// v4 and v7 are random: the checksum covers length and version only. On Bun
// v7 is Bun.randomUUIDv7; Node and scriptc run the JS implementation.
import { bench } from "./harness.js";
import { uuid, v4, v7, version } from "../../src/UUID.js";

bench("uuid (parse + validate)", (i) =>
  version(
    uuid(i & 1 ? "550E8400-E29B-41D4-A716-446655440000" : "018f3c1e-7b2a-7cc1-9a3b-0123456789ab"),
  ));
bench("v4", (i) => v4().length + version(v4()) + (i & 1));
bench("v7", (i) => version(v7()) + (i & 1));
