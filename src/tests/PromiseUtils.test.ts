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
  const map: Map<string, string | Promise<number>> = new Map<string, string | Promise<number>>([
    ["a", Promise.resolve(1)],
    ["b", Promise.resolve(2)],
    ["c", "asdf"],
  ]);

  const result = await propsMap(map);

  assert.deepStrictEqual(
    result,
    new Map<string, string | number>([
      ["a", 1],
      ["b", 2],
      ["c", "asdf"],
    ]),
  );
});

test("PromiseUtils.props ignores inherited keys and includes own symbol keys", async () => {
  const sym = Symbol("s");
  const proto = { inherited: Promise.resolve(0) };
  const obj = Object.create(proto) as Record<string | symbol, unknown>;
  obj.a = Promise.resolve(1);
  obj[sym] = Promise.resolve(2);
  Object.defineProperty(obj, "hidden", { value: 3, enumerable: false });

  const result = (await props(obj)) as Record<string | symbol, unknown>;
  assert.equal(result.a, 1);
  assert.equal(result[sym], 2);
  assert.equal("inherited" in result, false);
  assert.equal("hidden" in result, false);
  assert.equal(Object.getPrototypeOf(result), null);
});
