/**
 * Schema — data-first type schema with TypeScript inference, JSON Schema
 * interop, and code-generation readiness.
 *
 * A Schema is a plain `{ kind, meta }` object describing a type. Unlike
 * closure-based validators, schemas are introspectable data compiled to many
 * targets: validators, JSON / TOON serializers and parsers. 18 kinds: string,
 * number, integer, boolean, null, literal, enum, object, array, tuple, record,
 * union (`oneOf()` = exclusive union), optional, nullable, unknown, allOf,
 * not, conditional. Recursive (cyclic) schemas — and recursive `$ref` in
 * `fromJsonSchema` — are not supported.
 *
 * When to use: runtime type information that feeds more than one consumer
 * (validation + serialization + type inference). For one-shot validation of
 * external input, use `schema/Validate` directly.
 *
 * Internal design:
 *   Every node is `{ kind: K, meta: M }` — two own properties, same V8
 *   hidden class shape across all kinds, keeping downstream switches
 *   monomorphic. `meta` carries kind-specific payload (constraints, child
 *   schemas). Nodes with no extra data use `meta: undefined`.
 *
 * Design tradeoffs: data over closures — plain objects can be walked,
 * serialized, and compiled to `new Function(...)` bodies. Schemas are
 * immutable by convention; build a new one instead of mutating `meta`.
 *
 * @example Define a schema, infer its type, convert to JSON Schema
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * const User = S.object({
 *   id: S.integer({ minimum: 0 }),
 *   email: S.string({ format: "email", maxLength: 255 }),
 *   bio: S.optional(S.string()),    // key may be absent
 *   avatar: S.nullable(S.string()), // key present, value may be null
 * });
 * type User = S.Infer<typeof User>; // infer from a constant, never from `Schema`
 * const json = S.toJsonSchema(User); // { type: "object", ... }
 * const back = S.fromJsonSchema(json); // Result<Schema, string>; $ref, oneOf, allOf, ...
 * ```
 */

import { type Result, ok, err } from "../Result.js";
import { unreachable } from "../FunctionUtils.js";
import { type FormatName, isKnownFormat } from "./Formats.js";

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
  /**
   * Enforced format (see `schema/Formats`): RFC 3339 `date-time` / `date` /
   * `time`, `email`, `uri`, `uuid`, `ipv4`, `ipv6`, and the legacy loose
   * `iso-datetime` prefix check. `fromJsonSchema` may also store other names
   * here; those are annotation-only.
   */
  readonly format?: FormatName;
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
export interface UnionMeta<V extends readonly Schema[]> {
  readonly variants: V;
  /** Set by `oneOf()`: exactly one variant must match. Absent for `union()`. */
  readonly exclusive?: true;
}
export type UnionSchema<V extends readonly Schema[]> = SchemaBase<"union", UnionMeta<V>>;
export type OptionalSchema<I extends Schema> = SchemaBase<"optional", { readonly inner: I }>;
export type NullableSchema<I extends Schema> = SchemaBase<"nullable", { readonly inner: I }>;
export type UnknownSchema = SchemaBase<"unknown", undefined>;
export type AllOfSchema<V extends readonly Schema[]> = SchemaBase<
  "allOf",
  { readonly variants: V }
>;
export type NotSchema<I extends Schema> = SchemaBase<"not", { readonly inner: I }>;
export interface ConditionalMeta<I extends Schema, T extends Schema, E extends Schema> {
  readonly if: I;
  readonly then: T;
  readonly else: E;
}
export type ConditionalSchema<I extends Schema, T extends Schema, E extends Schema> = SchemaBase<
  "conditional",
  ConditionalMeta<I, T, E>
>;

/**
 * Discriminated union of all schema node types.
 *
 * Uses `any` for recursive type parameters to break the circular reference.
 * Concrete type parameters are inferred at builder call sites via `const`
 * type parameters — the `any` here only affects the union discriminant, not
 * the builder return types.
 */
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
  | NullableSchema<any>
  | UnknownSchema
  | AllOfSchema<any>
  | NotSchema<any>
  | ConditionalSchema<any, any, any>;

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

/**
 * Extracts the TypeScript type described by a schema.
 *
 * Required-by-default: all object properties are required unless wrapped in
 * `optional()`. OptionalSchema keys become `?:` in the inferred object type.
 *
 * Pitfall: `Infer<Schema>` (the base union type) causes "excessively deep"
 * errors. Always infer from a specific schema constant.
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
                            : S extends UnknownSchema
                              ? unknown
                              : S extends AllOfSchema<infer V>
                                ? InferAllOf<V>
                                : S extends NotSchema<Schema>
                                  ? unknown
                                  : S extends ConditionalSchema<Schema, infer T, infer E>
                                    ? Infer<T> | Infer<E>
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

/** Intersection of every variant's type; `unknown` for an empty list. */
type InferAllOf<V extends readonly Schema[]> = V extends readonly [
  infer H extends Schema,
  ...infer R extends readonly Schema[],
]
  ? Infer<H> & InferAllOf<R>
  : unknown;

/**
 * Collapses `{ a: X } & { b?: Y }` into `{ a: X; b?: Y }` for readable
 * IDE hover tooltips. Identity at runtime.
 */
type Simplify<T> = { [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Builder DSL
// ---------------------------------------------------------------------------

/**
 * Validates strings. Pass constraints for minLength/maxLength/pattern/format.
 * `pattern` is a regex source string (compiled with `new RegExp`, no flags).
 * `format` takes the names `schema/Formats` enforces (`"date"`, `"date-time"`,
 * `"email"`, ...) and is type-checked against them.
 */
export function string(constraints?: StringConstraints): StringSchema {
  return { kind: "string", meta: constraints };
}

/**
 * Validates finite numbers — rejects NaN, `Infinity`, and `-Infinity` (none is
 * representable in JSON). Pass constraints for min/max/multipleOf; a
 * non-integer `multipleOf` is checked with a small relative tolerance.
 */
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
 * Validates non-null, non-array objects. All properties are required by
 * default — wrap individual properties with `optional()` to make them
 * optional (key may be absent). Only OWN properties count: inherited values
 * never satisfy a property. Undeclared own enumerable keys are rejected by
 * default (`additionalProperties: false`); pass `{ additionalProperties: true }`
 * to allow them (they are then neither validated nor stripped). The check
 * assumes declared properties are enumerable (always true for parsed JSON):
 * a non-enumerable declared own property can mask one undeclared key.
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

/**
 * Validates that value fully matches at least one of the given schemas (an
 * empty union matches nothing). Object variants sharing a literal-valued key
 * are dispatched on that key in O(1).
 */
export function union<const V extends readonly Schema[]>(...variants: V): UnionSchema<V> {
  return { kind: "union", meta: { variants } };
}

/**
 * Makes a schema accept `undefined` in addition to its normal type. Inside an
 * object it means "key may be absent"; use `nullable(T)` for null values.
 */
export function optional<I extends Schema>(inner: I): OptionalSchema<I> {
  return { kind: "optional", meta: { inner } };
}

/** Makes a schema accept `null` in addition to its normal type. */
export function nullable<I extends Schema>(inner: I): NullableSchema<I> {
  return { kind: "nullable", meta: { inner } };
}

/**
 * Validates that value fully matches EXACTLY one of the given schemas (JSON
 * Schema `oneOf`). A `"union"` node with `meta.exclusive: true`, so
 * serializers treat it like `union()`. Discriminated object variants keep the
 * O(1) `switch`; otherwise every variant is tried and matches are counted.
 *
 * @example
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * const IdOrCount = S.oneOf(S.string({ minLength: 1 }), S.integer({ minimum: 0 }));
 * ```
 */
export function oneOf<const V extends readonly Schema[]>(...variants: V): UnionSchema<V> {
  return { kind: "union", meta: { variants, exclusive: true } };
}

/**
 * Accepts any value except `undefined` (JSON Schema `{}` / `true`). Rejecting
 * `undefined` keeps a required `unknown()` property required: an absent key
 * reads as `undefined`. Wrap in `optional()` to allow absence.
 */
export function unknown(): UnknownSchema {
  return { kind: "unknown", meta: undefined };
}

/**
 * Validates that value matches EVERY variant (JSON Schema `allOf`). The
 * inferred type is the intersection. Each variant checks the value on its
 * own, so `additionalProperties: false` objects do not merge their keys.
 *
 * @example
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * const Named = S.object({ name: S.string() }, { additionalProperties: true });
 * const Aged = S.object({ age: S.integer() }, { additionalProperties: true });
 * const Person = S.allOf(Named, Aged); // { name: string } & { age: number }
 * ```
 */
export function allOf<const V extends readonly Schema[]>(...variants: V): AllOfSchema<V> {
  return { kind: "allOf", meta: { variants } };
}

/**
 * Accepts any defined value that does NOT match `inner` (JSON Schema `not`).
 * `undefined` is always rejected. Inferred type: `unknown`.
 */
export function not<I extends Schema>(inner: I): NotSchema<I> {
  return { kind: "not", meta: { inner } };
}

/**
 * If value matches `if_`, it must match `then_`; otherwise `else_` (JSON
 * Schema `if`/`then`/`else`). Both branches default to `unknown()`.
 *
 * @example
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * // numbers must be >= 2; anything else passes
 * const s = S.conditional(S.number(), S.number({ minimum: 2 }));
 * ```
 */
export function conditional<
  I extends Schema,
  T extends Schema = UnknownSchema,
  E extends Schema = UnknownSchema,
>(if_: I, then_?: T, else_?: E): ConditionalSchema<I, T, E> {
  return {
    kind: "conditional",
    meta: {
      if: if_,
      // `then` holds a Schema object, never a function — not a real thenable
      // eslint-disable-next-line unicorn/no-thenable
      then: (then_ ?? unknown()) as T,
      else: (else_ ?? unknown()) as E,
    },
  };
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
export function toJsonSchema(root: Schema): JsonSchemaObject {
  // Two-phase iterative traversal avoids recursion.
  // Phase 1: collect all schema nodes in pre-order (DFS).
  const nodes: Schema[] = [];
  const stack: Schema[] = [root];
  while (stack.length > 0) {
    const s = stack.pop()!;
    nodes.push(s);
    collectSchemaChildren(s, stack);
  }
  // Phase 2: build JSON Schema objects bottom-up. Processing in reverse
  // guarantees all children are built before their parent.
  const built = new Map<Schema, JsonSchemaObject>();
  for (let i = nodes.length - 1; i >= 0; i--) {
    built.set(nodes[i], buildJsonSchemaNode(nodes[i], built));
  }
  return built.get(root)!;
}

/** Push child schemas onto the stack in reverse order (left-to-right processing). */
function collectSchemaChildren(schema: Schema, stack: Schema[]): void {
  switch (schema.kind) {
    case "object": {
      const keys = Object.keys(schema.meta.properties);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(schema.meta.properties[keys[i]]);
      break;
    }
    case "array":
      stack.push(schema.meta.items);
      break;
    case "tuple": {
      const items = schema.meta.items;
      for (let i = items.length - 1; i >= 0; i--) stack.push(items[i]);
      break;
    }
    case "record":
      stack.push(schema.meta.values);
      break;
    case "union":
    case "allOf": {
      const vs = schema.meta.variants;
      for (let i = vs.length - 1; i >= 0; i--) stack.push(vs[i]);
      break;
    }
    case "optional":
    case "nullable":
    case "not":
      stack.push(schema.meta.inner);
      break;
    case "conditional":
      stack.push(schema.meta.else, schema.meta.then, schema.meta.if);
      break;
  }
}

/** Build a single JSON Schema node, looking up children in the results map. */
function buildJsonSchemaNode(s: Schema, built: Map<Schema, JsonSchemaObject>): JsonSchemaObject {
  switch (s.kind) {
    case "string": {
      const out: Record<string, unknown> = { type: "string" };
      if (s.meta !== undefined) {
        if (s.meta.minLength !== undefined) out.minLength = s.meta.minLength;
        if (s.meta.maxLength !== undefined) out.maxLength = s.meta.maxLength;
        if (s.meta.pattern !== undefined) out.pattern = s.meta.pattern;
        if (s.meta.format !== undefined) out.format = s.meta.format;
      }
      return out;
    }
    case "number":
      return numberSchemaToJson("number", s.meta);
    case "integer":
      return numberSchemaToJson("integer", s.meta);
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "literal":
      return { const: s.meta.value };
    case "enum":
      return { enum: s.meta.values };
    case "object": {
      const properties: Record<string, JsonSchemaObject> = {};
      const required: string[] = [];
      const keys = Object.keys(s.meta.properties);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const child = s.meta.properties[key];
        // For optional children, built.get(child) returns the unwrapped inner's
        // JSON Schema (see "optional" case below). Required/optional is tracked
        // via the required array, not the JSON Schema itself.
        setOwn(properties, key, built.get(child)!);
        if (!propertyMayBeAbsent(child)) required.push(key);
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) out.required = required;
      out.additionalProperties = s.meta.additionalProperties;
      return out;
    }
    case "array": {
      const out: Record<string, unknown> = {
        type: "array",
        items: built.get(s.meta.items)!,
      };
      if (s.meta.minItems !== undefined) out.minItems = s.meta.minItems;
      if (s.meta.maxItems !== undefined) out.maxItems = s.meta.maxItems;
      return out;
    }
    case "tuple": {
      const items = s.meta.items;
      const prefixItems: JsonSchemaObject[] = Array(items.length);
      for (let i = 0; i < items.length; i++) prefixItems[i] = built.get(items[i])!;
      // prefixItems alone accepts shorter arrays; minItems pins the exact length
      if (items.length === 0) return { type: "array", prefixItems, items: false };
      return { type: "array", prefixItems, items: false, minItems: items.length };
    }
    case "record":
      return { type: "object", additionalProperties: built.get(s.meta.values)! };
    case "union": {
      const variants = s.meta.variants;
      const list: JsonSchemaObject[] = Array(variants.length);
      for (let i = 0; i < variants.length; i++) list[i] = built.get(variants[i])!;
      return s.meta.exclusive === true ? { oneOf: list } : { anyOf: list };
    }
    case "allOf": {
      const variants = s.meta.variants;
      const list: JsonSchemaObject[] = Array(variants.length);
      for (let i = 0; i < variants.length; i++) list[i] = built.get(variants[i])!;
      return { allOf: list };
    }
    case "unknown":
      return {};
    case "not":
      return { not: built.get(s.meta.inner)! };
    case "conditional":
      return {
        if: built.get(s.meta.if)!,
        // JSON Schema keyword name; the value is a plain object, not a function
        // eslint-disable-next-line unicorn/no-thenable
        then: built.get(s.meta.then)!,
        else: built.get(s.meta.else)!,
      };
    case "optional":
      // At top level, optional just means the inner type or undefined.
      // JSON Schema doesn't have a direct "optional" concept outside objects.
      return built.get(s.meta.inner)!;
    case "nullable":
      return { anyOf: [built.get(s.meta.inner)!, { type: "null" }] };
    default:
      unreachable(s);
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

/** Options for `fromJsonSchema`. */
export interface FromJsonSchemaOptions {
  /**
   * Schemas for non-local `$ref`s. A key is matched against the `$ref`
   * resolved against the document's base URI (as `$id` resolution does) and
   * also against the raw `$ref` text; `$id`s inside these schemas are
   * registered too.
   */
  readonly refs?: Readonly<Record<string, JsonSchemaObject | boolean>>;
  /**
   * `"annotate"` (default): a `format` name `schema/Formats` does not know is
   * kept but annotation-only, as JSON Schema 2020-12 specifies. `"strict"`:
   * any unknown `format` name, on any node, returns `Err` — so no format in
   * the input can go unchecked.
   */
  readonly formats?: "annotate" | "strict";
}

/**
 * Converts a JSON Schema (2020-12) document to a Schema. Never throws.
 *
 * Supported: `type` (string or array), `const`, `enum`, string / number /
 * object / array keywords, `anyOf`, `oneOf` (exactly one), `allOf`, `not`,
 * `if`/`then`/`else`, boolean schemas, and `$ref`. Keywords apply as in JSON
 * Schema: without `type`, a keyword group only constrains values of its own
 * type (`{ minimum: 2 }` accepts `"x"`), and untyped object keywords never
 * close the object. `$ref` siblings that assert are combined with the target
 * (`allOf`), annotations (`title`, `description`, `$comment`, `default`,
 * `examples`, ...) and unknown keywords are ignored.
 *
 * `$ref` resolves JSON pointers (`#/$defs/X`, `~0`/`~1`, percent-decoding),
 * `#anchor`s, and URIs matching an `$id` in the document or in `options.refs`;
 * a shared target lowers to one shared Schema node. Returns `Err` for:
 * recursive or unresolved `$ref`, cyclic input, keywords with no lowering
 * (`patternProperties`, `propertyNames`, `contains`, `uniqueItems: true`,
 * `min/maxProperties`, `dependent*`, `unevaluated*`, `$dynamicRef`,
 * `prefixItems` unless `items: false`, `additionalProperties` as a schema
 * beside `properties`, object/array `const`/`enum`), malformed keyword values,
 * invalid `pattern` regexes, and results too big to compile safely (over
 * 50,000 nodes once every `$ref` use is expanded, or nested deeper than 256). Unknown `format` names are annotation-only
 * unless `options.formats` is `"strict"`, which returns `Err` for them.
 *
 * Divergences from JSON Schema kept for speed: string lengths count UTF-16
 * code units, `integer` means a safe integer, `pattern` compiles without the
 * `u` flag (on astral characters such as emoji, `.`, `[^…]`, `\S`, `\W`
 * match half a surrogate pair: `^.$` rejects `"😀"`).
 *
 * @example Local `$ref` and `oneOf`
 * ```ts
 * import * as S from "@dolphin278/vjuga/schema/Schema";
 * const r = S.fromJsonSchema({
 *   $defs: { id: { type: "string", minLength: 1 } },
 *   oneOf: [{ $ref: "#/$defs/id" }, { type: "array", items: { $ref: "#/$defs/id" } }],
 * });
 * // r: [true, union(exclusive) of string and array(string)]
 * ```
 */
export function fromJsonSchema(
  root: JsonSchemaObject | boolean,
  options?: FromJsonSchemaOptions,
): Result<Schema, string> {
  const ctx: LowerCtx = {
    registry: new Map(),
    rawRefs: options?.refs,
    strictFormats: options?.formats === "strict",
    memo: new Map(),
    active: new Set(),
    path: [],
  };
  try {
    registerResources(ctx, root, DEFAULT_BASE);
    const refs = options?.refs;
    if (refs !== undefined) {
      const keys = Object.keys(refs);
      for (let i = 0; i < keys.length; i++) {
        const uri = tryResolve(keys[i], DEFAULT_BASE);
        if (uri !== null) registerResources(ctx, refs[keys[i]], uri);
      }
    }
    const schema = lower(ctx, root, DEFAULT_BASE, false);
    const limit = checkExpansion(schema);
    return limit === null ? ok(schema) : err(limit);
  } catch (e) {
    if (e instanceof LowerFail) return err(e.message);
    throw e;
  }
}

/** Base URI for documents without an absolute `$id` (custom hierarchical scheme). */
const DEFAULT_BASE = "vjuga://root/";

/** JSON nesting cap (path tokens) — bounds the recursion of lowering itself. */
const MAX_DEPTH = 512;

/**
 * Size caps on the lowered Schema, measured as the tree every consumer
 * expands: `validate`, `JSON.parse` / `stringify`, TOON and `toJsonSchema`
 * inline a node at every use, so a node shared through `$ref` counts once per
 * use. Without them a few KB of `$ref` chain (`d_i` → two refs to `d_i-1`)
 * expand to gigabytes of generated code. The depth cap keeps generated code
 * (one or two JS blocks per level in `allErrors` mode) far from parser and
 * call-stack limits.
 */
const MAX_EXPANDED_NODES = 50_000;
const MAX_SCHEMA_DEPTH = 256;

/**
 * Err message if `root`, expanded as a tree, has more than
 * `MAX_EXPANDED_NODES` nodes or is nested deeper than `MAX_SCHEMA_DEPTH`;
 * null when it fits. Linear in the number of distinct nodes (memoized DAG walk).
 */
function checkExpansion(root: Schema): string | null {
  // node → [expanded size, depth]; lowering never builds cycles
  const memo = new Map<Schema, readonly [number, number]>();
  const stack: Schema[] = [root];
  const children: Schema[] = [];
  while (stack.length > 0) {
    const s = stack[stack.length - 1];
    if (memo.has(s)) {
      stack.pop();
      continue;
    }
    children.length = 0;
    collectSchemaChildren(s, children);
    let pending = false;
    let size = 1;
    let depth = 0;
    for (let i = 0; i < children.length; i++) {
      const m = memo.get(children[i]);
      if (m === undefined) {
        stack.push(children[i]);
        pending = true;
      } else {
        // Saturates instead of overflowing: only the comparison matters
        size = Math.min(size + m[0], MAX_EXPANDED_NODES + 1);
        if (m[1] > depth) depth = m[1];
      }
    }
    if (pending) continue;
    stack.pop();
    memo.set(s, [size, depth + 1]);
  }
  const [size, depth] = memo.get(root)!;
  if (size > MAX_EXPANDED_NODES) {
    return "JSON Schema expands to more than " + MAX_EXPANDED_NODES + " nodes ($ref fan-out)";
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    return "JSON Schema lowers to a schema nested deeper than " + MAX_SCHEMA_DEPTH;
  }
  return null;
}

interface Resource {
  readonly node: unknown;
  /** Base URI in effect where `node` sits (before its own `$id` applies). */
  readonly base: string;
}

interface LowerCtx {
  /** Absolute URI (no fragment, or `#anchor`) → schema node. */
  readonly registry: Map<string, Resource>;
  readonly rawRefs: Readonly<Record<string, unknown>> | undefined;
  /** `$ref` targets already lowered, by identity — shared refs share a node. */
  readonly memo: Map<object, Schema>;
  /** Nodes on the current lowering path (cycle detection). */
  readonly active: Set<object>;
  /** JSON-pointer tokens of the current position, for error messages. */
  readonly path: string[];
  /** `formats: "strict"` — unknown `format` names fail instead of annotating. */
  readonly strictFormats: boolean;
}

/** Internal failure carrier; converted to `Err` by `fromJsonSchema`. */
class LowerFail {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

function fail(ctx: LowerCtx, msg: string): never {
  const at = ctx.path.length === 0 ? "" : " (at #/" + ctx.path.join("/") + ")";
  throw new LowerFail(msg + at);
}

/** Pure annotations — never constrain a value, safe to ignore. */
const ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "$defs",
  "definitions",
  "$vocabulary",
  "$dynamicAnchor",
  "$recursiveAnchor",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentMediaType",
  "contentEncoding",
  "contentSchema",
]);

/** Assertion / applicator keywords with no lowering — always `Err`, never dropped. */
const UNSUPPORTED = [
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "dependencies",
  "minProperties",
  "maxProperties",
  "contains",
  "additionalItems",
  "unevaluatedItems",
  "unevaluatedProperties",
  "$dynamicRef",
  "$recursiveRef",
];

const STRING_KW = ["minLength", "maxLength", "pattern", "format"];
const NUMBER_KW = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"];
const OBJECT_KW = ["properties", "required", "additionalProperties"];
const ARRAY_KW = ["items", "prefixItems", "minItems", "maxItems"];
const TYPE_NAMES = ["string", "number", "integer", "boolean", "null", "object", "array"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasAny(js: Record<string, unknown>, keys: readonly string[]): boolean {
  for (let i = 0; i < keys.length; i++) if (Object.hasOwn(js, keys[i])) return true;
  return false;
}

/** Own-property read (a `"constructor"` key must not hit Object.prototype). */
function own(js: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(js, key) ? js[key] : undefined;
}

function tryResolve(ref: string, base: string): string | null {
  try {
    return new URL(ref, base).href;
  } catch {
    return null;
  }
}

function stripFragment(uri: string): string {
  const i = uri.indexOf("#");
  return i === -1 ? uri : uri.slice(0, i);
}

/** Apply a node's own `$id` (if any) to the base URI. */
function applyId(ctx: LowerCtx | null, js: Record<string, unknown>, base: string): string {
  const id = own(js, "$id");
  if (typeof id !== "string") return base;
  const uri = tryResolve(id, base);
  if (uri === null) {
    if (ctx !== null) fail(ctx, "invalid $id " + JSON.stringify(id));
    return base;
  }
  return stripFragment(uri);
}

// Keywords whose values are subschemas (walked for `$id` / `$anchor`).
const SUB_ONE = [
  "items",
  "not",
  "if",
  "then",
  "else",
  "additionalProperties",
  "contains",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
  "additionalItems",
];
const SUB_LIST = ["prefixItems", "allOf", "anyOf", "oneOf"];
const SUB_MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];

/** Register every `$id` / `$anchor` resource reachable through schema keywords. */
function registerResources(ctx: LowerCtx, rootNode: unknown, rootBase: string): void {
  const seen = new Set<object>();
  const stack: Resource[] = [{ node: rootNode, base: rootBase }];
  let first = true;
  while (stack.length > 0) {
    const { node, base: parentBase } = stack.pop()!;
    if (!isPlainObject(node) || seen.has(node)) continue;
    seen.add(node);
    const base = applyId(null, node, parentBase);
    const entry: Resource = { node, base: parentBase };
    if (first && !ctx.registry.has(parentBase)) ctx.registry.set(parentBase, entry);
    if ((first || typeof own(node, "$id") === "string") && !ctx.registry.has(base)) {
      ctx.registry.set(base, entry);
    }
    first = false;
    const anchor = own(node, "$anchor");
    if (typeof anchor === "string" && !ctx.registry.has(base + "#" + anchor)) {
      ctx.registry.set(base + "#" + anchor, entry);
    }
    for (const k of SUB_ONE) stack.push({ node: own(node, k), base });
    for (const k of SUB_LIST) {
      const list = own(node, k);
      if (Array.isArray(list)) for (const sub of list) stack.push({ node: sub, base });
    }
    for (const k of SUB_MAP) {
      const map = own(node, k);
      if (isPlainObject(map))
        for (const key of Object.keys(map)) stack.push({ node: map[key], base });
    }
  }
}

/** Resolve a `$ref` to its target node and the base URI in effect there. */
function resolveRef(ctx: LowerCtx, ref: string, base: string): Resource {
  // A ref that is not URI-resolvable can still match an options.refs raw key
  const abs = tryResolve(ref, base) ?? ref;
  const hashAt = abs.indexOf("#");
  const doc = hashAt === -1 ? abs : abs.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : abs.slice(hashAt + 1);
  let resource = ctx.registry.get(doc);
  if (resource === undefined) {
    // Raw-key fallback: options.refs keyed by the literal $ref text
    const rawHash = ref.indexOf("#");
    const rawKey = rawHash === -1 ? ref : ref.slice(0, rawHash);
    const raw = ctx.rawRefs;
    if (raw !== undefined && Object.hasOwn(raw, rawKey)) {
      resource = { node: raw[rawKey], base: tryResolve(rawKey, DEFAULT_BASE) ?? DEFAULT_BASE };
    } else {
      fail(ctx, "unresolved $ref " + JSON.stringify(ref) + " (supply it via options.refs)");
    }
  }
  if (fragment === "") return resource;
  if (fragment[0] !== "/") {
    const anchored = ctx.registry.get(doc + "#" + fragment);
    if (anchored === undefined) fail(ctx, "unresolved $ref anchor " + JSON.stringify(ref));
    return anchored;
  }
  let pointer: string;
  try {
    pointer = decodeURIComponent(fragment);
  } catch {
    fail(ctx, "malformed percent-encoding in $ref " + JSON.stringify(ref));
  }
  const tokens = pointer.slice(1).split("/");
  let node = resource.node;
  let nodeBase = resource.base;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/~1/g, "/").replace(/~0/g, "~");
    if (isPlainObject(node)) nodeBase = applyId(ctx, node, nodeBase);
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, token)) {
      fail(ctx, "unresolved $ref pointer " + JSON.stringify(ref));
    }
    node = (node as Record<string, unknown>)[token];
  }
  return { node, base: nodeBase };
}

/** Lower one JSON Schema node (object or boolean). */
function lower(ctx: LowerCtx, js: unknown, base: string, viaRef: boolean): Schema {
  if (js === true) return unknown();
  if (js === false) return not(unknown());
  if (!isPlainObject(js)) {
    fail(
      ctx,
      "schema node must be an object or boolean, got " +
        (js === null ? "null" : Array.isArray(js) ? "array" : typeof js),
    );
  }
  if (ctx.active.has(js)) {
    fail(ctx, viaRef ? "recursive $ref is not supported" : "cyclic JSON Schema input");
  }
  if (ctx.path.length >= MAX_DEPTH) fail(ctx, "JSON Schema nested deeper than " + MAX_DEPTH);
  ctx.active.add(js);
  try {
    return lowerNode(ctx, js, applyId(ctx, js, base));
  } finally {
    ctx.active.delete(js);
  }
}

/** Lower `js[key]` with `key` pushed onto the error path. */
function child(ctx: LowerCtx, js: unknown, base: string, ...keys: string[]): Schema {
  for (let i = 0; i < keys.length; i++)
    ctx.path.push(keys[i].replace(/~/g, "~0").replace(/\//g, "~1"));
  try {
    let node: unknown = js;
    for (let i = 0; i < keys.length; i++) node = (node as Record<string, unknown>)[keys[i]];
    return lower(ctx, node, base, false);
  } finally {
    ctx.path.length -= keys.length;
  }
}

function lowerRef(ctx: LowerCtx, ref: unknown, base: string): Schema {
  if (typeof ref !== "string") fail(ctx, "$ref must be a string");
  const target = resolveRef(ctx, ref, base);
  const node = target.node;
  if (typeof node !== "object" || node === null) return lower(ctx, node, target.base, true);
  const cached = ctx.memo.get(node);
  if (cached !== undefined) return cached;
  ctx.path.push("$ref");
  try {
    const s = lower(ctx, node, target.base, true);
    ctx.memo.set(node, s);
    return s;
  } finally {
    ctx.path.pop();
  }
}

function lowerNode(ctx: LowerCtx, js: Record<string, unknown>, base: string): Schema {
  for (let i = 0; i < UNSUPPORTED.length; i++) {
    if (Object.hasOwn(js, UNSUPPORTED[i])) fail(ctx, UNSUPPORTED[i] + " is not supported");
  }
  const unique = own(js, "uniqueItems");
  if (unique !== undefined && unique !== false) fail(ctx, "uniqueItems is not supported");
  if (ctx.strictFormats) {
    const format = own(js, "format");
    if (typeof format === "string" && !isKnownFormat(format)) {
      fail(ctx, "unknown format " + JSON.stringify(format) + ' (formats: "strict")');
    }
  }

  const parts: Schema[] = [];
  if (Object.hasOwn(js, "$ref")) parts.push(lowerRef(ctx, js.$ref, base));

  // type + type-specific keyword groups
  const types = readTypes(ctx, js);
  let typed: Schema | null = null;
  let bare = false; // `type` present with no applicable keyword group
  if (types !== null) {
    bare = true;
    const variants: Schema[] = [];
    for (let i = 0; i < types.length; i++) {
      if (hasAny(js, groupOf(types[i]))) bare = false;
      variants.push(lowerTyped(ctx, js, base, types[i]));
    }
    typed = combineTypes(variants, types);
  } else {
    const guards: Schema[] = [];
    if (hasAny(js, STRING_KW)) guards.push(guarded(string(), lowerTyped(ctx, js, base, "string")));
    if (hasAny(js, NUMBER_KW)) guards.push(guarded(number(), lowerTyped(ctx, js, base, "number")));
    if (hasAny(js, OBJECT_KW)) {
      const anyObject = object({}, { additionalProperties: true });
      guards.push(guarded(anyObject, lowerTyped(ctx, js, base, "object")));
    }
    if (hasAny(js, ARRAY_KW)) {
      guards.push(guarded(array(unknown()), lowerTyped(ctx, js, base, "array")));
    }
    if (guards.length > 0) typed = guards.length === 1 ? guards[0] : allOf(...guards);
  }

  // const / enum — a bare `type` every value already satisfies is redundant
  const values: Schema[] = [];
  let primitives: (string | number | boolean | null)[] = [];
  if (Object.hasOwn(js, "const")) {
    const v = js.const;
    if (!isPrimitiveValue(v)) fail(ctx, "unsupported const type: " + kindOfValue(v));
    values.push(literal(v));
    primitives.push(v);
  }
  if (Object.hasOwn(js, "enum")) {
    const list = js.enum;
    if (!Array.isArray(list)) fail(ctx, "enum must be an array");
    values.push(lowerEnum(ctx, list));
    primitives = primitives.concat(list as (string | number | boolean | null)[]);
  }
  if (typed !== null && !(bare && values.length > 0 && allMatchTypes(primitives, types!))) {
    parts.push(typed);
  }
  for (let i = 0; i < values.length; i++) parts.push(values[i]);

  // Combinators
  if (Object.hasOwn(js, "anyOf")) parts.push(lowerChoice(ctx, js, base, "anyOf"));
  if (Object.hasOwn(js, "oneOf")) parts.push(lowerChoice(ctx, js, base, "oneOf"));
  if (Object.hasOwn(js, "allOf")) {
    const list = schemaList(ctx, js, "allOf");
    const lowered = list.map((_, i) => child(ctx, js, base, "allOf", String(i)));
    parts.push(lowered.length === 1 ? lowered[0] : allOf(...lowered));
  }
  if (Object.hasOwn(js, "not")) parts.push(not(child(ctx, js, base, "not")));
  if (Object.hasOwn(js, "if") && (Object.hasOwn(js, "then") || Object.hasOwn(js, "else"))) {
    parts.push(
      conditional(
        child(ctx, js, base, "if"),
        Object.hasOwn(js, "then") ? child(ctx, js, base, "then") : unknown(),
        Object.hasOwn(js, "else") ? child(ctx, js, base, "else") : unknown(),
      ),
    );
  }

  if (parts.length === 0) return unknown();
  return parts.length === 1 ? parts[0] : allOf(...parts);
}

function readTypes(ctx: LowerCtx, js: Record<string, unknown>): string[] | null {
  if (!Object.hasOwn(js, "type")) return null;
  const t = js.type;
  const list = Array.isArray(t) ? t : [t];
  if (list.length === 0) fail(ctx, "type must not be an empty array");
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string" || !TYPE_NAMES.includes(list[i] as string)) {
      fail(ctx, "unsupported type " + JSON.stringify(list[i]));
    }
  }
  return list as string[];
}

function groupOf(type: string): readonly string[] {
  switch (type) {
    case "string":
      return STRING_KW;
    case "number":
    case "integer":
      return NUMBER_KW;
    case "object":
      return OBJECT_KW;
    case "array":
      return ARRAY_KW;
    default:
      return [];
  }
}

/** `type: [...]` → nullable / union of the per-type schemas. */
function combineTypes(variants: Schema[], types: readonly string[]): Schema {
  if (variants.length === 1) return variants[0];
  if (variants.length === 2 && types[1] === "null" && types[0] !== "null") {
    return nullable(variants[0]);
  }
  if (variants.length === 2 && types[0] === "null" && types[1] !== "null") {
    return nullable(variants[1]);
  }
  return union(...variants);
}

/** Untyped keyword group: constrains only values of the guard's type. */
function guarded(guard: Schema, then: Schema): Schema {
  return conditional(guard, then, unknown());
}

function isPrimitiveValue(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function kindOfValue(v: unknown): string {
  return Array.isArray(v) ? "array" : typeof v;
}

function valueMatchesType(v: string | number | boolean | null, type: string): boolean {
  switch (type) {
    case "integer":
      return Number.isSafeInteger(v);
    case "null":
      return v === null;
    default:
      return typeof v === type;
  }
}

function allMatchTypes(
  values: readonly (string | number | boolean | null)[],
  types: readonly string[],
): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!types.some((t) => valueMatchesType(values[i], t))) return false;
  }
  return true;
}

function lowerEnum(ctx: LowerCtx, list: readonly unknown[]): Schema {
  if (list.length === 0) return not(unknown());
  let stringOrNumber = true;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (!isPrimitiveValue(v)) fail(ctx, "enum values must be primitives, got " + kindOfValue(v));
    if (typeof v !== "string" && typeof v !== "number") stringOrNumber = false;
  }
  if (stringOrNumber) return enum_(...(list as (string | number)[]));
  return union(...(list as (string | number | boolean | null)[]).map((v) => literal(v)));
}

function schemaList(ctx: LowerCtx, js: Record<string, unknown>, key: string): readonly unknown[] {
  const list = js[key];
  if (!Array.isArray(list) || list.length === 0) fail(ctx, key + " must be a non-empty array");
  return list;
}

/** `{type:"null"}` plus annotations only. */
function isPureNull(js: unknown): boolean {
  if (!isPlainObject(js) || js.type !== "null") return false;
  const keys = Object.keys(js);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== "type" && !ANNOTATIONS.has(keys[i])) return false;
  }
  return true;
}

/** anyOf → union, oneOf → exclusive union; `[T, null]` pairs → nullable(T) when exact. */
function lowerChoice(
  ctx: LowerCtx,
  js: Record<string, unknown>,
  base: string,
  key: "anyOf" | "oneOf",
): Schema {
  const list = schemaList(ctx, js, key);
  if (list.length === 2) {
    const nullAt = isPureNull(list[1]) ? 1 : isPureNull(list[0]) ? 0 : -1;
    if (nullAt !== -1) {
      const other = child(ctx, js, base, key, String(1 - nullAt));
      // oneOf: if T accepted null too, null would match both — not nullable(T)
      if (key === "anyOf" || rejectsNull(other)) return nullable(other);
      const nul = null_();
      return oneOf(...(nullAt === 1 ? [other, nul] : [nul, other]));
    }
  }
  const lowered = list.map((_, i) => child(ctx, js, base, key, String(i)));
  return key === "anyOf" ? union(...lowered) : oneOf(...lowered);
}

/** True only if `s` provably rejects `null` (false = unknown or accepts). */
function rejectsNull(s: Schema): boolean {
  switch (s.kind) {
    case "null":
    case "nullable":
    case "unknown":
    case "not":
    case "optional": // never produced by lowering outside object properties
      return false;
    case "literal":
      return s.meta.value !== null;
    case "union":
      return (s.meta.variants as readonly Schema[]).every(rejectsNull);
    case "allOf":
      return (s.meta.variants as readonly Schema[]).some(rejectsNull);
    case "conditional":
      return rejectsNull(s.meta.then) && rejectsNull(s.meta.else);
    default:
      // string, number, integer, boolean, enum (strings/numbers), object, array, tuple, record
      return true;
  }
}

function readNumber(ctx: LowerCtx, js: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(js, key)) return undefined;
  const v = js[key];
  if (typeof v !== "number") fail(ctx, key + " must be a number");
  return v;
}

/** The schema for values of one JSON type, from that type's keyword group. */
function lowerTyped(
  ctx: LowerCtx,
  js: Record<string, unknown>,
  base: string,
  type: string,
): Schema {
  switch (type) {
    case "string":
      return lowerString(ctx, js);
    case "number":
    case "integer": {
      for (let i = 0; i < NUMBER_KW.length; i++) readNumber(ctx, js, NUMBER_KW[i]);
      const m = own(js, "multipleOf");
      if (typeof m === "number" && !(m > 0 && Number.isFinite(m))) {
        fail(ctx, "multipleOf must be a finite number > 0");
      }
      const c = extractNumberConstraints(js);
      return type === "integer" ? integer(c) : number(c);
    }
    case "boolean":
      return boolean();
    case "null":
      return null_();
    case "object":
      return lowerObjectKeywords(ctx, js, base);
    default:
      return lowerArrayKeywords(ctx, js, base);
  }
}

/** Pattern constructs that only mean the same thing in unicode mode. */
const UNICODE_ONLY = /\\[pP]\{|\\u\{|[\uD800-\uDFFF]/;

function lowerString(ctx: LowerCtx, js: Record<string, unknown>): Schema {
  const c: Record<string, unknown> = {};
  let hasConstraints = false;
  const minLength = readNumber(ctx, js, "minLength");
  if (minLength !== undefined) {
    c.minLength = minLength;
    hasConstraints = true;
  }
  const maxLength = readNumber(ctx, js, "maxLength");
  if (maxLength !== undefined) {
    c.maxLength = maxLength;
    hasConstraints = true;
  }
  if (Object.hasOwn(js, "pattern")) {
    const pattern = js.pattern;
    if (typeof pattern !== "string") fail(ctx, "pattern must be a string");
    // Validate compiles without the `u` flag. Require unicode-mode validity
    // (JSON Schema's dialect) and reject the constructs that only exist in
    // unicode mode. Still divergent on strings containing astral characters:
    // `.`, negated classes, `\S` / `\W` / `\D` match one UTF-16 unit, not one
    // code point (documented on fromJsonSchema).
    if (UNICODE_ONLY.test(pattern)) {
      fail(ctx, "pattern needs unicode mode (\\p{..}, \\u{..} or astral characters)");
    }
    try {
      new RegExp(pattern, "u");
      new RegExp(pattern);
    } catch {
      fail(ctx, "invalid pattern " + JSON.stringify(pattern));
    }
    c.pattern = pattern;
    hasConstraints = true;
  }
  if (Object.hasOwn(js, "format")) {
    if (typeof js.format !== "string") fail(ctx, "format must be a string");
    // Unknown names are stored as annotations (Validate skips them)
    c.format = js.format;
    hasConstraints = true;
  }
  return string(hasConstraints ? (c as StringConstraints) : undefined);
}

function lowerObjectKeywords(ctx: LowerCtx, js: Record<string, unknown>, base: string): Schema {
  const props = Object.hasOwn(js, "properties") ? js.properties : {};
  if (!isPlainObject(props)) fail(ctx, "properties must be an object");
  const req = Object.hasOwn(js, "required") ? js.required : [];
  if (!Array.isArray(req) || !req.every((k) => typeof k === "string")) {
    fail(ctx, "required must be an array of strings");
  }
  const required = req as string[];
  const keys = Object.keys(props);
  const ap = own(js, "additionalProperties");

  if (ap !== undefined && typeof ap !== "boolean") {
    if (keys.length > 0) {
      fail(ctx, "additionalProperties as a schema alongside properties is not supported");
    }
    const rec = record(child(ctx, js, base, "additionalProperties"));
    if (required.length === 0) return rec;
    return allOf(rec, object(requiredKeys(required), { additionalProperties: true }));
  }

  const addlProps = ap !== false;
  const requiredSet = new Set(required);
  const objProps: Record<string, Schema> = {};
  // Insert in declaration order; setOwn keeps a "__proto__" key as data
  for (let i = 0; i < keys.length; i++) {
    const s = child(ctx, js, base, "properties", keys[i]);
    setOwn(objProps, keys[i], requiredSet.has(keys[i]) ? s : optional(s));
  }
  for (let i = 0; i < required.length; i++) {
    const k = required[i];
    if (Object.hasOwn(objProps, k)) continue;
    // Required but undeclared under additionalProperties:false: no object passes
    if (!addlProps) return not(unknown());
    setOwn(objProps, k, unknown());
  }
  return object(objProps, { additionalProperties: addlProps });
}

function requiredKeys(required: readonly string[]): Record<string, Schema> {
  const out: Record<string, Schema> = {};
  for (let i = 0; i < required.length; i++) setOwn(out, required[i], unknown());
  return out;
}

function lowerArrayKeywords(ctx: LowerCtx, js: Record<string, unknown>, base: string): Schema {
  const min = readNumber(ctx, js, "minItems");
  const max = readNumber(ctx, js, "maxItems");
  const items = own(js, "items");
  if (Array.isArray(items)) {
    fail(ctx, "array-form items is not supported (use prefixItems with items: false)");
  }

  if (Object.hasOwn(js, "prefixItems")) {
    const prefix = js.prefixItems;
    if (!Array.isArray(prefix)) fail(ctx, "prefixItems must be an array");
    if (items !== false) fail(ctx, "prefixItems is only supported with items: false");
    const lowered = prefix.map((_, i) => child(ctx, js, base, "prefixItems", String(i)));
    const n = lowered.length;
    const lo = Math.max(0, Math.ceil(min ?? 0));
    const hi = Math.min(n, Math.floor(max ?? n));
    if (lo > hi) return not(unknown());
    if (lo === hi) return tuple(...lowered.slice(0, lo));
    // prefixItems does not require presence: accept every allowed length
    const lengths: Schema[] = [];
    for (let k = lo; k <= hi; k++) lengths.push(tuple(...lowered.slice(0, k)));
    return union(...lengths);
  }

  const itemSchema =
    items === undefined || items === true
      ? unknown()
      : items === false
        ? not(unknown())
        : child(ctx, js, base, "items");
  const hasOpts = min !== undefined || max !== undefined;
  return array(itemSchema, hasOpts ? { minItems: min, maxItems: max } : undefined);
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/**
 * True if an object property with this schema may be absent: `optional(T)`,
 * or an `allOf` / `conditional` that accepts `undefined` (e.g.
 * `allOf(optional(T), ...)`). Serializers use it to omit absent keys and
 * `toJsonSchema` to leave the key out of `required`.
 */
export function propertyMayBeAbsent(schema: Schema): boolean {
  if (schema.kind === "optional") return true;
  return (
    (schema.kind === "allOf" || schema.kind === "conditional") && acceptsUndefinedExact(schema)
  );
}

/** Exactly whether `schema` accepts the value `undefined`. */
function acceptsUndefinedExact(s: Schema): boolean {
  switch (s.kind) {
    case "optional":
      return true;
    case "nullable":
      return acceptsUndefinedExact(s.meta.inner);
    case "union": {
      const matches = (s.meta.variants as readonly Schema[]).filter(acceptsUndefinedExact).length;
      return s.meta.exclusive === true ? matches === 1 : matches > 0;
    }
    case "allOf":
      return (s.meta.variants as readonly Schema[]).every(acceptsUndefinedExact);
    case "conditional":
      return acceptsUndefinedExact(s.meta.if)
        ? acceptsUndefinedExact(s.meta.then)
        : acceptsUndefinedExact(s.meta.else);
    default:
      // literal values are never undefined; unknown / not reject it
      return false;
  }
}

/** True if the schema describes a leaf value (no nesting). */
export function isPrimitive(schema: Schema): boolean {
  // Iterative unwrap of optional/nullable wrappers — avoids recursion
  let s = schema;
  while (s.kind === "optional" || s.kind === "nullable") {
    s = s.meta.inner;
  }
  switch (s.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
    case "literal":
    case "enum":
      return true;
    default:
      return false;
  }
}

/**
 * Detect a common discriminant key among union variants.
 *
 * Returns the key name if ALL variants are object schemas sharing an own
 * property whose schema is a literal with distinct values (a `NaN` literal
 * never qualifies — it cannot be matched by `switch`). Returns null otherwise.
 */
export function findDiscriminant(variants: readonly Schema[]): string | null {
  if (variants.length < 2) return null;
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].kind !== "object") return null;
  }
  const first = variants[0];
  /* node:coverage ignore next 2 */
  if (first.kind !== "object") return null; // guaranteed by loop above, satisfies TS
  const keys = Object.keys(first.meta.properties);
  // Reuse a single Set across candidate keys — clear per iteration to avoid
  // allocating a new Set for each key.
  const seen = new Set<string | number | boolean | null>();
  outer: for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    seen.clear();
    for (let i = 0; i < variants.length; i++) {
      const obj = variants[i];
      /* node:coverage ignore next 2 */
      if (obj.kind !== "object") continue outer; // guaranteed by loop above, satisfies TS
      const props = obj.meta.properties as Readonly<Record<string, Schema>>;
      if (!Object.hasOwn(props, key)) continue outer;
      const prop = props[key];
      if (prop.kind !== "literal") continue outer;
      const val = prop.meta.value;
      if (val !== val || seen.has(val)) continue outer;
      seen.add(val);
    }
    return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Assign `obj[key] = value` as an own data property. Plain assignment of a
 * `"__proto__"` key would invoke the Object.prototype setter (changing the
 * prototype) instead of creating a property.
 */
function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    obj[key] = value;
  }
}

function extractNumberConstraints(js: JsonSchemaObject): NumberConstraints | undefined {
  const c: Record<string, unknown> = {};
  let has = false;
  if (typeof js.minimum === "number") {
    c.minimum = js.minimum;
    has = true;
  }
  if (typeof js.maximum === "number") {
    c.maximum = js.maximum;
    has = true;
  }
  if (typeof js.exclusiveMinimum === "number") {
    c.exclusiveMinimum = js.exclusiveMinimum;
    has = true;
  }
  if (typeof js.exclusiveMaximum === "number") {
    c.exclusiveMaximum = js.exclusiveMaximum;
    has = true;
  }
  if (typeof js.multipleOf === "number") {
    c.multipleOf = js.multipleOf;
    has = true;
  }
  return has ? (c as NumberConstraints) : undefined;
}
