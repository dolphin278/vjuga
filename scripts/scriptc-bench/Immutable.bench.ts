import { bench } from "./harness.js";
import * as Immutable from "../../src/Immutable.js";

const cfg = { host: "localhost", port: 3000 };

// make is a type-level cast: this measures the call alone.
bench("make + read", (i) => Immutable.make(cfg).port + i);
