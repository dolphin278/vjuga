/**
 * JSON — typed JSON parsing; `safeParse` adds prototype-pollution protection.
 *
 * Wraps native `JSON.parse` / `JSON.stringify` with a `JSONValue` return type
 * that is narrower than `any` (forces runtime type checking) yet broader than
 * `unknown` (reflects the actual JSON value space).
 *
 * Security split — pick by trust level, not by return type:
 * - `safeParse` (untrusted input) handles `__proto__` / `constructor` keys,
 *   including `\u`-escaped spellings: strips them by default, or reports them
 *   as `Err` with `{ onDangerousKey: "reject" }`. Syntax errors become `Err`
 *   with the engine's diagnostic.
 * - `parse` / `parseExn` are plain `JSON.parse` with NO key filtering: the
 *   document comes back exactly as written. Use them for trusted sources, or
 *   when your own validator must see every key.
 *
 * Prior art: Matteo Collina's `secure-json-parse` (Fastify) — prototype
 * pollution via `__proto__` in parsed JSON is a well-known attack vector.
 *
 * @example
 * ```ts
 * import * as JSON from "@dolphin278/vjuga/JSON";
 * JSON.safeParse('{"a":1,"__proto__":{}}');   // Ok({ a: 1 }) — stripped
 * JSON.safeParse('{"__proto__":{}}', { onDangerousKey: "reject" }); // Err
 * JSON.safeParse("{");                        // Err("invalid JSON: …")
 * JSON.parse('{"__proto__":{}}');             // kept as an own key
 * const str = JSON.stringify({ a: 1 });       // string
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
 * Plain `JSON.parse` (throws `SyntaxError` on invalid input). Does NOT strip or
 * report `__proto__` / `constructor` keys — use `safeParse` for untrusted input.
 *
 * While being just an alias for JSON.parse, this function
 * returns `JSONValue` instead of `any`, that forces consumer to actually
 * check the type of the result during runtime.
 *
 * At the same time, JSONValue is more concrete than `unknown`, because
 * JSON.parse can only return a subset of all possible JavaScript values.
 */
export const parseExn = (str: string): JSONValue => JSON.parse(str) as JSONValue;

/**
 * `JSON.parse` that returns `undefined` instead of throwing on invalid input.
 * "Safe" refers to the absence of exceptions only: like `parseExn` it does NOT
 * strip or report `__proto__` / `constructor` keys, so the document is
 * returned exactly as written. Use `safeParse` for untrusted input.
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
export function stripDangerousKeys(value: JSONValue): boolean {
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
 * Walks a parsed JSON value (without mutating it) and returns the first
 * prototype-poisoning key (`__proto__` or `constructor`) it finds, or
 * `undefined` when there is none. Same key set and traversal as
 * `stripDangerousKeys`.
 */
export function findDangerousKey(value: JSONValue): string | undefined {
  const stack: JSONValue[] = [value];
  let current: JSONValue | undefined;
  while ((current = stack.pop()) !== undefined) {
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) stack.push(current[i]);
    } else {
      const keys = Object.keys(current);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__" || key === "constructor") return key;
        stack.push(current[key]);
      }
    }
  }
  return undefined;
}

/** What `safeParse` does with a `__proto__` / `constructor` key. */
export type DangerousKeyPolicy = "strip" | "reject" | "keep";

/** Options for `safeParse`. */
export interface SafeParseOptions {
  /**
   * - `"strip"` (default): delete every dangerous key in place, return `Ok`.
   * - `"reject"`: return `Err` naming the first dangerous key found; the
   *   document is not modified. Use when a downstream validator must see
   *   poisoned input.
   * - `"keep"`: leave the keys in place (same document as `parse`, but with
   *   `Result` errors). Unknown values behave like `"strip"`.
   */
  readonly onDangerousKey?: DangerousKeyPolicy;
}

/**
 * Parses untrusted JSON with prototype-pollution protection, returning
 * `Result<JSONValue, string>`:
 * - `Ok` with the value (dangerous keys handled per `options.onDangerousKey`,
 *   default `"strip"`).
 * - `Err("invalid JSON: <engine message>")` on a syntax error. The detail
 *   text comes from the engine and differs between V8 and JavaScriptCore;
 *   match on the `"invalid JSON"` prefix only.
 * - `Err('dangerous JSON key "__proto__" …')` with `onDangerousKey: "reject"`.
 *
 * The key set is exactly `__proto__` and `constructor` (not `prototype`,
 * which cannot poison `Object.prototype` on its own); `\u`-escaped spellings
 * are caught because the check runs on the parsed value.
 *
 * Fast path: scans the raw JSON string for `__proto__`, `constructor` and any
 * `\u` escape (which can spell either token) before walking. If none is
 * present (the common case for real-world payloads), the tree walk is skipped
 * entirely and `options` is never read. False positives (the token appears as
 * a value) trigger the walk but produce correct results.
 *
 * @example
 * ```ts
 * import { safeParse } from "@dolphin278/vjuga/JSON";
 * safeParse('{"constructor":1,"a":2}');                             // [true, { a: 2 }]
 * safeParse('{"constructor":1}', { onDangerousKey: "reject" });     // [false, 'dangerous JSON key "constructor" …']
 * ```
 */
export function safeParse(json: string, options?: SafeParseOptions): Result<JSONValue, string> {
  let value: JSONValue;
  try {
    value = JSON.parse(json) as JSONValue;
  } catch (e) {
    return err("invalid JSON: " + (e instanceof Error ? e.message : String(e)));
  }
  // Fast path: skip tree walk when no dangerous tokens exist in the source.
  // indexOf is O(n) but with SIMD acceleration it's far cheaper than
  // Object.keys + iteration on every parsed object node.
  // A \u escape can spell either token ("\u005f_proto__"), which the raw-text scan
  // cannot see, so any \u in the source forces the walk too.
  if (
    json.indexOf(PROTO_TOKEN) !== -1 ||
    json.indexOf(CONSTRUCTOR_TOKEN) !== -1 ||
    json.indexOf(ESCAPE_TOKEN) !== -1
  ) {
    const policy = options?.onDangerousKey;
    if (policy === "reject") {
      const key = findDangerousKey(value);
      if (key !== undefined) {
        return err(`dangerous JSON key "${key}" (prototype-pollution risk)`);
      }
    } else if (policy !== "keep") {
      stripDangerousKeys(value);
    }
  }
  return ok(value);
}

const PROTO_TOKEN = "__proto__";
const CONSTRUCTOR_TOKEN = "constructor";
const ESCAPE_TOKEN = "\\u";

// ---------------------------------------------------------------------------
// JSON string escaping — shared by src/JSON.ts and schema/JSON.ts
// ---------------------------------------------------------------------------

// Pre-computed escape table for control characters (0x00-0x1f)
const ESCAPE_TABLE: string[] = [];
for (let i = 0; i < 32; i++) {
  ESCAPE_TABLE[i] = "\\u" + i.toString(16).padStart(4, "0");
}
ESCAPE_TABLE[0x08] = "\\b";
ESCAPE_TABLE[0x09] = "\\t";
ESCAPE_TABLE[0x0a] = "\\n";
ESCAPE_TABLE[0x0c] = "\\f";
ESCAPE_TABLE[0x0d] = "\\r";

/**
 * Escape a string for JSON output. Adds surrounding quotes.
 * Short strings (<128 chars): manual charCode scan (avoids JSON.stringify overhead).
 * Long strings: delegate to JSON.stringify (V8 SIMD-accelerated).
 */
export function escapeJsonString(s: string): string {
  const len = s.length;
  if (len < 128) {
    let out = '"';
    let last = 0;
    for (let i = 0; i < len; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        out += s.slice(last, i) + '\\"';
        last = i + 1;
      } else if (c === 0x5c) {
        out += s.slice(last, i) + "\\\\";
        last = i + 1;
      } else if (c < 0x20) {
        out += s.slice(last, i) + ESCAPE_TABLE[c];
        last = i + 1;
      } else if (c >= 0xd800 && c <= 0xdfff) {
        // Valid surrogate pair: high (D800-DBFF) followed by low (DC00-DFFF).
        // Emit the pair unescaped — only lone surrogates need escaping (RFC 8259 §8).
        if (c <= 0xdbff && i + 1 < len) {
          const next = s.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            i++; // skip the low surrogate — the pair is valid
            continue;
          }
        }
        out += s.slice(last, i) + "\\u" + c.toString(16);
        last = i + 1;
      }
    }
    if (last === 0) return '"' + s + '"';
    return out + s.slice(last) + '"';
  }
  // Long strings: delegate to JSON.stringify (V8 SIMD-accelerated, handles surrogates)
  return JSON.stringify(s);
}
