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
import { unreachable } from "../FunctionUtils.js";

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
    case "union": {
      const vs = schema.meta.variants;
      for (let i = vs.length - 1; i >= 0; i--) stack.push(vs[i]);
      break;
    }
    case "optional":
    case "nullable":
      stack.push(schema.meta.inner);
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
        properties[key] = built.get(child)!;
        if (child.kind !== "optional") required.push(key);
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
      const prefixItems: JsonSchemaObject[] = new Array(items.length);
      for (let i = 0; i < items.length; i++) prefixItems[i] = built.get(items[i])!;
      return { type: "array", prefixItems, items: false };
    }
    case "record":
      return { type: "object", additionalProperties: built.get(s.meta.values)! };
    case "union": {
      const variants = s.meta.variants;
      const anyOf: JsonSchemaObject[] = new Array(variants.length);
      for (let i = 0; i < variants.length; i++) anyOf[i] = built.get(variants[i])!;
      return { anyOf };
    }
    case "optional":
      // At top level, optional just means the inner type or undefined.
      // JSON Schema doesn't have a direct "optional" concept outside objects.
      return built.get(s.meta.inner)!;
    case "nullable":
      return { anyOf: [built.get(s.meta.inner)!, { type: "null" }] };
    default: {
      /* node:coverage ignore next */
      unreachable(s);
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
 *
 * Uses an explicit work stack + result stack to avoid recursion. "Visit" items
 * classify a JSON Schema node and push child visits + a "build" marker. "Build"
 * items pop child results and construct the parent Schema.
 */
export function fromJsonSchema(root: JsonSchemaObject): Result<Schema, string> {
  // Work stack uses _v=1 for "visit" (classify a JSON Schema node) and _v=0
  // for "build" (pop child results and construct the parent Schema).
  type VisitItem = { readonly _v: 1; readonly js: JsonSchemaObject };
  type BuildNullable = { readonly _v: 0; readonly tag: 1 };
  type BuildRecord = { readonly _v: 0; readonly tag: 2 };
  type BuildUnion = { readonly _v: 0; readonly tag: 3; readonly count: number };
  type BuildTuple = { readonly _v: 0; readonly tag: 4; readonly count: number };
  type BuildArray = {
    readonly _v: 0;
    readonly min: number | undefined;
    readonly max: number | undefined;
  };
  type BuildObject = {
    readonly _v: 0;
    readonly tag: 6;
    readonly keys: string[];
    readonly requiredSet: Set<string>;
    readonly addlProps: boolean;
  };
  type WorkItem =
    | VisitItem
    | BuildNullable
    | BuildRecord
    | BuildUnion
    | BuildTuple
    | BuildArray
    | BuildObject;

  const workStack: WorkItem[] = [{ _v: 1, js: root }];
  const results: Schema[] = [];

  while (workStack.length > 0) {
    const item = workStack.pop()!;

    // Build step — pop children from results and construct parent
    if (item._v === 0) {
      if ("tag" in item) {
        switch (item.tag) {
          case 1: // nullable
            results.push(nullable(results.pop()!));
            break;
          case 2: // record
            results.push(record(results.pop()!));
            break;
          case 3: {
            // union
            const schemas: Schema[] = new Array(item.count);
            for (let i = item.count - 1; i >= 0; i--) schemas[i] = results.pop()!;
            results.push(union(...schemas));
            break;
          }
          case 4: {
            // tuple
            const schemas: Schema[] = new Array(item.count);
            for (let i = item.count - 1; i >= 0; i--) schemas[i] = results.pop()!;
            results.push(tuple(...schemas));
            break;
          }
          case 6: {
            // object
            const { keys, requiredSet, addlProps } = item;
            const objProps: Record<string, Schema> = {};
            for (let i = keys.length - 1; i >= 0; i--) {
              const s = results.pop()!;
              objProps[keys[i]] = requiredSet.has(keys[i]) ? s : optional(s);
            }
            results.push(object(objProps, { additionalProperties: addlProps }));
            break;
          }
        }
      } else {
        // BuildArray
        const itemSchema = results.pop()!;
        const hasOpts = item.min !== undefined || item.max !== undefined;
        results.push(
          array(itemSchema, hasOpts ? { minItems: item.min, maxItems: item.max } : undefined),
        );
      }
      continue;
    }

    // Visit step — classify the JSON Schema node
    const js = item.js;

    // const
    if ("const" in js) {
      const v = js.const;
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        results.push(literal(v as string | number | boolean | null));
        continue;
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
      results.push(enum_(...values));
      continue;
    }

    // anyOf → union or nullable
    if ("anyOf" in js && Array.isArray(js.anyOf)) {
      const variants = js.anyOf as JsonSchemaObject[];
      if (
        variants.length === 2 &&
        typeof variants[1] === "object" &&
        variants[1] !== null &&
        (variants[1] as Record<string, unknown>).type === "null"
      ) {
        // Nullable pattern: push build-nullable, then visit inner
        workStack.push({ _v: 0, tag: 1 });
        workStack.push({ _v: 1, js: variants[0] });
        continue;
      }
      // Union: push build-union, then visit all variants (reverse order for LIFO)
      workStack.push({ _v: 0, tag: 3, count: variants.length });
      for (let i = variants.length - 1; i >= 0; i--) {
        workStack.push({ _v: 1, js: variants[i] });
      }
      continue;
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
      results.push(string(hasConstraints ? (c as StringConstraints) : undefined));
      continue;
    }

    if (type === "number" || type === "integer") {
      const c = extractNumberConstraints(js);
      results.push(type === "integer" ? integer(c) : number(c));
      continue;
    }

    if (type === "boolean") {
      results.push(boolean());
      continue;
    }
    if (type === "null") {
      results.push(null_());
      continue;
    }

    if (type === "object") {
      // Record pattern: additionalProperties is a schema object
      if (
        !("properties" in js) &&
        "additionalProperties" in js &&
        typeof js.additionalProperties === "object" &&
        js.additionalProperties !== null
      ) {
        workStack.push({ _v: 0, tag: 2 });
        workStack.push({ _v: 1, js: js.additionalProperties as JsonSchemaObject });
        continue;
      }

      // Object with properties
      const props = (js.properties ?? {}) as Record<string, JsonSchemaObject>;
      const requiredSet = new Set(Array.isArray(js.required) ? (js.required as string[]) : []);
      const keys = Object.keys(props);
      const addlProps = js.additionalProperties === true || js.additionalProperties === undefined;
      // Push build-object first (processed after children), then children in reverse
      workStack.push({ _v: 0, tag: 6, keys, requiredSet, addlProps });
      for (let i = keys.length - 1; i >= 0; i--) {
        workStack.push({ _v: 1, js: props[keys[i]] });
      }
      continue;
    }

    if (type === "array") {
      // Tuple pattern: prefixItems + items: false
      if ("prefixItems" in js && Array.isArray(js.prefixItems)) {
        const items = js.prefixItems as JsonSchemaObject[];
        workStack.push({ _v: 0, tag: 4, count: items.length });
        for (let i = items.length - 1; i >= 0; i--) {
          workStack.push({ _v: 1, js: items[i] });
        }
        continue;
      }

      // Array with items
      if ("items" in js && typeof js.items === "object" && js.items !== null) {
        const min = "minItems" in js ? (js.minItems as number) : undefined;
        const max = "maxItems" in js ? (js.maxItems as number) : undefined;
        workStack.push({ _v: 0, min, max });
        workStack.push({ _v: 1, js: js.items as JsonSchemaObject });
        continue;
      }

      return err("array schema without items is not supported");
    }

    return err("unsupported JSON Schema: " + JSON.stringify(js).slice(0, 100));
  }

  return ok(results[0]);
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

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
  // Reuse a single Set across candidate keys — clear per iteration to avoid
  // allocating a new Set for each key.
  const seen = new Set<string | number | boolean | null>();
  outer: for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    seen.clear();
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
