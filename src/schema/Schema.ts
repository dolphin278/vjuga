/**
 * Schema — data-first type schema with TypeScript inference, JSON Schema
 * interop, and code-generation readiness.
 *
 * A Schema is a plain `{ kind, meta }` object that describes a type.
 * Unlike closure-based validators, schemas are introspectable data that can be
 * compiled to multiple targets: validators, JSON serializers/parsers, TOON
 * serializers/parsers, and Arbitrary generators.
 *
 * When to use: whenever you need runtime type information that feeds more than
 * one consumer (validation + serialization + type inference). For one-shot
 * validation of external input, the compiled validator from `schema/Validate`
 * is the right tool.
 *
 * Internal design:
 *   Every node is `{ kind: K, meta: M }` — two own properties. The `kind`
 *   discriminant is a string literal; `meta` carries kind-specific payload
 *   (constraints, child schemas, etc.). Nodes with no extra data use
 *   `meta: undefined`. All nodes share the same V8 hidden class shape
 *   (two named properties), keeping downstream switches monomorphic.
 *
 * Design tradeoffs:
 *   Data over closures. Closures are opaque to compilers; plain objects can be
 *   walked, serialized, and compiled to `new Function(...)` bodies. The cost is
 *   that schema construction is slightly more verbose than chained method calls,
 *   but construction is a one-time init cost — the hot path is the generated
 *   code.
 *
 * @example
 * ```ts
 * import * as S from "vjuga/schema/Schema";
 * const User = S.object({ id: S.integer(), name: S.string() });
 * type User = S.Infer<typeof User>;
 * const jsonSchema = S.toJsonSchema(User);
 * ```
 */

import { type Result, ok, err } from "../Result.js";
import { assertNever } from "./Codegen.js";

// ---------------------------------------------------------------------------
// Schema node base
// ---------------------------------------------------------------------------

/**
 * All schema nodes share this two-property shape for V8 hidden-class stability.
 * `kind` is the discriminant; `meta` carries kind-specific data.
 */
interface SchemaBase<K extends string, M> {
  readonly kind: K;
  readonly meta: M;
}

// ---------------------------------------------------------------------------
// Constraint types
// ---------------------------------------------------------------------------

export interface StringConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Regex source string (not a RegExp — must be serializable). */
  readonly pattern?: string;
  readonly format?: "email" | "uri" | "uuid" | "iso-datetime";
}

export interface NumberConstraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly multipleOf?: number;
}

export type IntegerConstraints = NumberConstraints;

// ---------------------------------------------------------------------------
// Schema node types
// ---------------------------------------------------------------------------

export type StringSchema = SchemaBase<"string", StringConstraints | undefined>;
export type NumberSchema = SchemaBase<"number", NumberConstraints | undefined>;
export type IntegerSchema = SchemaBase<"integer", IntegerConstraints | undefined>;
export type BooleanSchema = SchemaBase<"boolean", undefined>;
export type NullSchema = SchemaBase<"null", undefined>;
export type LiteralSchema<V extends string | number | boolean | null> = SchemaBase<
  "literal",
  { readonly value: V }
>;
export type EnumSchema<V extends readonly (string | number)[]> = SchemaBase<
  "enum",
  { readonly values: V }
>;

export interface ObjectMeta<P extends Record<string, Schema>> {
  readonly properties: P;
  readonly additionalProperties: boolean;
}
export type ObjectSchema<P extends Record<string, Schema>> = SchemaBase<"object", ObjectMeta<P>>;

export interface ArrayMeta<I extends Schema> {
  readonly items: I;
  readonly minItems: number | undefined;
  readonly maxItems: number | undefined;
}
export type ArraySchema<I extends Schema> = SchemaBase<"array", ArrayMeta<I>>;

export type TupleSchema<I extends readonly Schema[]> = SchemaBase<"tuple", { readonly items: I }>;
export type RecordSchema<V extends Schema> = SchemaBase<"record", { readonly values: V }>;
export type UnionSchema<V extends readonly Schema[]> = SchemaBase<
  "union",
  { readonly variants: V }
>;
export type OptionalSchema<I extends Schema> = SchemaBase<"optional", { readonly inner: I }>;
export type NullableSchema<I extends Schema> = SchemaBase<"nullable", { readonly inner: I }>;

/**
 * Discriminated union of all schema node types.
 *
 * Uses `any` for recursive type parameters to break the circular reference.
 * Concrete type parameters are inferred at builder call sites via `const`
 * type parameters — the `any` here only affects the union discriminant, not
 * the builder return types.
 */
// biome-ignore lint: any is required to break circular type alias
export type Schema =
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | NullSchema
  | LiteralSchema<any>
  | EnumSchema<any>
  | ObjectSchema<any>
  | ArraySchema<any>
  | TupleSchema<any>
  | RecordSchema<any>
  | UnionSchema<any>
  | OptionalSchema<any>
  | NullableSchema<any>;

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

/**
 * Extracts the TypeScript type described by a schema.
 *
 * Required-by-default: all object properties are required unless wrapped in
 * `optional()`. OptionalSchema keys become `?:` in the inferred object type.
 */
export type Infer<S extends Schema> = S extends StringSchema
  ? string
  : S extends NumberSchema
    ? number
    : S extends IntegerSchema
      ? number
      : S extends BooleanSchema
        ? boolean
        : S extends NullSchema
          ? null
          : S extends LiteralSchema<infer V>
            ? V
            : S extends EnumSchema<infer V>
              ? V[number]
              : S extends ObjectSchema<infer P>
                ? InferObject<P>
                : S extends ArraySchema<infer I>
                  ? Infer<I>[]
                  : S extends TupleSchema<infer I>
                    ? InferTuple<I>
                    : S extends RecordSchema<infer V>
                      ? Record<string, Infer<V>>
                      : S extends UnionSchema<infer V>
                        ? InferUnion<V>
                        : S extends OptionalSchema<infer I>
                          ? Infer<I> | undefined
                          : S extends NullableSchema<infer I>
                            ? Infer<I> | null
                            : never;

/** Required keys + optional keys merged via intersection. */
type InferObject<P extends Record<string, Schema>> = Simplify<
  { [K in RequiredKeys<P>]: Infer<P[K]> } & { [K in OptionalKeys<P>]?: InferOptionalValue<P[K]> }
>;

type RequiredKeys<P extends Record<string, Schema>> = {
  [K in keyof P]: P[K] extends OptionalSchema<Schema> ? never : K;
}[keyof P];

type OptionalKeys<P extends Record<string, Schema>> = {
  [K in keyof P]: P[K] extends OptionalSchema<Schema> ? K : never;
}[keyof P];

/** Unwrap OptionalSchema to get the inner type (without the `| undefined` that Infer adds). */
type InferOptionalValue<S extends Schema> = S extends OptionalSchema<infer I> ? Infer<I> : Infer<S>;

type InferTuple<I extends readonly Schema[]> = {
  [K in keyof I]: I[K] extends Schema ? Infer<I[K]> : never;
};

type InferUnion<V extends readonly Schema[]> = V[number] extends Schema ? Infer<V[number]> : never;

/**
 * Collapses `{ a: X } & { b?: Y }` into `{ a: X; b?: Y }` for readable
 * IDE hover tooltips. Identity at runtime.
 */
type Simplify<T> = { [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Builder DSL
// ---------------------------------------------------------------------------

/** Validates strings. Pass constraints for minLength/maxLength/pattern/format. */
export function string(constraints?: StringConstraints): StringSchema {
  return { kind: "string", meta: constraints };
}

/** Validates numbers (rejects NaN). Pass constraints for min/max/multipleOf. */
export function number(constraints?: NumberConstraints): NumberSchema {
  return { kind: "number", meta: constraints };
}

/** Validates safe integers. Pass constraints for min/max/multipleOf. */
export function integer(constraints?: IntegerConstraints): IntegerSchema {
  return { kind: "integer", meta: constraints };
}

/** Validates booleans. */
export function boolean(): BooleanSchema {
  return { kind: "boolean", meta: undefined };
}

/** Validates null. */
export function null_(): NullSchema {
  return { kind: "null", meta: undefined };
}

/** Validates exact literal equality (string, number, boolean, or null). */
export function literal<const V extends string | number | boolean | null>(
  value: V,
): LiteralSchema<V> {
  return { kind: "literal", meta: { value } };
}

/** Validates that value is one of the given string/number enum members. */
export function enum_<const V extends readonly (string | number)[]>(...values: V): EnumSchema<V> {
  return { kind: "enum", meta: { values } };
}

/**
 * Validates non-null objects. All properties are required by default — wrap
 * individual properties with `optional()` to make them optional.
 * Extra keys are rejected by default (`additionalProperties: false`).
 */
export function object<const P extends Record<string, Schema>>(
  properties: P,
  opts?: { additionalProperties?: boolean },
): ObjectSchema<P> {
  return {
    kind: "object",
    meta: { properties, additionalProperties: opts?.additionalProperties ?? false },
  };
}

/** Validates arrays where every element matches `items`. */
export function array<I extends Schema>(
  items: I,
  opts?: { minItems?: number; maxItems?: number },
): ArraySchema<I> {
  return {
    kind: "array",
    meta: { items, minItems: opts?.minItems, maxItems: opts?.maxItems },
  };
}

/** Validates fixed-length tuples. Each position has its own schema. */
export function tuple<const I extends readonly Schema[]>(...items: I): TupleSchema<I> {
  return { kind: "tuple", meta: { items } };
}

/** Validates objects with string keys and uniform value type. */
export function record<V extends Schema>(values: V): RecordSchema<V> {
  return { kind: "record", meta: { values } };
}

/** Validates that value matches at least one of the given schemas. */
export function union<const V extends readonly Schema[]>(...variants: V): UnionSchema<V> {
  return { kind: "union", meta: { variants } };
}

/** Makes a schema accept `undefined` in addition to its normal type. */
export function optional<I extends Schema>(inner: I): OptionalSchema<I> {
  return { kind: "optional", meta: { inner } };
}

/** Makes a schema accept `null` in addition to its normal type. */
export function nullable<I extends Schema>(inner: I): NullableSchema<I> {
  return { kind: "nullable", meta: { inner } };
}

// ---------------------------------------------------------------------------
// JSON Schema conversion
// ---------------------------------------------------------------------------

/** Minimal JSON Schema object type for interop. */
export interface JsonSchemaObject {
  readonly [key: string]: unknown;
}

/**
 * Converts a Schema to a JSON Schema (2020-12) object.
 *
 * OptionalSchema is expressed via the parent object's `required` array — the
 * inner schema is emitted directly.
 */
export function toJsonSchema(schema: Schema): JsonSchemaObject {
  switch (schema.kind) {
    case "string": {
      const out: Record<string, unknown> = { type: "string" };
      if (schema.meta !== undefined) {
        if (schema.meta.minLength !== undefined) out.minLength = schema.meta.minLength;
        if (schema.meta.maxLength !== undefined) out.maxLength = schema.meta.maxLength;
        if (schema.meta.pattern !== undefined) out.pattern = schema.meta.pattern;
        if (schema.meta.format !== undefined) out.format = schema.meta.format;
      }
      return out;
    }
    case "number":
      return numberSchemaToJson("number", schema.meta);
    case "integer":
      return numberSchemaToJson("integer", schema.meta);
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "literal":
      return { const: schema.meta.value };
    case "enum":
      return { enum: schema.meta.values };
    case "object": {
      const properties: Record<string, JsonSchemaObject> = {};
      const required: string[] = [];
      const keys = Object.keys(schema.meta.properties);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const child = schema.meta.properties[key];
        if (child.kind === "optional") {
          // Unwrap optional — omit from required
          properties[key] = toJsonSchema(child.meta.inner);
        } else {
          properties[key] = toJsonSchema(child);
          required.push(key);
        }
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) out.required = required;
      out.additionalProperties = schema.meta.additionalProperties;
      return out;
    }
    case "array": {
      const out: Record<string, unknown> = {
        type: "array",
        items: toJsonSchema(schema.meta.items),
      };
      if (schema.meta.minItems !== undefined) out.minItems = schema.meta.minItems;
      if (schema.meta.maxItems !== undefined) out.maxItems = schema.meta.maxItems;
      return out;
    }
    case "tuple":
      return {
        type: "array",
        prefixItems: schema.meta.items.map(toJsonSchema),
        items: false,
      };
    case "record":
      return { type: "object", additionalProperties: toJsonSchema(schema.meta.values) };
    case "union":
      return { anyOf: schema.meta.variants.map(toJsonSchema) };
    case "optional":
      // At top level, optional just means the inner type or undefined.
      // JSON Schema doesn't have a direct "optional" concept outside objects.
      return toJsonSchema(schema.meta.inner);
    case "nullable":
      return { anyOf: [toJsonSchema(schema.meta.inner), { type: "null" }] };
    default: {
      assertNever(schema);
    }
  }
}

function numberSchemaToJson(
  type: "number" | "integer",
  meta: NumberConstraints | undefined,
): JsonSchemaObject {
  const out: Record<string, unknown> = { type };
  if (meta !== undefined) {
    if (meta.minimum !== undefined) out.minimum = meta.minimum;
    if (meta.maximum !== undefined) out.maximum = meta.maximum;
    if (meta.exclusiveMinimum !== undefined) out.exclusiveMinimum = meta.exclusiveMinimum;
    if (meta.exclusiveMaximum !== undefined) out.exclusiveMaximum = meta.exclusiveMaximum;
    if (meta.multipleOf !== undefined) out.multipleOf = meta.multipleOf;
  }
  return out;
}

// ---------------------------------------------------------------------------
// fromJsonSchema
// ---------------------------------------------------------------------------

/**
 * Converts a JSON Schema (2020-12) object to a Schema.
 *
 * Returns `Err` for unsupported features (`$ref`, `allOf`, `if/then/else`,
 * `dependencies`, `patternProperties`, etc.).
 */
export function fromJsonSchema(js: JsonSchemaObject): Result<Schema, string> {
  // const
  if ("const" in js) {
    const v = js.const;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return ok(literal(v as string | number | boolean | null));
    }
    return err("unsupported const type: " + typeof v);
  }

  // enum
  if ("enum" in js && Array.isArray(js.enum)) {
    const values = js.enum as (string | number)[];
    for (let i = 0; i < values.length; i++) {
      const t = typeof values[i];
      if (t !== "string" && t !== "number") {
        return err("enum values must be string or number, got " + t);
      }
    }
    return ok(enum_(...values));
  }

  // anyOf → union or nullable
  if ("anyOf" in js && Array.isArray(js.anyOf)) {
    const variants = js.anyOf as JsonSchemaObject[];
    // Detect nullable pattern: { anyOf: [inner, { type: "null" }] }
    if (
      variants.length === 2 &&
      typeof variants[1] === "object" &&
      variants[1] !== null &&
      (variants[1] as Record<string, unknown>).type === "null"
    ) {
      const innerResult = fromJsonSchema(variants[0]);
      if (!innerResult[0]) return innerResult;
      return ok(nullable(innerResult[1]));
    }
    const schemas: Schema[] = [];
    for (let i = 0; i < variants.length; i++) {
      const r = fromJsonSchema(variants[i]);
      if (!r[0]) return r;
      schemas.push(r[1]);
    }
    return ok(union(...schemas));
  }

  // Unsupported combinators
  if ("$ref" in js) return err("$ref is not supported");
  if ("allOf" in js) return err("allOf is not supported");
  if ("oneOf" in js) return err("oneOf is not supported — use anyOf");
  if ("not" in js) return err("not is not supported");
  if ("if" in js) return err("if/then/else is not supported");

  const type = js.type;

  if (type === "string") {
    const c: Record<string, unknown> = {};
    let hasConstraints = false;
    if ("minLength" in js) {
      c.minLength = js.minLength as number;
      hasConstraints = true;
    }
    if ("maxLength" in js) {
      c.maxLength = js.maxLength as number;
      hasConstraints = true;
    }
    if ("pattern" in js) {
      c.pattern = js.pattern as string;
      hasConstraints = true;
    }
    if ("format" in js) {
      c.format = js.format as string;
      hasConstraints = true;
    }
    return ok(string(hasConstraints ? (c as StringConstraints) : undefined));
  }

  if (type === "number" || type === "integer") {
    const c = extractNumberConstraints(js);
    const s = type === "integer" ? integer(c) : number(c);
    return ok(s);
  }

  if (type === "boolean") return ok(boolean());
  if (type === "null") return ok(null_());

  if (type === "object") {
    // Record pattern: additionalProperties is a schema object
    if (
      !("properties" in js) &&
      "additionalProperties" in js &&
      typeof js.additionalProperties === "object" &&
      js.additionalProperties !== null
    ) {
      const vr = fromJsonSchema(js.additionalProperties as JsonSchemaObject);
      if (!vr[0]) return vr;
      return ok(record(vr[1]));
    }

    // Object with properties
    const props = (js.properties ?? {}) as Record<string, JsonSchemaObject>;
    const requiredSet = new Set(Array.isArray(js.required) ? (js.required as string[]) : []);
    const result: Record<string, Schema> = {};
    const keys = Object.keys(props);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const r = fromJsonSchema(props[key]);
      if (!r[0]) return r;
      result[key] = requiredSet.has(key) ? r[1] : optional(r[1]);
    }
    return ok(
      object(result, {
        additionalProperties:
          js.additionalProperties === true || js.additionalProperties === undefined,
      }),
    );
  }

  if (type === "array") {
    // Tuple pattern: prefixItems + items: false
    if ("prefixItems" in js && Array.isArray(js.prefixItems)) {
      const schemas: Schema[] = [];
      const items = js.prefixItems as JsonSchemaObject[];
      for (let i = 0; i < items.length; i++) {
        const r = fromJsonSchema(items[i]);
        if (!r[0]) return r;
        schemas.push(r[1]);
      }
      return ok(tuple(...schemas));
    }

    // Array with items
    if ("items" in js && typeof js.items === "object" && js.items !== null) {
      const r = fromJsonSchema(js.items as JsonSchemaObject);
      if (!r[0]) return r;
      const opts: { minItems?: number; maxItems?: number } = {};
      if ("minItems" in js) opts.minItems = js.minItems as number;
      if ("maxItems" in js) opts.maxItems = js.maxItems as number;
      return ok(array(r[1], Object.keys(opts).length > 0 ? opts : undefined));
    }

    // Array with no items schema → array(unknown) — not representable, error
    return err("array schema without items is not supported");
  }

  return err("unsupported JSON Schema: " + JSON.stringify(js).slice(0, 100));
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/** True if the schema describes a leaf value (no nesting). */
export function isPrimitive(schema: Schema): boolean {
  switch (schema.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
    case "literal":
    case "enum":
      return true;
    case "optional":
    case "nullable":
      return isPrimitive(schema.meta.inner);
    default:
      return false;
  }
}

/**
 * Detect a common discriminant key among union variants.
 *
 * Returns the key name if ALL variants are object schemas sharing a property
 * whose schema is a literal with distinct values. Returns null otherwise.
 */
export function findDiscriminant(variants: readonly Schema[]): string | null {
  if (variants.length < 2) return null;
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].kind !== "object") return null;
  }
  const first = variants[0] as Schema & { kind: "object" };
  const keys = Object.keys(first.meta.properties);
  outer: for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const seen = new Set<string | number | boolean | null>();
    for (let i = 0; i < variants.length; i++) {
      const obj = variants[i] as Schema & { kind: "object" };
      const prop = obj.meta.properties[key] as Schema | undefined;
      if (prop === undefined || prop.kind !== "literal") continue outer;
      const val = prop.meta.value;
      if (seen.has(val)) continue outer;
      seen.add(val);
    }
    return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractNumberConstraints(js: JsonSchemaObject): NumberConstraints | undefined {
  const c: Record<string, unknown> = {};
  let has = false;
  if ("minimum" in js) {
    c.minimum = js.minimum as number;
    has = true;
  }
  if ("maximum" in js) {
    c.maximum = js.maximum as number;
    has = true;
  }
  if ("exclusiveMinimum" in js) {
    c.exclusiveMinimum = js.exclusiveMinimum as number;
    has = true;
  }
  if ("exclusiveMaximum" in js) {
    c.exclusiveMaximum = js.exclusiveMaximum as number;
    has = true;
  }
  if ("multipleOf" in js) {
    c.multipleOf = js.multipleOf as number;
    has = true;
  }
  return has ? (c as NumberConstraints) : undefined;
}
