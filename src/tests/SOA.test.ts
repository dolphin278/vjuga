import { test } from "node:test";
import * as SOA from "../SOA.js";
import * as assert from "node:assert/strict";

test("SOA-push", () => {
  const soa: { x: number[]; y: number[] } = {
    x: [],
    y: [],
  };

  SOA.push(soa, { x: 1, y: 2 });
  SOA.push(soa, { x: 3, y: 4 });
  SOA.push(soa, { x: 5, y: 6 });

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });
});

test("SOA-pop", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const { x, y } = SOA.pop(soa);

  assert.deepEqual(soa, {
    x: [1, 3],
    y: [2, 4],
  });

  assert.deepEqual({ x, y }, { x: 5, y: 6 });
});

test("SOA-get", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const { x, y } = SOA.get(soa, 1);

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.deepEqual({ x, y }, { x: 3, y: 4 });
});

test("SOA-set", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  SOA.set(soa, 1, { x: 7, y: 8 });

  assert.deepEqual(soa, {
    x: [1, 7, 5],
    y: [2, 8, 6],
  });
});

test("SOA-getSlice", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const x = SOA.getSlice(soa, "x");

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.deepEqual(x, [1, 3, 5]);
});

test("SOA-createView", () => {
  const soa = {
    x: [1, 3, 5],
    y: [2, 4, 6],
  };

  const view = SOA.createView(soa, 1);

  assert.deepEqual(soa, {
    x: [1, 3, 5],
    y: [2, 4, 6],
  });

  assert.equal(view.x, 3);
  assert.equal(view.y, 4);
  assert.equal(view.index, 1);

  view.x = 7;
  view.y = 8;

  assert.deepEqual(soa, {
    x: [1, 7, 5],
    y: [2, 8, 6],
  });

  view.index = 2;

  assert.equal(view.x, 5);
  assert.equal(view.y, 6);
});

test("SOA-length", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  assert.equal(SOA.length(soa), 3);

  SOA.push(soa, { x: 7, y: 8 });
  assert.equal(SOA.length(soa), 4);
});

test("SOA-length on empty SOA", () => {
  const soa = { x: [] as number[], y: [] as number[] };
  assert.equal(SOA.length(soa), 0);
});

test("SOA-length on SOA with no keys", () => {
  const soa = {} as SOA.SOA<Record<never, never>>;
  assert.equal(SOA.length(soa), 0);
});

test("SOA-swapRemove removes middle element with O(1) swap", () => {
  const soa = { x: [1, 2, 3, 4], y: [10, 20, 30, 40] };
  SOA.swapRemove(soa, 1); // remove index 1; last element (index 3) moves to index 1
  assert.equal(SOA.length(soa), 3);
  assert.deepEqual(soa.x, [1, 4, 3]);
  assert.deepEqual(soa.y, [10, 40, 30]);
});

test("SOA-swapRemove removes last element without swapping", () => {
  const soa = { x: [1, 2, 3], y: [10, 20, 30] };
  SOA.swapRemove(soa, 2);
  assert.equal(SOA.length(soa), 2);
  assert.deepEqual(soa.x, [1, 2]);
  assert.deepEqual(soa.y, [10, 20]);
});

test("SOA-swapRemove removes single element", () => {
  const soa = { x: [99], y: [42] };
  SOA.swapRemove(soa, 0);
  assert.equal(SOA.length(soa), 0);
});

test("SOA-swapRemove throws RangeError for out-of-bounds index", () => {
  const soa = { x: [1, 2], y: [3, 4] };
  assert.throws(() => SOA.swapRemove(soa, 5), RangeError);
  assert.throws(() => SOA.swapRemove(soa, -1), RangeError);
});

test("SOA-createView descriptor cache hit (second view reuses cached descriptors)", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  const view1 = SOA.createView(soa, 0);
  const view2 = SOA.createView(soa, 2); // second call → descriptor cache is hit
  assert.equal(view1.x, 1);
  assert.equal(view2.x, 3);
  view2.y = 99;
  assert.equal(soa.y[2], 99);
});

test("SOA-clear empties all slices", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  SOA.clear(soa);
  assert.equal(SOA.length(soa), 0);
  assert.deepEqual(soa.x, []);
  assert.deepEqual(soa.y, []);
});

test("SOA-createView throws a clear error for a column named 'index'", () => {
  const soa = { index: [1, 2], y: [3, 4] };
  assert.throws(() => SOA.createView(soa, 0), /'index' is reserved/);
  // Other operations on such an SOA are unaffected.
  assert.deepEqual(SOA.get(soa, 1), { index: 2, y: 4 });
});

test("SOA-swapRemove rejects non-integer, NaN and infinite indices without mutating", () => {
  for (const bad of [0.5, NaN, Infinity, -Infinity, -0.5, 1.5]) {
    const soa = { x: [1, 2, 3], y: [4, 5, 6] };
    assert.throws(() => SOA.swapRemove(soa, bad), RangeError, String(bad));
    assert.deepEqual(soa, { x: [1, 2, 3], y: [4, 5, 6] });
    assert.deepEqual(Object.keys(soa.x), ["0", "1", "2"]);
  }
  const empty = { x: [] as number[] };
  assert.throws(() => SOA.swapRemove(empty, 0), RangeError);
});

test("SOA-createView revalidates the descriptor cache when a column array is replaced", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  const before = SOA.createView(soa, 1);
  assert.equal(before.x, 2);
  soa.x = [10, 20, 30];
  const after = SOA.createView(soa, 1);
  assert.equal(after.x, 20);
  after.x = 99;
  assert.deepEqual(soa.x, [10, 99, 30]);
  // Views created earlier stay bound to the arrays they captured.
  assert.equal(before.x, 2);
  // Adding or removing a column is also picked up on the next createView.
  const grown = soa as { x: number[]; y: number[]; z?: number[] };
  grown.z = [7, 8, 9];
  assert.equal(SOA.createView(grown as { x: number[]; y: number[]; z: number[] }, 2).z, 9);
  delete grown.z;
  assert.equal(SOA.createView(soa, 2).x, 30);
});

test("SOA-set ignores extra item keys and bounds-checks", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6] };
  SOA.set(soa, 1, { x: 7, y: 8, extra: 9 } as unknown as { x: number; y: number });
  assert.deepEqual(soa, { x: [1, 7, 3], y: [4, 8, 6] });
  SOA.set(soa, 0, { x: 100, y: 101 });
  assert.deepEqual(soa, { x: [100, 7, 3], y: [101, 8, 6] });
  // Partial item: missing columns are left untouched; explicit undefined is written.
  SOA.set(soa, 0, { x: 5 } as unknown as { x: number; y: number });
  assert.deepEqual(soa, { x: [5, 7, 3], y: [101, 8, 6] });
  SOA.set(soa, 0, { x: 5, y: undefined } as unknown as { x: number; y: number });
  assert.equal(soa.y[0], undefined);
  assert.equal(soa.x[0], 5);
  SOA.set(soa, 0, { x: 100, y: 101 });
  for (const bad of [3, 4, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => SOA.set(soa, bad, { x: 0, y: 0 }), RangeError, String(bad));
  }
  assert.throws(() => SOA.set({} as SOA.SOA<Record<never, never>>, 0, {}), RangeError);
  // Co-length invariant intact and no stray named properties.
  assert.deepEqual(soa, { x: [100, 7, 3], y: [101, 8, 6] });
  assert.deepEqual(Object.keys(soa.x), ["0", "1", "2"]);
});

function hasFastProperties(o: object): boolean | undefined {
  void o; // referenced inside the eval string below
  try {
    // oxlint-disable-next-line no-eval
    return eval("%HasFastProperties(o)") as boolean;
  } catch {
    return undefined; // natives syntax not enabled (normal run)
  }
}

test("SOA-get/pop return plain fast-properties rows (run with --allow-natives-syntax)", () => {
  const soa = { x: [1, 2, 3], y: [4, 5, 6], vx: [7, 8, 9] };
  const row = SOA.get(soa, 1);
  assert.deepEqual(row, { x: 2, y: 5, vx: 8 });
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  const fast = hasFastProperties(row);
  if (fast !== undefined) assert.equal(fast, true);
  const popped = SOA.pop(soa);
  assert.deepEqual(popped, { x: 3, y: 6, vx: 9 });
  const fast2 = hasFastProperties(popped);
  if (fast2 !== undefined) assert.equal(fast2, true);
  assert.deepEqual(soa, { x: [1, 2], y: [4, 5], vx: [7, 8] });
  // Popping an empty SOA yields undefined fields and leaves it empty.
  const empty = { x: [] as number[] };
  assert.deepEqual(SOA.pop(empty), { x: undefined });
  assert.deepEqual(empty, { x: [] });
});

test("SOA handles a column named __proto__ (own data property)", () => {
  const soa = {} as Record<string, unknown[]>;
  for (const key of ["a", "__proto__", "b"]) {
    Object.defineProperty(soa, key, {
      value: [],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  type Row = { a: number; b: number };
  SOA.push(soa as unknown as SOA.SOA<Row>, { a: 1, ["__proto__"]: { evil: 1 }, b: 2 } as never);
  const item = { a: 3, b: 4 } as Record<string, unknown>;
  Object.defineProperty(item, "__proto__", { value: 5, enumerable: true, configurable: true });
  SOA.push(soa as unknown as SOA.SOA<Row>, item as never);
  const row = SOA.get(soa as unknown as SOA.SOA<Row>, 1) as unknown as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(row, "__proto__")!.value, 5);
  assert.equal(row.a, 3);
  const fast = hasFastProperties(row);
  if (fast !== undefined) assert.equal(fast, true);
  const view = SOA.createView(soa as unknown as SOA.SOA<Row>, 1) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(Object.getOwnPropertyDescriptor(view, "__proto__")!.get!.call(view), 5);
  const popped = SOA.pop(soa as unknown as SOA.SOA<Row>) as unknown as Record<string, unknown>;
  assert.equal(Object.getOwnPropertyDescriptor(popped, "__proto__")!.value, 5);
  assert.equal(soa["__proto__" as string].length, 1);
  assert.equal(({} as Record<string, unknown>).evil, undefined);
});

test("SOA-get/pop fall back to defineProperty rows when code generation is unavailable", () => {
  const RealFunction = globalThis.Function;
  // Unique column names: row factories are shared across SOAs with the same shape.
  const soa = { fbx: [1, 2], fby: [3, 4] };
  // oxlint-disable-next-line no-extend-native
  (globalThis as { Function: unknown }).Function = function () {
    throw new EvalError("code generation disabled");
  };
  try {
    assert.deepEqual(SOA.get(soa, 1), { fbx: 2, fby: 4 });
    assert.deepEqual(SOA.pop(soa), { fbx: 2, fby: 4 });
  } finally {
    globalThis.Function = RealFunction;
  }
  assert.deepEqual(soa, { fbx: [1], fby: [3] });
});

test("SOA-get shape-keyed row factory cache stays bounded and correct", () => {
  // More distinct shapes than the shared-factory cap forces a cache reset.
  for (let i = 0; i < 80; i++) {
    const name = `col${i}`;
    const soa = { [name]: [i, i + 1] } as Record<string, number[]>;
    assert.deepEqual(SOA.get(soa as SOA.SOA<Record<string, number>>, 1), { [name]: i + 1 });
  }
  const again = { col0: [5, 6] };
  assert.deepEqual(SOA.get(again, 0), { col0: 5 });
});

test("SOA operations ignore inherited enumerable keys (G6-6 regression)", () => {
  type Row = { ihx: number; ihy: number };
  const proto = { inh: [99, 98] };
  const make = (): SOA.SOA<Row> => {
    const soa = Object.create(proto) as SOA.SOA<Row>;
    soa.ihx = [1, 2];
    soa.ihy = [3, 4];
    return soa;
  };
  const soa = make();
  SOA.push(soa, { ihx: 5, ihy: 6, inh: 97 } as Row);
  assert.deepEqual(proto.inh, [99, 98], "push must not touch inherited arrays");
  assert.equal(SOA.length(soa), 3);
  assert.deepEqual(SOA.get(soa, 2), { ihx: 5, ihy: 6 });
  SOA.set(soa, 0, { ihx: 10, ihy: 30, inh: 0 } as Row);
  assert.deepEqual(proto.inh, [99, 98], "set must not touch inherited arrays");
  assert.deepEqual(SOA.pop(soa), { ihx: 5, ihy: 6 });
  assert.deepEqual(proto.inh, [99, 98], "pop must not touch inherited arrays");
  SOA.swapRemove(soa, 0);
  assert.deepEqual([soa.ihx, soa.ihy, proto.inh], [[2], [4], [99, 98]]);
  SOA.swapRemove(soa, 0);
  assert.deepEqual(proto.inh, [99, 98], "swapRemove must not touch inherited arrays");
  const s2 = make();
  const view = SOA.createView(s2, 1) as Row & { index: number } & Record<string, unknown>;
  assert.deepEqual(Object.keys(view), ["ihx", "ihy"]);
  assert.equal(Object.hasOwn(view, "inh"), false);
  // Second view hits the (own-keys-only) cache and still binds the own arrays.
  assert.equal(SOA.createView(s2, 0).ihy, 3);
  SOA.clear(s2);
  assert.deepEqual(proto.inh, [99, 98], "clear must not touch inherited arrays");
  assert.equal(SOA.length(s2), 0);
  // Only inherited keys: behaves as an SOA with no columns.
  const bare = Object.create(proto) as SOA.SOA<Record<never, never>>;
  assert.equal(SOA.length(bare), 0);
  assert.throws(() => SOA.set(bare, 0, {}), RangeError);
});

test("SOA-createView normalizes the initial index with |0 (G6-7 regression)", () => {
  const soa = { x: [10, 20, 30] };
  const v = SOA.createView(soa, 1.5);
  assert.equal(v.index, 1);
  assert.equal(v.x, 20);
  v.x = 21;
  assert.deepEqual(soa.x, [10, 21, 30]);
  assert.deepEqual(Object.keys(soa.x), ["0", "1", "2"], "no stray '1.5' property");
  assert.equal(SOA.createView(soa, -0.5).index, 0);
  assert.equal(SOA.createView(soa, NaN).index, 0);
  assert.equal(SOA.createView(soa).index, 0);
});
