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
  /**
   * @type {Map<string,  string | Promise<number>>}
   */
  const map = new Map(
    /** @type {[string, string | Promise<number>][]} */ ([
      ["a", Promise.resolve(1)],
      ["b", Promise.resolve(2)],
      ["c", "asdf"],
    ]),
  );

  const result = await propsMap(map);

  assert.deepStrictEqual(
    result,
    new Map(
      /** @type {[string, (string | number)][]} */ ([
        ["a", 1],
        ["b", 2],
        ["c", "asdf"],
      ]),
    ),
  );
});
