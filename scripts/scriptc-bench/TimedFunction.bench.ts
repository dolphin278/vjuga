import { bench } from "./harness.js";
import { throttle, debounce } from "../../src/TimedFunction.js";

let fired = 0;
const t = throttle((x: number) => {
  fired += x;
}, 50);
const d = debounce((x: number) => {
  fired += x;
}, 50);

// After the first call every throttled call inside the 50 ms window is dropped.
bench("throttle (dropped call)", (i) => {
  t(1);
  return (i & 1) + (fired > 0 ? 1 : 0);
});
// Each call clears and re-arms one timer.
bench("debounce (re-arm)", (i) => {
  d(1);
  return i & 1;
});
