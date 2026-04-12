/**
 * ValidationError — structured validation failure with path tracking.
 *
 * Used by branded-type modules (UUID, ISOTimestamp, UnixTimestamp) that define
 * their own validators returning `Result<T, ValidationError>`.
 *
 * When to use: building custom validators that return `Result<T, ValidationError>`.
 * For schema-based validation, use `schema/Validate` which has its own
 * `SchemaError` (plain object, cheaper to construct than Error subclass).
 *
 * @example Custom validator function
 * ```ts
 * import { ValidationError, type Validator } from "vjuga/schema/ValidationError";
 * import { ok, err } from "vjuga/Result";
 * const isEmail: Validator<string> = (value) => {
 *   if (typeof value !== "string") return err(new ValidationError("email string", value));
 *   if (!value.includes("@")) return err(new ValidationError("valid email", value));
 *   return ok(value);
 * };
 * ```
 *
 * @example Error structure — path tracks nested field location
 * ```ts
 * const e = new ValidationError("string", 42, "user.name");
 * e.message;  // 'Validation failed at "user.name": expected string, got number'
 * e.path;     // "user.name"
 * e.expected; // "string"
 * e.received; // 42
 * ```
 *
 * Pitfalls:
 *   - `ValidationError` extends `Error` — it allocates a stack trace.
 *     For hot-path validation, prefer `schema/Validate` which uses plain
 *     `SchemaError` objects (no stack trace, ~10x cheaper to construct).
 *   - `path` is a dot-separated string, not an array. Empty string means
 *     the root value failed. Numeric indices appear as `"items.0.name"`.
 */

import type { Result } from "../Result.js";

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

/** A validator maps an unknown value to a typed Result. */
export type Validator<T> = (value: unknown) => Result<T, ValidationError>;
