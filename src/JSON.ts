export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;
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
export const parseExn = (str: string): JSONValue =>
  JSON.parse(str) as JSONValue;

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
