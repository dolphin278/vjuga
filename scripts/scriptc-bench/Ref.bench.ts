import { bench } from "./harness.js";
import * as Ref from "../../src/Ref.js";

const r = Ref.make(0);

bench("get + set", (i) => {
  Ref.set(r, (Ref.get(r) + i) & 1023);
  return Ref.get(r);
});
