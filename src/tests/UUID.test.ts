import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as UUID from "../UUID.js";
import { ValidationError } from "../schema/ValidationError.js";

// --- uuid (throwing constructor) ---

test("uuid() accepts valid v4 UUID (lowercase)", () => {
  const id = UUID.uuid("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(id, "550e8400-e29b-41d4-a716-446655440000");
});

test("uuid() accepts valid v4 UUID (uppercase) and lowercases it", () => {
  const id = UUID.uuid("550E8400-E29B-41D4-A716-446655440000");
  assert.equal(id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(id, UUID.uuid("550e8400-e29b-41d4-a716-446655440000"));
});

test("uuid() accepts Nil and Max UUIDs (any case)", () => {
  assert.equal(UUID.uuid("00000000-0000-0000-0000-000000000000"), UUID.NIL);
  assert.equal(UUID.uuid("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"), UUID.MAX);
  assert.equal(UUID.version(UUID.NIL), 0);
  assert.equal(UUID.version(UUID.MAX), 15);
  assert.throws(() => UUID.uuid("00000000-0000-0000-0000-000000000001"), RangeError);
});

test("validator() lowercases and accepts Nil/Max", () => {
  const v = UUID.validator();
  const r = v("550E8400-E29B-41D4-A716-446655440000");
  assert.deepEqual(r, [true, "550e8400-e29b-41d4-a716-446655440000"]);
  assert.equal(v(UUID.NIL)[0], true);
  assert.equal(v(UUID.MAX)[0], true);
});

test("v7() uses fresh random bytes across pool refills and stays valid", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = UUID.v7();
    assert.equal(UUID.uuid(id), id);
    assert.equal(UUID.version(id), 7);
    seen.add(id);
  }
  assert.equal(seen.size, 1000);
});

test("uuid() accepts valid v7 UUID", () => {
  const id = UUID.uuid("01903f5a-6a3c-7b12-8f00-123456789abc");
  assert.equal(id, "01903f5a-6a3c-7b12-8f00-123456789abc");
});

test("uuid() rejects empty string", () => {
  assert.throws(() => UUID.uuid(""), RangeError);
});

test("uuid() rejects string with wrong length", () => {
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-a716"), RangeError);
});

test("uuid() rejects string with wrong variant bits", () => {
  // variant nibble is '0' instead of 8/9/a/b
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-0716-446655440000"), RangeError);
});

test("uuid() rejects non-hex characters", () => {
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-a716-44665544000g"), RangeError);
});

test("uuid() rejects string without dashes", () => {
  assert.throws(() => UUID.uuid("550e8400e29b41d4a716446655440000"), RangeError);
});

// --- v4 ---

test("v4() returns a valid UUID", () => {
  const id = UUID.v4();
  // Should not throw when validated
  UUID.uuid(id);
});

test("v4() returns version 4", () => {
  const id = UUID.v4();
  assert.equal(UUID.version(id), 4);
});

test("v4() returns unique values", () => {
  const a = UUID.v4();
  const b = UUID.v4();
  assert.notEqual(a, b);
});

// --- v7 ---

test("v7() returns a valid UUID", () => {
  const id = UUID.v7();
  // Should not throw when validated
  UUID.uuid(id);
});

test("v7() returns version 7", () => {
  const id = UUID.v7();
  assert.equal(UUID.version(id), 7);
});

test("v7() returns unique values", () => {
  const a = UUID.v7();
  const b = UUID.v7();
  assert.notEqual(a, b);
});

declare const Bun: unknown;
// Bun delegates v7 to Bun.randomUUIDv7, which ignores a faked Date.now().
const isBun = typeof Bun !== "undefined";

/** Counter fields of a v7 id: rand_a (12 bits) and the 30 bits after the variant. */
function v7Counter(id: string): number {
  const hex = id.replace(/-/g, "");
  return parseInt(hex.slice(13, 16), 16) * 2 ** 30 + (parseInt(hex.slice(16, 24), 16) & 0x3fffffff);
}

/** Runs `body` with `Date.now()` returning `clock()`, then restores the real clock. */
function withFakeClock(clock: () => number, body: () => void): void {
  const realNow = Date.now;
  Date.now = clock;
  try {
    UUID.resetV7State();
    body();
  } finally {
    Date.now = realNow;
    UUID.resetV7State();
  }
}

test("v7() is strictly increasing across consecutive calls (G8-4)", () => {
  let prev = UUID.v7();
  for (let i = 0; i < 100_000; i++) {
    const id = UUID.v7();
    assert.ok(id > prev, `${id} > ${prev}`);
    prev = id;
  }
  // Bun's 12-bit counter borrows future milliseconds in a burst this large,
  // so its timestamps run ahead of Date.now(); wait for the clock to catch up
  // so later timestamp checks are unaffected. (Node never runs ahead: its
  // 42-bit counter does not borrow, so this spins at most 1 ms there.)
  const last = parseInt(prev.slice(0, 8) + prev.slice(9, 13), 16);
  while (Date.now() <= last) {
    // spin; bounded by the number of borrowed milliseconds
  }
});

test("v7() increments the counter by 1 within a millisecond and reseeds on a new one", () => {
  if (isBun) return;
  let now = 1_700_000_000_000;
  withFakeClock(
    () => now,
    () => {
      const a = UUID.v7();
      const b = UUID.v7();
      assert.ok(b > a);
      assert.equal(v7Counter(b), v7Counter(a) + 1);
      assert.ok(v7Counter(a) < 2 ** 41, "seed leaves the top counter bit clear");
      assert.equal(a.slice(0, 13), b.slice(0, 13), "same timestamp");
      assert.equal(UUID.version(b), 7);
      assert.ok("89ab".includes(b[19]), "variant bits preserved");
      now++;
      const c = UUID.v7();
      assert.ok(c > b);
      assert.equal(parseInt(c.slice(0, 8) + c.slice(9, 13), 16), now);
      assert.ok(v7Counter(c) < 2 ** 41, "reseeded on the new millisecond");
    },
  );
});

test("v7() stays monotonic when the clock steps back", () => {
  if (isBun) return;
  let now = 1_700_000_000_500;
  withFakeClock(
    () => now,
    () => {
      const a = UUID.v7();
      now -= 400; // NTP step backwards
      const b = UUID.v7();
      assert.ok(b > a);
      assert.equal(b.slice(0, 13), a.slice(0, 13), "keeps the last timestamp");
      assert.equal(v7Counter(b), v7Counter(a) + 1);
      now += 401; // clock passes the last timestamp again
      const c = UUID.v7();
      assert.ok(c > b);
      assert.equal(parseInt(c.slice(0, 8) + c.slice(9, 13), 16), now);
    },
  );
});

test("v7() embeds current timestamp (approximately)", () => {
  const before = Date.now();
  const id = UUID.v7();
  const after = Date.now();
  // Extract 48-bit timestamp from first 12 hex chars (bytes 0-5)
  const hex = id.replace(/-/g, "").substring(0, 12);
  const embedded = parseInt(hex, 16);
  assert.ok(embedded >= before, `embedded ${embedded} >= before ${before}`);
  assert.ok(embedded <= after, `embedded ${embedded} <= after ${after}`);
});

// --- version ---

test("version() extracts version 4 from v4 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("550e8400-e29b-41d4-a716-446655440000")), 4);
});

test("version() extracts version 7 from v7 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("01903f5a-6a3c-7b12-8f00-123456789abc")), 7);
});

test("version() extracts version 1 from v1 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")), 1);
});

// --- validator ---

test("validator() returns Ok for valid UUID", () => {
  const v = UUID.validator();
  const r = v("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(r[0], true);
  assert.equal(r[1], "550e8400-e29b-41d4-a716-446655440000");
});

test("validator() returns Err for non-string", () => {
  const v = UUID.validator();
  const r = v(42);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for invalid UUID string", () => {
  const v = UUID.validator();
  const r = v("not-a-uuid");
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});
