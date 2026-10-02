/**
 * Loads the string cases of a vendored JSON-Schema-Test-Suite format file
 * (see NOTICE in this directory). Non-string instances are dropped: every
 * format ignores them.
 */
import { readFileSync } from "node:fs";

export type SuiteCase = { description: string; data: string; valid: boolean };
type SuiteGroup = { tests: { description: string; data: unknown; valid: boolean }[] };

export function suiteCases(file: "date.json" | "date-time.json" | "time.json"): SuiteCase[] {
  const groups = JSON.parse(
    readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
  ) as SuiteGroup[];
  const out: SuiteCase[] = [];
  for (const g of groups) {
    for (const t of g.tests) {
      if (typeof t.data === "string")
        out.push({ description: t.description, data: t.data, valid: t.valid });
    }
  }
  return out;
}
