declare const Bun: any;
declare const process: { memoryUsage(): { heapUsed: number } };

import { bench, run } from "mitata";
import { reportOptimizationStatus } from "./_v8.js";
import { escape } from "../HTML.js";

const gc = (): void => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
};

const cleanStr = "Hello, world! This is a plain string without special chars.";
const fewSpecial = 'Hello <world> & "friends"!';
const manySpecial = '<div class="test">Hello &amp; world! It\'s a <b>bold</b> &lt;move&gt;</div>';
const longClean = "a".repeat(1000);
const longSpecial = '<script>alert("xss")</script>&'.repeat(50);
const emptyStr = "";
const singleChar = "<";
const unicodeStr = "Hello 🌍 world — no special HTML chars here";

// --- Warm-up ---
{
  for (let i = 0; i < 100_000; i++) {
    escape(cleanStr);
    escape(fewSpecial);
    escape(manySpecial);
  }
  reportOptimizationStatus(escape, "HTML.escape");
}

// --- Benchmarks ---

bench("HTML.escape: empty string", () => {
  return escape(emptyStr);
});

bench("HTML.escape: single special char (<)", () => {
  return escape(singleChar);
});

bench("HTML.escape: no special chars (short)", () => {
  return escape(cleanStr);
});

bench("HTML.escape: no special chars (long, 1000 chars)", () => {
  return escape(longClean);
});

bench("HTML.escape: few special chars", () => {
  return escape(fewSpecial);
});

bench("HTML.escape: many special chars", () => {
  return escape(manySpecial);
});

bench("HTML.escape: long with many special chars", () => {
  return escape(longSpecial);
});

bench("HTML.escape: unicode (no special HTML chars)", () => {
  return escape(unicodeStr);
});

// Bun.escapeHTML comparison if available
if (typeof Bun !== "undefined") {
  bench("Bun.escapeHTML: few special chars (native)", () => {
    return Bun.escapeHTML(fewSpecial);
  });

  bench("Bun.escapeHTML: many special chars (native)", () => {
    return Bun.escapeHTML(manySpecial);
  });

  bench("Bun.escapeHTML: no special chars (native)", () => {
    return Bun.escapeHTML(cleanStr);
  });
}

await run();

// --- Memory benchmark ---
gc();
const heapBefore = process.memoryUsage().heapUsed;
const results: string[] = [];
for (let i = 0; i < 100_000; i++) {
  results.push(escape(manySpecial));
}
gc();
const heapAfter = process.memoryUsage().heapUsed;
console.log(
  `[memory] 100k HTML.escape (many special): ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`,
);
void results;
