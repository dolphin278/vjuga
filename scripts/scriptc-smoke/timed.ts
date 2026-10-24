import { throttle, debounce } from "../../src/TimedFunction.js";
const t = throttle((x: number) => console.log("throttled", x), 10);
t(1);
t(2);
const d = debounce((x: number) => console.log("debounced", x), 5);
d(1);
d(2);
await new Promise((r) => setTimeout(r, 40));
