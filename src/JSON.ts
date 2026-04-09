/**
 * JSON — typed JSON parsing with prototype-pollution protection.
 *
 * Wraps native `JSON.parse` / `JSON.stringify` with a `JSONValue` return type
 * that is narrower than `any` (forces runtime type checking) yet broader than
 * `unknown` (reflects the actual JSON value space).
 *
 * When to use: `safeParse` for untrusted external input — it strips `__proto__`
 * and `constructor` keys via an explicit stack walk to prevent prototype
 * poisoning. `parseExn` / `parse` for trusted sources where prototype pollution
 * is not a concern.
 *
 * Prior art: Matteo Collina's `secure-json-parse` (Fastify) — prototype
 * pollution via `__proto__` in parsed JSON is a well-known attack vector.
 *
 * @example
 * ```ts
 * import * as JSON from "vjuga/JSON";
 * const result = JSON.safeParse('{"a":1}');     // Ok<JSONValue>
 * const value  = JSON.parse('{"a":1}');         // JSONValue | undefined
 * const str    = JSON.stringify({ a: 1 });      // string
 * ```
 */

import type { Result } from "./Result.js";
import { ok, err } from "./Result.js";

export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
export type JSONArray = Array<JSONValue>;
export type JSONObject = { [key: string]: JSONValue };

/**
 * Alias for JSON.stringify.
 */
export const stringify = JSON.stringify;

/**
 * While being just an alias for JSON.parse, this function
 * returns `JSONValue` instead of `any`, that forces consumer to actually
 * check the type of the result during runtime.
 *
 * At the same time, JSONValue is more concrete than `unknown`, because
 * JSON.parse can only return a subset of all possible JavaScript values.
 */
export const parseExn = (str: string): JSONValue => JSON.parse(str) as JSONValue;

/**
 * Safe version of JSON.parse that returns `undefined` in case parsing fails.
 */
export const parse = (json: string): JSONValue | undefined => {
  try {
    return parseExn(json);
  } catch {
    return undefined;
  }
};

/**
 * Scans a parsed JSON value for prototype-poisoning keys (`__proto__`,
 * `constructor`) and strips them in-place.
 *
 * Returns `true` if any dangerous key was found (and removed), `false`
 * otherwise. Walks the full value tree using an explicit stack to avoid
 * call-stack depth issues on deeply nested payloads and to keep the hot
 * path free of recursive closures.
 *
 * Inspired by Matteo Collina's `secure-json-parse` — prototype pollution
 * via `__proto__` in parsed JSON is a well-known attack vector (OWASP).
 */
function stripDangerousKeys(value: JSONValue): boolean {
  let found = false;
  // Explicit stack avoids recursion — no closure per frame, no stack overflow
  // on deeply nested inputs.
  const stack: JSONValue[] = [value];
  let current: JSONValue | undefined;
  while ((current = stack.pop()) !== undefined) {
    if (current === null || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        stack.push(current[i]);
      }
    } else {
      const keys = Object.keys(current);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__" || key === "constructor") {
          found = true;
          delete (current as Record<string, unknown>)[key];
        } else {
          stack.push(current[key]);
        }
      }
    }
  }
  return found;
}

/**
 * Parses JSON with prototype-pollution protection.
 *
 * Strips `__proto__` and `constructor` keys from the parsed value tree to
 * prevent prototype poisoning attacks. Returns `Result<JSONValue, string>`:
 * - `Ok` with the sanitized value on success
 * - `Err` with an error message on invalid JSON
 *
 * Inspired by `secure-json-parse` (Matteo Collina / Fastify).
 */
export const safeParse = (json: string): Result<JSONValue, string> => {
  try {
    const value = JSON.parse(json) as JSONValue;
    stripDangerousKeys(value);
    return ok(value);
  } catch {
    return err("invalid JSON");
  }
};
