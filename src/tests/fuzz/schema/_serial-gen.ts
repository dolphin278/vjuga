/**
 * Random schema + schema-valid value generator shared by the schema/JSON and
 * schema/TOON round-trip fuzz properties.
 *
 * Generation is driven by a local seeded PRNG so a failing case is fully
 * described by its seed (printed in assertion messages). The PBT layer only
 * supplies seeds.
 */
import * as S from "../../../schema/Schema.js";

export type Rng = () => number;

/** mulberry32 — tiny deterministic PRNG. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string — turns PBT-drawn strings/ints into well-mixed seeds. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pickOf = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];

/** Strings chosen to break quoting, splitting, indentation and key parsing. */
const HOSTILE = [
  "",
  " ",
  "a",
  "Alice",
  "a b",
  " lead",
  "trail ",
  "a,b",
  "x|y",
  "tab\there",
  "new\nline",
  "cr\rlf",
  'q"uote',
  "back\\slash",
  "a:b",
  "a: b",
  "[1]",
  "a[0]",
  "{x}",
  "-",
  "- x",
  "-5",
  "05",
  "1e5",
  "0x10",
  "Infinity",
  ".5",
  "+1",
  "123",
  "true",
  "false",
  "null",
  "#c",
  "é",
  " nbsp",
  "bom﻿",
  "ls ps ",
  "\u0000ctl\u0007",
  "\ud800",
  "日本語",
  "constructor",
  "toString",
];

const KEYS_SAFE = ["id", "name", "a", "b", "c", "type", "x_y", "a.b", "k1", "é"];
const KEYS_HOSTILE = [
  "",
  " ",
  "a b",
  "a:b",
  "a[0]",
  "{x}",
  '"q',
  "back\\slash",
  "new\nline",
  "tab\t",
  "-",
  "- x",
  "#",
  "1",
  "true",
  "null",
  ",",
  "|",
  "a,b",
  " k",
  "k ",
];
/** Names that collide with Object.prototype members (G8-4 territory). */
const KEYS_PROTO = ["constructor", "toString", "hasOwnProperty", "valueOf"];

const NUMBERS = [
  0,
  1,
  -1,
  1.5,
  -2.25,
  0.1,
  1e21,
  1e-7,
  1e100,
  -1e30,
  1e-21,
  5e-324,
  Number.MAX_VALUE,
  123456789.125,
  9007199254740991,
];

export interface GenConfig {
  /** TOON-specific shapes: optional primitives in items, deliberately unsupported shapes. */
  readonly toon: boolean;
  /** Allow prototype-colliding names as object schema keys. */
  readonly protoKeys: boolean;
}

/** JSON-oriented config: no TOON-only shapes, prototype-colliding keys allowed. */
export const DEFAULT_CFG: GenConfig = { toon: false, protoKeys: true };

export interface Generated {
  readonly schema: S.Schema;
  /** True if the schema intentionally contains a shape TOON rejects. */
  readonly unsupported: boolean;
}

/** `inner`: directly under nullable in a field — optional allowed on primitives only. */
type Pos = "root" | "field" | "item" | "inner";

export function genString(r: Rng): string {
  if (r() < 0.6) return pickOf(r, HOSTILE);
  let s = "";
  const n = int(r, 6);
  for (let i = 0; i < n; i++)
    s += pickOf(r, HOSTILE).slice(0, 2) + String.fromCharCode(32 + int(r, 95));
  return s;
}

function genNumber(r: Rng, integer: boolean): number {
  if (integer) {
    const v = pickOf(r, [0, 1, -1, 42, -7, 1e15, 2 ** 31, -(2 ** 40), 9007199254740991]);
    return r() < 0.5 ? v : int(r, 2000) - 1000;
  }
  const v = r() < 0.6 ? pickOf(r, NUMBERS) : (r() - 0.5) * 10 ** int(r, 30);
  return v === 0 ? 0 : v; // never -0
}

function genKey(r: Rng, cfg: GenConfig): string {
  const x = r();
  if (cfg.protoKeys && x < 0.1) return pickOf(r, KEYS_PROTO);
  return x < 0.55 ? pickOf(r, KEYS_SAFE) : pickOf(r, KEYS_HOSTILE);
}

function genKeys(r: Rng, cfg: GenConfig, n: number, avoid: readonly string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const k = genKey(r, cfg);
    if (!out.includes(k) && !avoid.includes(k)) out.push(k);
  }
  return out;
}

function genLiteralValue(r: Rng): string | number | boolean | null {
  const x = int(r, 4);
  return x === 0 ? genString(r) : x === 1 ? genNumber(r, false) : x === 2 ? r() < 0.5 : null;
}

function genPrimitive(r: Rng): S.Schema {
  switch (int(r, 8)) {
    case 0:
    case 1:
      return S.string();
    case 2:
      return S.number();
    case 3:
      return S.integer();
    case 4:
      return S.boolean();
    case 5:
      return S.null_();
    case 6:
      return S.literal(genLiteralValue(r));
    default: {
      const vals = new Set<string | number>();
      const n = 1 + int(r, 4);
      for (let i = 0; i < n; i++) vals.add(r() < 0.5 ? genString(r) : genNumber(r, false));
      return S.enum_(...Array.from(vals));
    }
  }
}

/** Generate a schema. Tracks whether a deliberately unsupported (TOON) shape was produced. */
export function genSchema(r: Rng, cfg: GenConfig, depth = 0, pos: Pos = "root"): Generated {
  let unsupported = false;
  const child = (p: Pos): S.Schema => {
    const g = genSchema(r, cfg, depth + 1, p);
    unsupported ||= g.unsupported;
    return g.schema;
  };
  const leaf = depth >= 3 || r() < 0.3;
  let schema: S.Schema;
  const x = leaf ? 0 : int(r, 8);
  switch (x) {
    case 0:
      schema = genPrimitive(r);
      break;
    case 1: {
      const props: Record<string, S.Schema> = {};
      for (const k of genKeys(r, cfg, int(r, 5))) props[k] = child("field");
      schema = S.object(props);
      break;
    }
    case 2:
      schema = S.array(child("item"));
      break;
    case 3: {
      const items: S.Schema[] = [];
      const n = int(r, 4);
      for (let i = 0; i < n; i++) items.push(child("item"));
      schema = S.tuple(...items);
      break;
    }
    case 4:
      schema = S.record(child("item"));
      break;
    case 5:
      schema = genUnion(r, cfg, depth, () => (unsupported = true), child);
      break;
    case 6:
      // In a field the wrapped child may itself be optional (key may be absent)
      schema = genCombinator(r, () =>
        child(pos === "field" ? (r() < 0.5 ? "field" : "inner") : pos),
      );
      // TOON has no layout for unknown / allOf / not / conditional
      if (cfg.toon && schema.kind !== "union") unsupported = true;
      break;
    default:
      // nullable(optional(T)) as a field would mean "present but undefined"
      schema = S.nullable(child(pos === "field" ? "inner" : pos));
      break;
  }
  // Optional wrapper: object fields always may; primitives may anywhere in
  // TOON; optional compounds outside fields are an intentional TOON reject.
  if (pos === "field" ? r() < 0.35 : cfg.toon && r() < 0.15) {
    const prim = isPrimitiveSchema(schema);
    if (pos === "field" || prim) schema = S.optional(schema);
    else if (pos !== "inner" && r() < 0.3) {
      schema = S.optional(schema);
      unsupported = true;
    }
  }
  return { schema, unsupported };
}

/**
 * Wrap `inner()` in a new-kind combinator that accepts exactly the values
 * `genValue` produces for it (genValue reads the first allOf variant and the
 * conditional's else branch).
 */
function genCombinator(r: Rng, inner: () => S.Schema): S.Schema {
  switch (int(r, 5)) {
    case 0:
      return S.unknown();
    // The extra variants accept undefined so an optional inner stays optional
    case 1:
      return S.allOf(inner(), S.optional(S.unknown()));
    case 2:
      return S.allOf(inner(), S.optional(S.not(S.literal("\u0000never"))));
    case 3:
      return S.conditional(S.string(), S.string(), inner());
    default: {
      // A single variant is trivially exactly-one. union(optional(T)) is not
      // treated as an absent-able field by serializers — unwrap it.
      const x = inner();
      return S.oneOf(x.kind === "optional" ? x.meta.inner : x);
    }
  }
}

function genUnion(
  r: Rng,
  cfg: GenConfig,
  depth: number,
  markUnsupported: () => void,
  child: (p: Pos) => S.Schema,
): S.Schema {
  const kind = int(r, cfg.toon ? 4 : 3);
  if (kind === 0) {
    // union of primitives
    const vs: S.Schema[] = [];
    const n = 1 + int(r, 3);
    for (let i = 0; i < n; i++) vs.push(genPrimitive(r));
    return S.union(...vs);
  }
  if (kind === 1) {
    // discriminated object union
    const disc = r() < 0.6 ? "type" : genKey(r, cfg);
    const seen = new Set<unknown>();
    const vs: S.Schema[] = [];
    const n = 2 + int(r, 2);
    for (let i = 0; i < n; i++) {
      let lit = genLiteralValue(r);
      while (seen.has(lit)) lit = genLiteralValue(r);
      seen.add(lit);
      const props: Record<string, S.Schema> = { [disc]: S.literal(lit) };
      for (const k of genKeys(r, cfg, int(r, 3), [disc])) props[k] = child("field");
      vs.push(S.object(props));
    }
    // Distinct tags make a discriminated oneOf exactly-one by construction
    return r() < 0.3 ? S.oneOf(...vs) : S.union(...vs);
  }
  if (kind === 2) {
    // Non-discriminated objects with disjoint required keys, plus maybe one
    // primitive and one array — unambiguous for JSON, unsupported in TOON.
    const used: string[] = [];
    const vs: S.Schema[] = [];
    for (let i = 0; i < 2; i++) {
      const keys = genKeys(r, cfg, 1 + int(r, 2), used);
      used.push(...keys);
      const props: Record<string, S.Schema> = {};
      for (const k of keys) props[k] = child("item");
      vs.push(S.object(props));
    }
    if (r() < 0.5) vs.push(genPrimitive(r));
    if (r() < 0.5) vs.push(S.array(child("item")));
    if (cfg.toon) markUnsupported();
    return S.union(...vs);
  }
  // TOON only: compound + primitive mix → unsupported (union(T, null) ≡ nullable(T))
  const prim = genPrimitive(r);
  if (prim.kind !== "null") markUnsupported();
  return S.union(S.array(child("item")), prim);
}

function isPrimitiveSchema(s: S.Schema): boolean {
  while (s.kind === "optional" || s.kind === "nullable") s = s.meta.inner;
  if (s.kind === "union") return (s.meta.variants as S.Schema[]).every(isPrimitiveSchema);
  return S.isPrimitive(s);
}

/** Generate a value valid for `schema`. */
export function genValue(r: Rng, schema: S.Schema): unknown {
  switch (schema.kind) {
    case "string":
      return genString(r);
    case "number":
      return genNumber(r, false);
    case "integer":
      return genNumber(r, true);
    case "boolean":
      return r() < 0.5;
    case "null":
      return null;
    case "literal":
      return schema.meta.value;
    case "enum":
      return pickOf(r, schema.meta.values as (string | number)[]);
    case "object": {
      const out: Record<string, unknown> = {};
      const props = schema.meta.properties as Record<string, S.Schema>;
      for (const k of Object.keys(props)) {
        const p = props[k];
        if (p.kind === "optional" && r() < 0.4) continue; // absent
        out[k] = genValue(r, p.kind === "optional" ? p.meta.inner : p);
      }
      return out;
    }
    case "array": {
      const n = int(r, 4);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(genValue(r, schema.meta.items));
      return out;
    }
    case "tuple":
      return (schema.meta.items as S.Schema[]).map((s) => genValue(r, s));
    case "record": {
      const out: Record<string, unknown> = {};
      for (const k of genKeys(r, { toon: true, protoKeys: true }, int(r, 4))) {
        out[k] = genValue(r, schema.meta.values);
      }
      return out;
    }
    case "union":
      return genValue(r, pickOf(r, schema.meta.variants as S.Schema[]));
    case "optional":
      return r() < 0.3 ? undefined : genValue(r, schema.meta.inner);
    case "nullable":
      return r() < 0.3 ? null : genValue(r, schema.meta.inner);
    case "unknown":
      return r() < 0.5 ? genLiteralValue(r) : [genLiteralValue(r), { k: genLiteralValue(r) }];
    case "allOf":
      return genValue(r, schema.meta.variants[0]);
    case "conditional":
      return genValue(r, schema.meta.else);
    case "not":
      return genLiteralValue(r); // only generated inside allOf, never reached
  }
}

/** Deep copy without `undefined`-valued object properties (absent ≡ undefined). */
export function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = normalize(x);
  }
  return out;
}

/** Short printable description of a failing case. */
export function describeCase(seed: number, schema: S.Schema, value: unknown, out: unknown): string {
  return `seed=${seed}\nschema=${JSON.stringify(schema)}\nvalue=${JSON.stringify(value)}\nout=${JSON.stringify(out)}`;
}
