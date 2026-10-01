/**
 * Differential fuzz: fromJsonSchema + validate vs ajv (draft 2020-12).
 *
 * Random non-recursive JSON Schemas inside the lowered subset (typed and
 * untyped keywords, const/enum, anyOf/oneOf/allOf/not/if-then-else, boolean
 * schemas, type arrays, $ref into $defs with sibling keywords) and random
 * JSON values. Whenever fromJsonSchema returns Ok, validate's verdict must
 * equal ajv's. Values stay inside the documented divergences: ASCII strings
 * (UTF-16 length = code points), safe integers, `u`-neutral patterns.
 */
/* eslint-disable unicorn/no-thenable -- JSON Schema `then` keyword is data */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as S from "../../../schema/Schema.js";
import { validate } from "../../../schema/Validate.js";
import * as Arb from "../../../Arbitrary.js";
import * as Prop from "../../../Property.js";
import { rng, hashSeed, type Rng } from "./_serial-gen.js";

const NUM_RUNS = 1_000_000;
const SCHEMA_SEEDS = 4096;
const VALUES_PER_RUN = 6;

interface AjvLike {
  compile(schema: unknown): (data: unknown) => boolean;
}
const require = createRequire(import.meta.url);
const Ajv2020 = (require("ajv/dist/2020") as { default: new (o: object) => AjvLike }).default;
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });

type Js = Record<string, unknown> | boolean;

const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pickOf = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
const chance = (r: Rng, p: number): boolean => r() < p;

// No Object.prototype names: ajv reads `data.constructor` through the prototype
// chain, so it rejects {} against `properties: { constructor: ... }`.
const KEYS = ["a", "b", "c", "type"];
const STRINGS = ["", "a", "b", "ab", "abc", "ba", "a1", "12", "zzzz", "type"];
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
      if (defs > 0) {
        js.$ref = "#/$defs/d" + int(r, defs);
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
  for (let i = 0; i < ndefs; i++) defs["d" + i] = genJs(r, 2, i);
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
  readonly theirs: (v: unknown) => boolean;
}
const cache = new Map<number, Compiled>();
let supported = 0;

function compiled(schemaSeed: number): Compiled {
  let c = cache.get(schemaSeed);
  if (c !== undefined) return c;
  const doc = genDocument(rng(schemaSeed ^ 0x5bd1e995));
  const r = S.fromJsonSchema(doc);
  // Cast: Infer<> over the base `Schema` union is "excessively deep" for tsc
  const ours = r[0]
    ? (validate(r[1] as S.StringSchema) as (v: unknown) => readonly [boolean, unknown])
    : null;
  if (ours !== null) supported++;
  // A throw here means the generator produced an invalid schema — a test bug
  const theirs = ajv.compile(doc);
  c = { doc, ours, theirs };
  cache.set(schemaSeed, c);
  return c;
}

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
      }
      return true;
    },
    { numRuns: NUM_RUNS },
  );
  // The generator must keep exercising the lowering, not just its Err paths
  assert.ok(supported > cache.size / 4, `only ${supported}/${cache.size} schemas lowered`);
});
