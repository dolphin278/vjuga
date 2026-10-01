/**
 * JSON-Schema-Test-Suite (draft 2020-12) conformance for fromJsonSchema +
 * validate. Fixtures: ./fixtures/json-schema-test-suite (pinned, see README).
 *
 * Contract per group: fromJsonSchema returns Err, OR the compiled validator
 * agrees with `valid` on every data case — Ok-and-wrong is a failure. A floor
 * on supported (Ok) groups per file keeps coverage regressions visible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../../schema/Schema.js";
import { validate } from "../../schema/Validate.js";

interface Case {
  readonly description: string;
  readonly data: unknown;
  readonly valid: boolean;
}
interface Group {
  readonly description: string;
  readonly schema: S.JsonSchemaObject | boolean;
  readonly tests: readonly Case[];
}

const DIR = fileURLToPath(new URL("./fixtures/json-schema-test-suite/", import.meta.url));

/** file → minimum number of groups that must convert (Ok) and pass. */
const MIN_SUPPORTED: Readonly<Record<string, number>> = {
  ref: 29,
  defs: 0, // only group $refs the remote 2020-12 metaschema
  oneOf: 11,
  allOf: 12,
  anyOf: 8,
  not: 8,
  "if-then-else": 12,
  boolean_schema: 2,
  type: 11,
  const: 11,
  enum: 11,
  required: 5,
  properties: 5,
  additionalProperties: 4,
  items: 8,
  prefixItems: 0, // prefixItems is only lowered with items: false
  minItems: 2,
  maxItems: 2,
  minimum: 2,
  maximum: 2,
  exclusiveMinimum: 1,
  exclusiveMaximum: 1,
  multipleOf: 5,
  anchor: 4,
  "infinite-loop-detection": 1,
  default: 3,
  minLength: 2,
  maxLength: 2,
  pattern: 2,
};

/**
 * Known, documented divergences (file / group / case → reason). Validate
 * keeps these semantics on its hot path; see the fromJsonSchema JSDoc.
 */
const KNOWN_DIVERGENCES: Readonly<Record<string, string>> = {
  "minLength/minLength validation/one grapheme is not long enough":
    "string length counts UTF-16 code units, not code points",
  "maxLength/maxLength validation/two graphemes is long enough":
    "string length counts UTF-16 code units, not code points",
};

const summary: string[] = [];

for (const file of Object.keys(MIN_SUPPORTED)) {
  test(`JSON-Schema-Test-Suite ${file}.json: Err or exact agreement`, () => {
    const groups = JSON.parse(readFileSync(DIR + file + ".json", "utf8")) as Group[];
    let supported = 0;
    for (const group of groups) {
      const r = S.fromJsonSchema(group.schema);
      if (!r[0]) {
        assert.equal(typeof r[1], "string");
        continue;
      }
      // Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
      const check = validate(r[1] as S.StringSchema) as (v: unknown) => readonly [boolean, unknown];
      for (const c of group.tests) {
        const key = `${file}/${group.description}/${c.description}`;
        if (Object.hasOwn(KNOWN_DIVERGENCES, key)) continue;
        assert.equal(check(c.data)[0], c.valid, `${key} (schema ${JSON.stringify(group.schema)})`);
      }
      supported++;
    }
    summary.push(`${file}: ${supported}/${groups.length}`);
    assert.ok(
      supported >= MIN_SUPPORTED[file],
      `${file}: only ${supported} supported groups, expected >= ${MIN_SUPPORTED[file]}`,
    );
  });
}

test("JSON-Schema-Test-Suite summary", () => {
  console.log("JSON-Schema-Test-Suite supported groups — " + summary.join(", "));
  assert.equal(summary.length, Object.keys(MIN_SUPPORTED).length);
});
