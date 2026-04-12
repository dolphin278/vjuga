/**
 * ValidationError — structured validation failure with path tracking.
 *
 * Shared by the closure-based Validator module and branded-type modules
 * (UUID, ISOTimestamp, UnixTimestamp). Extracted to its own module so
 * consumers can depend on the error type without pulling in the full
 * Validator combinator library.
 *
 * @example
 * ```ts
 * import { ValidationError, type Validator } from "vjuga/ValidationError";
 * const v: Validator<string> = (value) =>
 *   typeof value === "string" ? ok(value) : err(new ValidationError("string", value));
 * ```
 */

import type { Result } from "./Result.js";

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
