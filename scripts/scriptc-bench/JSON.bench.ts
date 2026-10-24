// stringify and parse call the engine's JSON: V8 (Node), JavaScriptCore (Bun),
// scriptc's own runtime (native).
import { bench } from "./harness.js";
import * as JSONx from "../../src/JSON.js";
import { isOk } from "../../src/Result.js";

const text = '{"id":1,"name":"ada","tags":["a","b"],"nested":{"x":1.5,"y":null}}';
const value = { id: 1, name: "ada", tags: ["a", "b"], nested: { x: 1.5, y: null } };

bench("safeParse (70 B object)", (i) => (isOk(JSONx.safeParse(text)) ? 1 + (i & 1) : 0));
bench("stringify (70 B object)", (i) => JSONx.stringify(value).length + (i & 1));
bench("escapeJsonString (12 chars)", (i) =>
  JSONx.escapeJsonString('say "hi"\n\tok').length + (i & 1));
