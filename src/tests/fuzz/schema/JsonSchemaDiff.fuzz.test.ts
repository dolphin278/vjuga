/**
 * Differential fuzz: fromJsonSchema + validate vs ajv (draft 2020-12).
 *
 * Random non-recursive JSON Schemas inside the lowered subset (typed and
 * untyped keywords, const/enum, anyOf/oneOf/allOf/not/if-then-else, boolean
 * schemas, type arrays, $ref into $defs with sibling keywords) and random
 * JSON values. Whenever fromJsonSchema returns Ok, validate's verdict must
 * equal ajv's. Values stay inside the documented divergences: ASCII strings
 * (UTF-16 length = code points), safe integers, `u`-neutral patterns.
 *
 * A second ajv instance runs with ajv-formats (full mode) and `allErrors`:
 * string groups may carry a `format`, format strings are drawn from a pool on
 * which both sides agree (checked up front — ajv-formats is not the
 * correctness oracle, JSON-Schema-Test-Suite is), and
 * `validate(s, { allErrors: true })` must match ajv's verdict and, for
 * schemas without combinators, its set of failing instance locations.
 */
/* eslint-disable unicorn/no-thenable -- JSON Schema `then` keyword is data */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as S from "../../../schema/Schema.js";
import { validate, type SchemaError } from "../../../schema/Validate.js";
import { formatTester } from "../../../schema/Formats.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import { rng, hashSeed, type Rng } from "./_serial-gen.js";

const NUM_RUNS = 1_000_000;
// Distinct schemas per run of the property (each compiles once, ajv + ours)
const SCHEMA_SEEDS = 32_768;
const VALUES_PER_RUN = 6;

interface AjvError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly params: Record<string, unknown>;
}
interface AjvValidate {
  (data: unknown): boolean;
  errors?: AjvError[] | null;
}
interface AjvLike {
  compile(schema: unknown): AjvValidate;
  addSchema(schema: unknown): unknown;
}
const require = createRequire(import.meta.url);
const Ajv2020 = (require("ajv/dist/2020") as { default: new (o: object) => AjvLike }).default;
const addFormats = (require("ajv-formats") as { default: (a: AjvLike, o: object) => void }).default;
// One instance for both modes: allErrors never changes ajv's verdict
const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
addFormats(ajv, { mode: "full" });

// External document reached through `options.refs` (ours) / addSchema (ajv);
// its internal refs resolve against its own `$id`, not the referring document
const EXT_ID = "http://example.com/ext.json";
const EXT = {
  $id: EXT_ID,
  $defs: {
    int: { type: "integer", minimum: 2 },
    str: { $anchor: "str", type: "string", minLength: 1 },
    obj: { type: "object", required: ["a"], properties: { a: { $ref: "#/$defs/int" } } },
  },
};
ajv.addSchema(EXT);
const EXT_REFS = [EXT_ID + "#/$defs/int", EXT_ID + "#str", EXT_ID + "#/$defs/obj"];

type Js = Record<string, unknown> | boolean;

const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pickOf = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
const chance = (r: Rng, p: number): boolean => r() < p;

// No Object.prototype names: ajv reads `data.constructor` through the prototype
// chain, so it rejects {} against `properties: { constructor: ... }`.
const KEYS = ["a", "b", "c", "type"];
// Enforced by both sides, plus one name neither knows (annotation-only)
const FORMATS = ["date", "date-time", "time", "email", "uri", "uuid", "ipv4", "ipv6", "x-unknown"];
// Format-shaped strings on which ours and ajv-formats agree for every format
const FORMAT_STRINGS = [
  "2024-02-29",
  "2023-02-29",
  "2024-02-29T12:00:00Z",
  "2024-02-29T12:00:00.5+01:30",
  "2024-02-29T25:00:00Z",
  "12:00:00Z",
  "23:59:60Z",
  "12:00:00",
  "a@b.co",
  "joe.bloggs@example.com",
  "http://x.y/z?q#f",
  "urn:a:b",
  "http://ex.com/%zz",
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400e29b41d4a716446655440000",
  "10.0.0.1",
  "256.0.0.1",
  "::1",
  "1::2::3",
  "fe80::1:192.168.0.1",
];
const STRINGS = ["", "a", "b", "ab", "abc", "ba", "a1", "12", "zzzz", "type", ...FORMAT_STRINGS];
const NUMBERS = [0, 1, -1, 2, 3, 5, 10, 2.5, -7, 1e3];
const PATTERNS = ["^a", "b$", "^[a-c]+$", "\\d", "^$"];
const TYPES = ["string", "number", "integer", "boolean", "null", "object", "array"];
const SMALL = [-2, -1, 0, 1, 2, 3, 5];

function primitiveValue(r: Rng): string | number | boolean | null {
  switch (int(r, 4)) {
    case 0:
      return pickOf(r, STRINGS);
    case 1:
      return pickOf(r, NUMBERS);
    case 2:
      return chance(r, 0.5);
    default:
      return null;
  }
}

function distinctPrimitives(r: Rng, n: number): (string | number | boolean | null)[] {
  const out: (string | number | boolean | null)[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const v = primitiveValue(r);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function keySubset(r: Rng, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = pickOf(r, KEYS);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** Keyword group for one type (used typed and untyped). */
function addGroup(
  r: Rng,
  js: Record<string, unknown>,
  type: string,
  depth: number,
  defs: number,
): void {
  switch (type) {
    case "string":
      if (chance(r, 0.4)) js.minLength = int(r, 3);
      if (chance(r, 0.3)) js.maxLength = 1 + int(r, 3);
      if (chance(r, 0.25)) js.pattern = pickOf(r, PATTERNS);
      if (chance(r, 0.3)) js.format = pickOf(r, FORMATS);
      break;
    case "number":
    case "integer":
      if (chance(r, 0.4)) js.minimum = pickOf(r, SMALL);
      if (chance(r, 0.3)) js.maximum = pickOf(r, SMALL);
      if (chance(r, 0.2)) js.exclusiveMinimum = pickOf(r, SMALL);
      if (chance(r, 0.2)) js.exclusiveMaximum = pickOf(r, SMALL);
      if (chance(r, 0.25)) js.multipleOf = pickOf(r, [1, 2, 3]);
      break;
    case "object": {
      const keys = keySubset(r, int(r, 3));
      if (keys.length > 0 || chance(r, 0.3)) {
        const props: Record<string, Js> = {};
        for (const k of keys) props[k] = genJs(r, depth - 1, defs);
        js.properties = props;
        if (chance(r, 0.4)) js.additionalProperties = chance(r, 0.5);
      } else if (chance(r, 0.4)) {
        js.additionalProperties = chance(r, 0.3) ? chance(r, 0.5) : genJs(r, depth - 1, defs);
      }
      if (chance(r, 0.5)) js.required = keySubset(r, int(r, 3));
      break;
    }
    case "array":
      if (chance(r, 0.25)) {
        const n = 1 + int(r, 3); // the metaschema requires >= 1 entry
        js.prefixItems = Array.from({ length: n }, () => genJs(r, depth - 1, defs));
        js.items = false;
      } else if (chance(r, 0.7)) {
        js.items = chance(r, 0.15) ? chance(r, 0.5) : genJs(r, depth - 1, defs);
      }
      if (chance(r, 0.3)) js.minItems = int(r, 3);
      if (chance(r, 0.3)) js.maxItems = int(r, 4);
      break;
  }
}

function list(r: Rng, depth: number, defs: number): Js[] {
  return Array.from({ length: 1 + int(r, 3) }, () => genJs(r, depth - 1, defs));
}

/** Random schema; `defs` = number of `$defs` entries a `$ref` may target. */
function genJs(r: Rng, depth: number, defs: number): Js {
  if (chance(r, 0.05)) return chance(r, 0.6);
  const leaf = depth <= 0;
  const js: Record<string, unknown> = {};
  switch (int(r, leaf ? 4 : 12)) {
    case 0: {
      const t = pickOf(r, ["string", "number", "integer", "boolean", "null"]);
      js.type = t;
      addGroup(r, js, t, depth, defs);
      break;
    }
    case 1:
      if (chance(r, 0.5)) js.const = primitiveValue(r);
      else js.enum = distinctPrimitives(r, 1 + int(r, 4));
      if (chance(r, 0.3)) js.type = pickOf(r, TYPES.slice(0, 5));
      break;
    case 2: {
      // untyped keyword groups
      for (const t of ["string", "number"]) if (chance(r, 0.5)) addGroup(r, js, t, depth, defs);
      break;
    }
    case 3:
      if (chance(r, 0.25)) {
        js.$ref = pickOf(r, EXT_REFS);
      } else if (defs > 0) {
        // Every def carries an $anchor (genDocument): pointer or anchor form
        const i = int(r, defs);
        js.$ref = chance(r, 0.5) ? "#/$defs/d" + i : "#a" + i;
        if (chance(r, 0.2)) js.description = "annotation";
        if (chance(r, 0.2)) addGroup(r, js, "string", depth, defs); // sibling assertions
      } else {
        js.type = "boolean";
      }
      break;
    case 4:
    case 5: {
      if (chance(r, 0.8)) js.type = "object";
      addGroup(r, js, "object", depth, defs);
      break;
    }
    case 6: {
      if (chance(r, 0.8)) js.type = "array";
      addGroup(r, js, "array", depth, defs);
      break;
    }
    case 7:
      js.anyOf = list(r, depth, defs);
      break;
    case 8:
      js.oneOf = chance(r, 0.3)
        ? [genJs(r, depth - 1, defs), { type: "null" }]
        : list(r, depth, defs);
      break;
    case 9:
      js.allOf = list(r, depth, defs);
      break;
    case 10:
      if (chance(r, 0.5)) {
        js.not = genJs(r, depth - 1, defs);
      } else {
        js.if = genJs(r, depth - 1, defs);
        if (chance(r, 0.8)) js.then = genJs(r, depth - 1, defs);
        if (chance(r, 0.6)) js.else = genJs(r, depth - 1, defs);
      }
      break;
    default: {
      const types = distinctTypes(r);
      js.type = types;
      for (const t of types) addGroup(r, js, t, depth, defs);
      break;
    }
  }
  return js;
}

function distinctTypes(r: Rng): string[] {
  const out: string[] = [];
  for (let i = 0, n = 1 + int(r, 3); i < n; i++) {
    const t = pickOf(r, TYPES);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function genDocument(r: Rng): Js {
  const ndefs = int(r, 4);
  const defs: Record<string, Js> = {};
  // d_i may reference only d_j with j < i — never cyclic
  for (let i = 0; i < ndefs; i++) {
    const def = genJs(r, 2, i);
    // Boolean schemas cannot carry an $anchor: spell them as objects
    const obj = typeof def !== "boolean" ? def : def ? {} : { not: {} };
    defs["d" + i] = { ...obj, $anchor: "a" + i };
  }
  const root = genJs(r, 3, ndefs);
  if (ndefs === 0 || typeof root === "boolean") return root;
  return { ...root, $defs: defs };
}

function genValue(r: Rng, depth: number): unknown {
  const x = int(r, depth <= 0 ? 4 : 7);
  if (x < 4) return primitiveValue(r);
  if (x === 4) return Array.from({ length: int(r, 4) }, () => genValue(r, depth - 1));
  const out: Record<string, unknown> = {};
  for (const k of keySubset(r, int(r, 4))) {
    out[k] = k === "type" && chance(r, 0.5) ? pickOf(r, STRINGS) : genValue(r, depth - 1);
  }
  return out;
}

interface Compiled {
  readonly doc: Js;
  readonly ours: ((v: unknown) => readonly [boolean, unknown]) | null;
  readonly theirs: AjvValidate;
  /** validate(s, { allErrors: true }) — null when lowering failed. */
  readonly oursAll: ((v: unknown) => readonly [boolean, unknown]) | null;
  /** No applicators in the input or union / allOf / not / conditional in the IR. */
  readonly plain: boolean;
}
const cache = new Map<number, Compiled>();
let supported = 0;
let comparedLocations = 0;

function compiled(schemaSeed: number): Compiled {
  let c = cache.get(schemaSeed);
  if (c !== undefined) return c;
  const doc = genDocument(rng(schemaSeed ^ 0x5bd1e995));
  const r = S.fromJsonSchema(doc, { refs: { [EXT_ID]: EXT } });
  // Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
  const ours = r[0]
    ? (validate(r[1] as S.StringSchema) as (v: unknown) => readonly [boolean, unknown])
    : null;
  const oursAll = r[0]
    ? (validate(r[1] as S.StringSchema, { allErrors: true }) as (
        v: unknown,
      ) => readonly [boolean, unknown])
    : null;
  if (ours !== null) supported++;
  // A throw here means the generator produced an invalid schema — a test bug
  const theirs = ajv.compile(doc);
  c = { doc, ours, theirs, oursAll, plain: r[0] && isPlain(r[1]) && !hasApplicator(doc) };
  cache.set(schemaSeed, c);
  return c;
}

const COMBINATORS = new Set(["union", "allOf", "not", "conditional"]);

function isPlain(s: S.Schema): boolean {
  if (COMBINATORS.has(s.kind)) return false;
  switch (s.kind) {
    case "object":
      return Object.values(s.meta.properties as Record<string, S.Schema>).every(isPlain);
    case "array":
      return isPlain(s.meta.items);
    case "tuple":
      // A wrong length is the tuple's type error (no descent); ajv still
      // checks each prefixItems slot, so locations are not comparable
      return false;
    case "record":
      return isPlain(s.meta.values);
    case "optional":
    case "nullable":
      return isPlain(s.meta.inner);
    default:
      return true;
  }
}

/**
 * ajv also reports the applicator's own error (`oneOf` at the parent), even
 * where lowering folds it away (`oneOf: [T, {type: null}]` → nullable(T)).
 */
function hasApplicator(js: unknown): boolean {
  if (typeof js !== "object" || js === null) return false;
  if (!Array.isArray(js) && ["anyOf", "oneOf", "allOf", "not", "if"].some((k) => k in js)) {
    return true;
  }
  return Object.values(js).some(hasApplicator);
}

/** ajv error → dot path of the offending value (required / additional key included). */
function ajvLocation(e: AjvError): string {
  let p = e.instancePath.slice(1).split("/").join(".");
  const key =
    e.keyword === "required"
      ? e.params.missingProperty
      : e.keyword === "additionalProperties"
        ? e.params.additionalProperty
        : undefined;
  if (typeof key === "string") p = p === "" ? key : p + "." + key;
  return p;
}

function sorted(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort();
}

test("format pool: ours and ajv-formats (full) agree on every pool string", () => {
  const full = new Ajv2020({ strict: false, logger: false });
  addFormats(full, { mode: "full" });
  for (const f of FORMATS) {
    const theirs = full.compile({ type: "string", format: f });
    const ours = formatTester(f);
    for (const str of STRINGS) {
      assert.equal(
        ours === undefined || ours.test(str),
        theirs(str),
        `${f} ${JSON.stringify(str)}`,
      );
    }
  }
});

test("fromJsonSchema + validate agree with ajv 2020-12 whenever lowering succeeds", () => {
  Prop.assert(
    Arb.tuple(Arb.integer(0, 0x7fffffff), Arb.string({ maxLength: 8 })),
    ([n, s]) => {
      const seed = hashSeed(n + ":" + s);
      const c = compiled(seed % SCHEMA_SEEDS);
      if (c.ours === null) return true;
      const r = rng(seed);
      for (let i = 0; i < VALUES_PER_RUN; i++) {
        const value = genValue(r, 3);
        const want = c.theirs(value);
        assert.equal(
          c.ours(value)[0],
          want,
          `schema=${JSON.stringify(c.doc)}\nvalue=${JSON.stringify(value)}\najv=${want}`,
        );
        // allErrors: same verdict; same failing locations when comparable
        const why = `schema=${JSON.stringify(c.doc)}\nvalue=${JSON.stringify(value)}`;
        const got = c.oursAll!(value);
        assert.equal(got[0], want, why + " (allErrors)");
        if (!want && c.plain) {
          const ours = sorted((got[1] as SchemaError[]).map((e) => e.path));
          const theirs = sorted((c.theirs.errors ?? []).map(ajvLocation));
          assert.deepEqual(ours, theirs, why + " (failing locations)");
          comparedLocations++;
        }
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
  // The generator must keep exercising the lowering, not just its Err paths
  assert.ok(supported > cache.size / 4, `only ${supported}/${cache.size} schemas lowered`);
  assert.ok(comparedLocations > NUM_RUNS / 100, `only ${comparedLocations} location comparisons`);
  console.log(
    `ajv diff: ${supported}/${cache.size} lowered, ${comparedLocations} location sets compared`,
  );
});
