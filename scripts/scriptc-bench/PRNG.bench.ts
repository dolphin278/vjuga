import { bench } from "./harness.js";
import * as PRNG from "../../src/PRNG.js";

const g = PRNG.make(PRNG.seed(42n));
const h = PRNG.make(PRNG.seed(7n));

// The generators advance across calls, so the checksum pins the sequence.
bench("next", () => Math.floor(PRNG.next(g) * 1024));
bench("nextInt(1, 6)", () => PRNG.nextInt(h, 1, 6));
