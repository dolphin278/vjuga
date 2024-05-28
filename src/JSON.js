/**
 * @template {readonly unknown[]} T
 * @typedef {import("./FunctionUtils.js").Fn1<T>} Fn1<T>
 */

/**
 * @typedef {string | number | boolean | null | JSONObject | JSONArray} JSONValue
 * @typedef {Array<JSONValue>} JSONArray
 * @typedef {{[key: string | number]: JSONValue}} JSONObject
 */

/**
 * @param {JSONValue} value
 * @returns {string}
 */
export const stringify = JSON.stringify;

/**
 * While being just an alias for JSON.parse, this function
 * returns `JSONValue` instead of `any`, that forces consumer to actually
 * check the type of the result during runtime.
 *
 * At the same time, JSONValue is more concrete than `unknown`, because
 * JSON.parse can only return a subset of all possible JavaScript values.
 *
 * @param {string} json
 * @returns {JSONValue}
 */
export const parseExn = JSON.parse;

/**
 * Safe version of JSON.parse that returns `undefined` in case parsing fails.
 *
 * @param {string} json
 * @returns {JSONValue | undefined}
 */
export const parse = (json) => {
  try {
    return parseExn(json);
  } catch {
    return undefined;
  }
};
