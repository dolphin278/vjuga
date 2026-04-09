/**
 * Validator — parser-combinator–style runtime type validation.
 *
 * Each validator is a pure function of type:
 *
 *   (value: unknown) => Result<T, ValidationError>
 *
 * Validators compose via `object`, `array`, `union`, `map`, etc., and integrate
 * naturally with the Result module — no exceptions are used for control flow.
 *
 * Performance note: the combinator approach builds a composition of closures.
 * V8 will inline and specialize hot call sites, but for deeply nested schemas
 * the call chain remains multiple function calls. If throughput under sustained
 * load becomes a bottleneck, the same public API can be accelerated by adding
 * an optional `compile(validator)` step that emits a `new Function(...)` check —
 * without changing any caller code.
 */

import { type Result, ok, err } from "./Result.js";
import type {
  PositiveNumber,
  Integer,
  PositiveInteger,
  NonNegativeInteger,
} from "./FunctionUtils.js";

// Cached at module level so every `for...in` call site in this file goes
// through the same function reference — keeps V8 ICs monomorphic regardless of
// the shape of the object being iterated.
const hasOwnProp = Object.prototype.hasOwnProperty;

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

/**
 * Error thrown (or returned as Err) when validation fails.
 *
 * `path` is a dot-separated string of the keys traversed to reach the failing
 * field (e.g. `"user.address.zip"`). An empty string means the root value
 * failed validation.
 */
export class ValidationError extends Error {
  readonly path: string;
  readonly expected: string;
  readonly received: unknown;

  constructor(expected: string, received: unknown, path = "") {
    const location = path === "" ? "value" : `"${path}"`;
    super(
      `Validation failed at ${location}: expected ${expected}, got ${formatReceived(received)}`,
    );
    this.name = "ValidationError";
    this.path = path;
    this.expected = expected;
    this.received = received;
  }
}

function formatReceived(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function rerootError(e: ValidationError, parentPath: string | number): ValidationError {
  /* c8 ignore next 2 -- empty-string parentPath would produce a leading-dot path, but no caller passes ""; kept as a safety guard */
  if (parentPath === "") return e;
  const childPath = e.path === "" ? String(parentPath) : `${parentPath}.${e.path}`;
  return new ValidationError(e.expected, e.received, childPath);
}

// ---------------------------------------------------------------------------
// Validator type
// ---------------------------------------------------------------------------

/** A validator maps an unknown value to a typed Result. */
export type Validator<T> = (value: unknown) => Result<T, ValidationError>;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const _stringValidator: Validator<string> = function validateString(
  value: unknown,
): Result<string, ValidationError> {
  if (typeof value === "string") return ok(value);
  return err(new ValidationError("string", value));
};

/** Validates that `value` is a `string`. */
export function string(): Validator<string> {
  return _stringValidator;
}

const _numberValidator: Validator<number> = function validateNumber(
  value: unknown,
): Result<number, ValidationError> {
  if (typeof value === "number" && !Number.isNaN(value)) return ok(value);
  return err(new ValidationError("number", value));
};

/** Validates that `value` is a `number` (and not NaN). */
export function number(): Validator<number> {
  return _numberValidator;
}

const _booleanValidator: Validator<boolean> = function validateBoolean(
  value: unknown,
): Result<boolean, ValidationError> {
  if (typeof value === "boolean") return ok(value);
  return err(new ValidationError("boolean", value));
};

/** Validates that `value` is a `boolean`. */
export function boolean(): Validator<boolean> {
  return _booleanValidator;
}

const _nullValidator: Validator<null> = function validateNull(
  value: unknown,
): Result<null, ValidationError> {
  if (value === null) return ok(null);
  return err(new ValidationError("null", value));
};

/** Validates that `value` is `null`. */
export function null_(): Validator<null> {
  return _nullValidator;
}

const _undefinedValidator: Validator<undefined> = function validateUndefined(
  value: unknown,
): Result<undefined, ValidationError> {
  if (value === undefined) return ok(undefined);
  return err(new ValidationError("undefined", value));
};

/** Validates that `value` is `undefined`. */
export function undefined_(): Validator<undefined> {
  return _undefinedValidator;
}

/** Validates that `value` is strictly equal to the given literal. */
export function literal<const T extends string | number | boolean | null | undefined>(
  expected: T,
): Validator<T> {
  const label = JSON.stringify(expected);
  return function validateLiteral(value: unknown): Result<T, ValidationError> {
    if (value === expected) return ok(value as T);
    return err(new ValidationError(label, value));
  };
}

/** Validates that `value` is a positive number (> 0, not NaN). */
export function positiveNumber(): Validator<PositiveNumber> {
  return function validatePositiveNumber(value: unknown): Result<PositiveNumber, ValidationError> {
    if (typeof value === "number" && value > 0) return ok(value as PositiveNumber);
    return err(new ValidationError("positive number", value));
  };
}

/** Validates that `value` is a safe integer. */
export function integer(): Validator<Integer> {
  return function validateInteger(value: unknown): Result<Integer, ValidationError> {
    if (typeof value === "number" && Number.isSafeInteger(value)) return ok(value as Integer);
    return err(new ValidationError("integer", value));
  };
}

/** Validates that `value` is a positive safe integer (>= 1). */
export function positiveInteger(): Validator<PositiveInteger> {
  return function validatePositiveInteger(
    value: unknown,
  ): Result<PositiveInteger, ValidationError> {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1)
      return ok(value as PositiveInteger);
    return err(new ValidationError("positive integer", value));
  };
}

/** Validates that `value` is a non-negative safe integer (>= 0). */
export function nonNegativeInteger(): Validator<NonNegativeInteger> {
  return function validateNonNegativeInteger(
    value: unknown,
  ): Result<NonNegativeInteger, ValidationError> {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return ok(value as NonNegativeInteger);
    return err(new ValidationError("non-negative integer", value));
  };
}

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

/** Shape map for `object()` — maps keys to their validators. */
export type Shape<T> = { [K in keyof T]: Validator<T[K]> };

/**
 * Validates that `value` is a non-null object and that each key in `shape`
 * passes its corresponding validator. Extra keys are allowed (open object).
 */
export function object<T extends object>(shape: Shape<T>): Validator<T> {
  const keys = Object.keys(shape) as (keyof T & string)[];
  return function validateObject(value: unknown): Result<T, ValidationError> {
    if (value === null || typeof value !== "object") {
      return err(new ValidationError("object", value));
    }
    const record = value as Record<string, unknown>;
    const out = {} as T;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const result = Reflect.apply(shape[key], undefined, [record[key]]);
      if (!result[0]) {
        const ve = result[1] as ValidationError;
        return err(rerootError(ve, key));
      }
      (out as Record<string, unknown>)[key] = result[1];
    }
    return ok(out);
  };
}

/**
 * Validates that `value` is an array and that every element passes
 * `elementValidator`.
 */
export function array<T>(elementValidator: Validator<T>): Validator<T[]> {
  return function validateArray(value: unknown): Result<T[], ValidationError> {
    if (!Array.isArray(value)) {
      return err(new ValidationError("array", value));
    }
    const out: T[] = Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const result = Reflect.apply(elementValidator, undefined, [value[i]]);
      if (!result[0]) {
        const ve = result[1] as ValidationError;
        return err(rerootError(ve, i));
      }
      out[i] = result[1] as T;
    }
    return ok(out);
  };
}

/**
 * Validates that `value` is a non-null object and that every value in it
 * passes `valueValidator`. Keys are unconstrained strings.
 */
export function record<V>(valueValidator: Validator<V>): Validator<Record<string, V>> {
  return function validateRecord(value: unknown): Result<Record<string, V>, ValidationError> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return err(new ValidationError("object", value));
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, V> = {} as Record<string, V>;
    for (const key in record) {
      if (!hasOwnProp.call(record, key)) continue;
      const result = Reflect.apply(valueValidator, undefined, [record[key]]);
      if (!result[0]) {
        const ve = result[1] as ValidationError;
        return err(rerootError(ve, key));
      }
      out[key] = result[1] as V;
    }
    return ok(out);
  };
}

/** Infers the output type of a tuple of Validators. */
export type TupleOutput<T extends readonly Validator<unknown>[]> = {
  [K in keyof T]: T[K] extends Validator<infer U> ? U : never;
};

/**
 * Validates a fixed-length tuple, applying each validator to the corresponding
 * index.
 */
export function tuple<T extends readonly Validator<unknown>[]>(
  validators: T,
): Validator<TupleOutput<T>> {
  return function validateTuple(value: unknown): Result<TupleOutput<T>, ValidationError> {
    if (!Array.isArray(value)) {
      return err(new ValidationError(`tuple[${validators.length}]`, value));
    }
    if (value.length !== validators.length) {
      return err(new ValidationError(`tuple[${validators.length}]`, value));
    }
    const out: unknown[] = Array(validators.length);
    for (let i = 0; i < validators.length; i++) {
      const result = Reflect.apply(validators[i], undefined, [value[i]]);
      if (!result[0]) {
        const ve = result[1] as ValidationError;
        return err(rerootError(ve, i));
      }
      out[i] = result[1];
    }
    return ok(out as TupleOutput<T>);
  };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/** Wraps a validator to also accept `undefined`. */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return function validateOptional(value: unknown): Result<T | undefined, ValidationError> {
    if (value === undefined) return ok(undefined);
    return Reflect.apply(validator, undefined, [value]) as Result<T | undefined, ValidationError>;
  };
}

/** Wraps a validator to also accept `null`. */
export function nullable<T>(validator: Validator<T>): Validator<T | null> {
  return function validateNullable(value: unknown): Result<T | null, ValidationError> {
    if (value === null) return ok(null);
    return Reflect.apply(validator, undefined, [value]) as Result<T | null, ValidationError>;
  };
}

/** Infers the output type of a union of Validators. */
export type UnionOutput<T extends readonly Validator<unknown>[]> =
  T[number] extends Validator<infer U> ? U : never;

/**
 * Tries each validator in order and returns the first Ok result.
 * Returns an Err describing all failed attempts if none succeed.
 */
export function union<T extends readonly Validator<unknown>[]>(
  validators: T,
): Validator<UnionOutput<T>> {
  return function validateUnion(value: unknown): Result<UnionOutput<T>, ValidationError> {
    for (let i = 0; i < validators.length; i++) {
      const result = Reflect.apply(validators[i], undefined, [value]);
      if (result[0]) return result as Result<UnionOutput<T>, ValidationError>;
    }
    return err(new ValidationError(`union(${validators.length} variants)`, value));
  };
}

/**
 * Transforms the Ok value of a successful validation.
 * Errors pass through unchanged.
 *
 * Useful for parsing (e.g., converting a validated date string to a Date):
 * ```ts
 * const dateValidator = Validator.map(Validator.string(), (s) => new Date(s));
 * ```
 */
export function map<T, U>(validator: Validator<T>, fn: (value: T) => U): Validator<U> {
  return function validateMapped(value: unknown): Result<U, ValidationError> {
    const result = Reflect.apply(validator, undefined, [value]) as Result<T, ValidationError>;
    if (!result[0]) return result as unknown as Result<U, ValidationError>;
    return ok(Reflect.apply(fn, undefined, [result[1]]) as U);
  };
}

/**
 * Converts a `Validator<T>` into a TypeScript type-guard function.
 *
 * ```ts
 * const isUser = Validator.toGuard(userValidator);
 * if (isUser(value)) { // value is User here }
 * unknowns.filter(isUser); // → User[]
 * ```
 */
export function toGuard<T>(validator: Validator<T>): (value: unknown) => value is T {
  return function isT(value: unknown): value is T {
    return (Reflect.apply(validator, undefined, [value]) as Result<T, ValidationError>)[0];
  };
}

/**
 * Converts a `Validator<T>` into a TypeScript assertion function.
 * Throws the `ValidationError` directly when validation fails.
 *
 * ```ts
 * const assertUser = Validator.toAssertion(userValidator);
 * assertUser(value); // throws ValidationError if invalid
 * // value is narrowed to User here
 * ```
 */
export function toAssertion<T>(validator: Validator<T>): (value: unknown) => asserts value is T {
  return function assertT(value: unknown): asserts value is T {
    const result = Reflect.apply(validator, undefined, [value]) as Result<T, ValidationError>;
    if (!result[0]) throw result[1];
  };
}
