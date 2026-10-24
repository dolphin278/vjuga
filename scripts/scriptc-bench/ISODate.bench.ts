import { bench } from "./harness.js";
import * as ISODate from "../../src/ISODate.js";
import { isOk } from "../../src/Result.js";

const d = ISODate.isoDate("2024-02-28");
const validate = ISODate.validator();

bench("isISODate (valid)", (i) => (ISODate.isISODate(i & 1 ? "2024-02-29" : "2023-12-31") ? 1 : 0));
bench("addDays", (i) => ISODate.addDays(d, i & 63).length);
bench("validator (invalid -> ValidationError)", (i) =>
  isOk(validate(i & 1 ? "2023-02-29" : 5)) ? 1 : 0);
