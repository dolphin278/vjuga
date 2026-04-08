declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { stringify, parseExn, parse, safeParse } from "../JSON.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

const simpleObj = { id: 1, name: "Alice", active: true };
const nestedObj = {
  user: { id: 1, name: "Alice", roles: ["admin", "user"] },
  meta: { ts: 1234567890, version: 2 },
};
const arrayData = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
const simpleJson = '{"id":1,"name":"Alice","active":true}';
const nestedJson = JSON.stringify(nestedObj);
const arrayJson = JSON.stringify(arrayData);
const invalidJson = "{ invalid json here }";
const protoJson =
  '{"__proto__":{"polluted":true},"safe":"value","nested":{"__proto__":{"bad":true}}}';

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    stringify(simpleObj);
    parseExn(simpleJson);
    parse(simpleJson);
    safeParse(simpleJson);
  }
  reportOptimizationStatus(parse, "JSON.parse (safe)");
  reportOptimizationStatus(parseExn, "JSON.parseExn");
  reportOptimizationStatus(safeParse, "JSON.safeParse");
}

// --- Benchmarks ---

bench("JSON.stringify: simple object", () => {
  return stringify(simpleObj);
});

bench("JSON.stringify: nested object", () => {
  return stringify(nestedObj);
});

bench("JSON.stringify: array of 100 objects", () => {
  return stringify(arrayData);
});

bench("JSON.stringify: number", () => {
  return stringify(42);
});

bench("JSON.parseExn: simple object", () => {
  return parseExn(simpleJson);
});

bench("JSON.parseExn: nested object", () => {
  return parseExn(nestedJson);
});

bench("JSON.parseExn: array of 100 objects", () => {
  return parseExn(arrayJson);
});

bench("JSON.parse (safe): valid json", () => {
  return parse(simpleJson);
});

bench("JSON.parse (safe): invalid json (returns undefined)", () => {
  return parse(invalidJson);
});

bench("JSON.safeParse: clean object (no stripping needed)", () => {
  return safeParse(simpleJson);
});

bench("JSON.safeParse: object with __proto__ keys", () => {
  return safeParse(protoJson);
});

bench("JSON.safeParse: invalid json (returns Err)", () => {
  return safeParse(invalidJson);
});

bench("JSON roundtrip (stringify + parseExn): simple", () => {
  return parseExn(stringify(simpleObj));
});

bench("JSON roundtrip (stringify + parseExn): nested", () => {
  return parseExn(stringify(nestedObj));
});

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const parsed: unknown[] = [];
for (let i = 0; i < 100_000; i++) {
  parsed.push(parseExn(simpleJson));
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 100k JSON.parseExn(simple): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void parsed;
