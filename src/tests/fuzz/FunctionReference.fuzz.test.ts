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
