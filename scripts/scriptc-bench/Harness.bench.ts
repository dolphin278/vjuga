// Floor: the harness's own per-call cost on each run kind. Subtract it by eye
// before reading a nanosecond-scale result elsewhere.
import { bench } from "./harness.js";

bench("noop (i => i)", (i) => i);
