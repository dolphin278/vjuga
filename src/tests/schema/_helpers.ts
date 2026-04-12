import type { SchemaError } from "../../schema/Validate.js";
import type { Result } from "../../Result.js";

export function assertOk<T>(r: Result<T, SchemaError>): T {
  /* node:coverage ignore next 2 */
  if (!r[0]) throw new Error(`Expected Ok but got Err: ${JSON.stringify(r[1])}`);
  return r[1];
}

export function assertErr(r: Result<unknown, SchemaError>): SchemaError {
  /* node:coverage ignore next 2 */
  if (r[0]) throw new Error("Expected Err but got Ok");
  return r[1];
}
