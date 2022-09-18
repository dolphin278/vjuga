import { props, propsMap } from "../PromiseUtils.js";
import { test } from "node:test";
import * as assert from "node:assert";

test("PromiseUtils.props", async () => {
  const result = await props({
    a: Promise.resolve(1),
    b: Promise.resolve(2),
    c: "asdf",
  });

  assert.deepEqual(result, {
    a: 1,
    b: 2,
    c: "asdf",
  });
});

test("PromiseUtils.propsMap", async () => {
  const result = await propsMap(
    new Map<string, Promise<number> | string>([
      ["a", Promise.resolve(1)],
      ["b", Promise.resolve(2)],
      ["c", "asdf"],
    ])
  );

  assert.deepStrictEqual(
    result,
    new Map<string, string | number>([
      ["a", 1],
      ["b", 2],
      ["c", "asdf"],
    ])
  );
});
