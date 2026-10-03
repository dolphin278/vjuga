import { test } from "node:test";
import * as Arb from "../../Arbitrary.js";
import * as Prop from "../../Property.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as FunctionReference from "../../FunctionReference.js";

// Directory names drawn from characters that are special in URLs.
const specials = ["%", "?", "#", " ", "&", "+", "=", "é", "a", "Z", "0", "%41", "%zz"];
const dirName = Arb.map(
  Arb.array(Arb.constantFrom(...(specials as [string, ...string[]])), {
    minLength: 1,
    maxLength: 4,
  }),
  (a) => a.join(""),
);
const exportName = Arb.map(Arb.nat(10_000), (n) => `fn${n}`);

// Each run writes and imports a real module, so numRuns is far below the
// 1M used for pure properties (module imports are never garbage-collected).
const root = mkdtempSync(join(tmpdir(), "vjuga-funcref-"));
let counter = 0;

test("string paths with URL-special characters resolve like file: URLs", async () => {
  try {
    await Prop.assertAsync(
      Arb.tuple(dirName, exportName),
      async ([dir, name]) => {
        const d = join(root, `${counter++}-${dir}`);
        mkdirSync(d, { recursive: true });
        const file = join(d, "m.mjs");
        writeFileSync(file, `export function ${name}() { return ${JSON.stringify(name)}; }\n`);
        const viaPath = await FunctionReference.resolve(`${file}#${name}`);
        const url = pathToFileURL(file);
        url.hash = name;
        const viaUrl = await FunctionReference.resolve(url);
        const viaString = await FunctionReference.resolve(url.href);
        return viaPath() === name && viaUrl === viaPath && viaString === viaPath;
      },
      { numRuns: 300 },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing export always rejects with ReferencedSymbolIsNotAFunction", async () => {
  const d = join(root, "missing");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "m.mjs"), "export const x = 1;\n");
  await Prop.assertAsync(
    exportName,
    async (name) => {
      try {
        await FunctionReference.resolve(`${join(d, "m.mjs")}#${name}`);
        return false;
      } catch (e) {
        return e instanceof FunctionReference.ReferencedSymbolIsNotAFunction;
      }
    },
    { numRuns: 300 },
  );
});

// G7-2: the fragment selects an export but is not part of the module key.
const fragment = Arb.constantFrom("none", "bare", "f0", "f1", "f2", "f3", "f4");

test("any mix of fragments into one file shares one module instance; caller URL untouched", async () => {
  const d = mkdtempSync(join(tmpdir(), "vjuga-funcref-once-"));
  let n = 0;
  try {
    await Prop.assertAsync(
      Arb.array(fragment, { minLength: 1, maxLength: 8 }),
      async (picks) => {
        // Fresh file per run: f0..f4 and default all return the evaluation
        // count seen when the module ran; a duplicate instance would bump it.
        const key = `__frOnce${n}`;
        const file = join(d, `m${n++}.mjs`);
        let src = `globalThis.${key} = (globalThis.${key} ?? 0) + 1;\n`;
        src += `const id = globalThis.${key};\n`;
        for (let i = 0; i < 5; i++) src += `export function f${i}() { return id; }\n`;
        src += "export default function () { return id; }\n";
        writeFileSync(file, src);
        for (const pick of picks) {
          const url = pathToFileURL(file);
          if (pick !== "none" && pick !== "bare") url.hash = pick;
          const before = url.href;
          const fn = await FunctionReference.resolve(pick === "bare" ? `${url.href}#` : url);
          if (url.href !== before || fn() !== 1) return false;
        }
        return (globalThis as Record<string, unknown>)[key] === 1;
      },
      { numRuns: 300 },
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
