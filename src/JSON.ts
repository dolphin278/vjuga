import { Fn1 } from "./FunctionUtils.js";

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | Array<JSONValue>;

export type JSONObject = { [key: string | number]: JSONValue };

export const stringify: Fn1<JSONValue, string> = JSON.stringify;

/**
 * While being just an alias for JSON.parse, this function
 * returns `JSONValue` instead of `any`, that forces consumer to actually
 * check the type of the result during runtime.
 */
export const parseExn: Fn1<string, JSONValue> = JSON.parse;

export const parse: Fn1<string, JSONValue | undefined> = (json) => {
  try {
    return parseExn(json);
  } catch {
    return undefined;
  }
};
