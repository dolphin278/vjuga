import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as TU from "../TaggedUnion.js";

// ---------------------------------------------------------------------------
// Type aliases used across tests
// ---------------------------------------------------------------------------

type Shape = TU.TaggedUnion<{
  circle: { radius: number };
  square: { side: number };
  point: undefined;
}>;

// Helper — receives the full union type, preventing local narrowing.
function computeArea(s: Shape): number {
  return TU.match(s, {
    circle: (v) => Math.PI * v.radius ** 2,
    square: (v) => v.side ** 2,
    point: () => 0,
  });
}

function describeShape(s: Shape): string {
  if (TU.is(s, "circle")) return `circle:${s.value.radius}`;
  if (TU.is(s, "square")) return `square:${s.value.side}`;
  return "point";
}

// --- variant ---

test("variant() constructs a { tag, value } object", () => {
  const v = TU.variant("circle", { radius: 5 });
  assert.equal(v.tag, "circle");
  assert.deepEqual(v.value, { radius: 5 });
});

test("variant() with undefined value", () => {
  const v = TU.variant("point", undefined);
  assert.equal(v.tag, "point");
  assert.equal(v.value, undefined);
});

test("variant() with numeric tag", () => {
  const v = TU.variant(0, "hello");
  assert.equal(v.tag, 0);
  assert.equal(v.value, "hello");
});

test("variant() with symbol tag", () => {
  const sym = Symbol("test");
  const v = TU.variant(sym, 42);
  assert.equal(v.tag, sym);
  assert.equal(v.value, 42);
});

// --- match ---

test("match() dispatches to the correct handler — circle", () => {
  const area = computeArea(TU.variant("circle", { radius: 3 }));
  assert.equal(area, Math.PI * 9);
});

test("match() dispatches to the correct handler — square", () => {
  const area = computeArea(TU.variant("square", { side: 4 }));
  assert.equal(area, 16);
});

test("match() dispatches to the correct handler — point", () => {
  const area = computeArea(TU.variant("point", undefined));
  assert.equal(area, 0);
});

test("match() returns the handler's return value", () => {
  const label = TU.match(TU.variant("circle", { radius: 7 }), {
    circle: (c) => `r=${c.radius}`,
  });
  assert.equal(label, "r=7");
});

// --- is ---

test("is() returns true for matching tag", () => {
  assert.equal(describeShape(TU.variant("circle", { radius: 1 })), "circle:1");
});

test("is() returns false for non-matching tag", () => {
  assert.equal(describeShape(TU.variant("square", { side: 10 })), "square:10");
});

test("is() narrows the type so value fields are accessible", () => {
  assert.equal(describeShape(TU.variant("point", undefined)), "point");
});

test("is() narrows correctly in conditional chain", () => {
  const s: Shape = TU.variant("square", { side: 5 }) as Shape;
  assert.equal(TU.is(s, "circle"), false);
  assert.equal(TU.is(s, "square"), true);
  assert.equal(TU.is(s, "point"), false);
});
